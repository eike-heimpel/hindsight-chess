import { applyMove, isCheckmate, isStalemate, sideToMove } from '$lib/chess/rules';
import { safeEvaluate } from '$lib/client/engine';
import { REVIEW_DEPTH } from '$lib/client/reviewAnalysis';
import { uciSquares, type GameAnalysis } from '$lib/review/analysis';
import { winPercent } from '$lib/review/winPercent';
import type { Side, Square } from '$lib/chess/types';
import type { EngineEval, EngineLine } from '$lib/engine/engine';
import type { ReviewGame } from '$lib/review/types';
import type { MoveRef } from '$lib/server/userMoveState';
import type {
	CoachIntent,
	CoachTurnRequest,
	CoachTurnResponse,
	DiscussTurn,
	Learning
} from '$lib/review/coach/types';
import type { createExploreLine } from './exploreLine.svelte';

/** Default transport: POST the fully-built request, get the coach turn back. The
 *  thread owns building the request from its own state; this only moves bytes,
 *  so tests inject a fake in its place. */
export async function postCoachTurn(req: CoachTurnRequest): Promise<CoachTurnResponse> {
	const res = await fetch('/api/review/coach/discuss', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(req)
	});
	if (!res.ok) {
		const detail = (await res.text()).slice(0, 200) || `error ${res.status}`;
		throw new Error(detail);
	}
	return (await res.json()) as CoachTurnResponse;
}

/** Default autosave: fire-and-forget POST of the thread facet, mirroring the
 *  note/mark transport on the review page. Best-effort — network errors are
 *  swallowed quietly (not a Result boundary), so a failed save never breaks the
 *  conversation. Keyed by the full `MoveRef` so an explored alternative (with a
 *  `line`) saves to its own doc, not the real move at the branch ply. */
function makePersist(): PersistFn {
	return (ref, thread) => {
		void fetch('/api/review/moves', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ref, facet: 'thread', value: thread })
		}).catch(() => {});
	};
}

type DiscussFn = (req: CoachTurnRequest) => Promise<CoachTurnResponse>;
type EvaluateFn = typeof safeEvaluate;
type ExploreLine = ReturnType<typeof createExploreLine>;

/** The persisted shape of one move's coach thread (the `thread` facet). `choices`
 *  is the last coach turn's chips, persisted so a resumed conversation comes back
 *  WITH its tappable next-steps, not just the prose. */
export type ThreadState = {
	messages: DiscussTurn[];
	learnings: Learning[];
	choices: string[];
	status: 'open' | 'wrapped';
};

type PersistFn = (ref: MoveRef, thread: ThreadState) => void;
type LoadThreadFn = (ref: MoveRef) => ThreadState | undefined;

/** The deep eval we memoise per subject: multiPv:3 from `fenBefore` + the reply line. */
type DeepEval = { bestLines: EngineLine[]; replyLine: EngineLine | null };

type Frame = { fen: string; lastMove: { from: Square; to: Square } | null };

/**
 * What the coach is discussing — a REAL game move or an EXPLORED "what if" line.
 * Generalised from a bare ply so one conversation primitive serves both: a real
 * move is `{ref:{...ply}}`, an explored alternative is `{ref:{...ply,line}}` where
 * `ply` is the branch point and `line` the UCI moves played out from there (the
 * discussed move is the last). Everything downstream (deep eval, board, persist,
 * request) keys off the subject, not the ply.
 */
type Subject = {
	ref: MoveRef;
	fenBefore: string;
	fenAfter: string;
	playedUci: string;
	/** Mover of the discussed move (drives the learnings-tray move number label). */
	color: Side;
	san: string;
	moveNumber: number;
	/** White-POV win% to seed the EvalBar instantly — from cached analysis for a
	 *  real move, null for an explored line (no cached analysis; the bar pulses). */
	cachedWhiteWin: number | null;
};

/** Stable identity for a subject within this game's thread — ply plus the UCI line
 *  (empty for a real move), so a real move and the alternatives off the same ply
 *  never collide in the deep-eval memo or the learnings tray. */
function subjectKey(ref: MoveRef): string {
	return `${ref.ply}:${ref.line ? ref.line.join('-') : ''}`;
}

/** Full-move number from a FEN — for the learnings-tray label on explored lines,
 *  where there's no ply→move-number mapping. */
function fullMoveNumber(fen: string): number {
	return parseInt(fen.trim().split(/\s+/)[5] ?? '1', 10);
}

/** A learning captured for one subject, for the session tray. */
type CapturedLearnings = {
	key: string;
	moveNumber: number;
	learnings: Learning[];
};

function toLines(ev: EngineEval): EngineLine[] {
	if (ev.lines && ev.lines.length) return ev.lines;
	return [
		{ cp: ev.cp, pv: ev.pv ?? (ev.bestMoveUci ? [ev.bestMoveUci] : []), moveUci: ev.bestMoveUci }
	];
}

/** Build the board frames for the engine's best line played out from `fenBefore`. */
function bestFramesFrom(fenBefore: string, pv: string[], max = 8): Frame[] {
	const frames: Frame[] = [{ fen: fenBefore, lastMove: null }];
	let fen = fenBefore;
	for (const u of pv.slice(0, max)) {
		try {
			const { fen: next } = applyMove(fen, u);
			frames.push({ fen: next, lastMove: uciSquares(u) });
			fen = next;
		} catch {
			break;
		}
	}
	return frames;
}

/** Build the "what the played move allowed" frames: the played move, then the
 *  engine's reply line from the resulting position. */
function punishFramesFrom(fenBefore: string, playedUci: string, replyPv: string[]): Frame[] {
	const frames: Frame[] = [{ fen: fenBefore, lastMove: null }];
	let fen: string;
	try {
		const applied = applyMove(fenBefore, playedUci);
		fen = applied.fen;
	} catch {
		return frames;
	}
	frames.push({ fen, lastMove: uciSquares(playedUci) });
	for (const u of replyPv.slice(0, 6)) {
		try {
			const { fen: next } = applyMove(fen, u);
			frames.push({ fen: next, lastMove: uciSquares(u) });
			fen = next;
		} catch {
			break;
		}
	}
	return frames;
}

/**
 * The guided-coach conversation, lifted out of the route (CLAUDE.md: the page
 * stays thin; async orchestration belongs in a rune module — same pattern as
 * `createExploreLine`). It owns the picked subject, its deep-eval memo, the
 * conversation, the board playback, and the session learnings tray.
 *
 * A subject is either a REAL game move (`open(ply)`) or an EXPLORED "what if" line
 * the player played out on the analysis board (`openExplore(...)`). Both run the
 * identical conversation; only the anchor and a little framing differ. Explored
 * subjects own the board directly (inline frame playback) rather than handing
 * show-lines to `explore`, which would clobber the very line being discussed.
 *
 * `discuss` and `evaluate` are injected so the whole flow is unit-testable
 * against fakes — no Stockfish, no network. The thread builds the full
 * `CoachTurnRequest` from its own state; `discuss` only transports it.
 *
 * Two interaction variants share this core: 'A' is conversation-first (the coach
 * speaks first on `open`), 'B' is voice-first (the coach stays silent until the
 * player speaks or asks for a hint, and real-move show-playback routes through
 * `explore`).
 */
export function createCoachThread(opts: {
	game: ReviewGame;
	analysis: GameAnalysis | null;
	variant: 'A' | 'B';
	discuss?: DiscussFn;
	evaluate?: EvaluateFn;
	explore?: ExploreLine;
	persist?: PersistFn;
	loadThread?: LoadThreadFn;
}) {
	const { game, analysis, variant, explore } = opts;
	const discuss = opts.discuss ?? postCoachTurn;
	const evaluate = opts.evaluate ?? safeEvaluate;
	const persist = opts.persist ?? makePersist();
	const loadThread = opts.loadThread;

	let subject = $state<Subject | null>(null);
	// Per-subject deep eval; populated on the first open and reused after.
	// Deliberately a plain (non-reactive) Map — a memo, nothing renders off it.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const deepEvals = new Map<string, DeepEval>();

	let messages = $state<DiscussTurn[]>([]);
	let choices = $state<string[]>([]);
	let canGuide = $state(false);
	let thinking = $state(false);
	let wrapUpReady = $state(false);
	let convError = $state<string | null>(null);
	let evaluating = $state(false);

	// Session tray of committed learnings, keyed by ply.
	let learnings = $state<CapturedLearnings[]>([]);

	// Board playback (lifted from the spike +page.svelte).
	let boardFen = $state('8/8/8/8/8/8/8/8 w - - 0 1');
	let boardLast = $state<{ from: Square; to: Square } | null>(null);
	let boardArrow = $state<{ from: Square; to: Square } | null>(null);
	let playToken = 0; // cancels in-flight playback when the ply changes

	// Frames for the current ply, rebuilt on `open`.
	let bestFrames: Frame[] = [];
	let punishFrames: Frame[] = [];

	// White-POV win% to drive EvalBar; seeded instantly from cached analysis,
	// then refined when the deep eval lands.
	let whiteWin = $state<number | null>(null);

	/** Build the subject for a real game move at `ply`. */
	function moveSubject(ply: number): Subject {
		const mv = game.moves[ply - 1];
		const cached = analysis?.moves[ply - 1];
		return {
			ref: { source: game.source, gameId: game.gameId, ply },
			fenBefore: mv.fenBefore,
			fenAfter: mv.fenAfter,
			playedUci: mv.uci,
			color: mv.color,
			san: mv.san,
			moveNumber: mv.color === 'w' ? Math.ceil(ply / 2) : ply / 2,
			// `winAfter` is the mover's POV; flip to white-POV for the bar.
			cachedWhiteWin: cached ? (mv.color === 'w' ? cached.winAfter : 100 - cached.winAfter) : null
		};
	}

	/** Resolve the deep eval for a subject, hitting the memo first. */
	async function resolveDeepEval(s: Subject): Promise<DeepEval | null> {
		const key = subjectKey(s.ref);
		const hit = deepEvals.get(key);
		if (hit) return hit;

		evaluating = true;
		try {
			const before = await evaluate(s.fenBefore, { depth: REVIEW_DEPTH, multiPv: 3 });
			if (!before.ok) {
				convError = before.error.message;
				return null;
			}
			const ended = isCheckmate(s.fenAfter) || isStalemate(s.fenAfter);
			let replyLine: EngineLine | null = null;
			if (!ended) {
				const after = await evaluate(s.fenAfter, { depth: REVIEW_DEPTH, multiPv: 1 });
				if (after.ok) replyLine = toLines(after.value)[0] ?? null;
			}
			const deep: DeepEval = { bestLines: toLines(before.value), replyLine };
			deepEvals.set(key, deep);
			return deep;
		} finally {
			evaluating = false;
		}
	}

	function resetBoard(s: Subject) {
		playToken++;
		boardFen = s.fenAfter;
		boardLast = uciSquares(s.playedUci);
		boardArrow = null;
	}

	async function playFrames(frames: Frame[]) {
		const token = ++playToken;
		for (let i = 0; i < frames.length; i++) {
			if (token !== playToken) return;
			boardFen = frames[i].fen;
			boardLast = frames[i].lastMove;
			boardArrow = frames[i].lastMove;
			await new Promise((r) => setTimeout(r, i === 0 ? 250 : 800));
		}
	}

	/** Build the request from current state + memoised eval, send it, fold the
	 *  response into conversation/board state. */
	async function runTurn(intent: CoachIntent, playerText?: string) {
		const s = subject;
		if (s === null) return;
		const deep = deepEvals.get(subjectKey(s.ref));
		if (!deep) return; // open() resolves the eval before any turn
		const key = subjectKey(s.ref);

		thinking = true;
		convError = null;
		try {
			const resp = await discuss({
				source: s.ref.source,
				gameId: s.ref.gameId,
				ply: s.ref.ply,
				// Present → the server replays + validates this explored line; absent →
				// it validates fenBefore/playedUci against the stored move at the ply.
				...(s.ref.line ? { line: s.ref.line } : {}),
				fenBefore: s.fenBefore,
				playedUci: s.playedUci,
				bestLines: deep.bestLines,
				replyLine: deep.replyLine,
				intent,
				playerText,
				history: messages
			});
			messages = [...messages, { role: 'coach', content: resp.message }];
			choices = resp.choices;
			canGuide = resp.canGuide;
			wrapUpReady = resp.wrapUp;
			if (resp.learnings.length) {
				learnings = [
					...learnings.filter((l) => l.key !== key),
					{ key, moveNumber: s.moveNumber, learnings: resp.learnings }
				];
			}
			if (resp.show !== 'none') playShow(resp.show);
			persist(s.ref, {
				messages,
				learnings: learningsForKey(key),
				choices,
				status: wrapUpReady ? 'wrapped' : 'open'
			});
		} catch (e) {
			convError = e instanceof Error ? e.message : String(e);
		} finally {
			thinking = false;
		}
	}

	/** This subject's committed learnings (the tray entry), or [] if none yet. */
	function learningsForKey(key: string): Learning[] {
		return learnings.find((l) => l.key === key)?.learnings ?? [];
	}

	function playShow(show: 'best' | 'punish') {
		// An explored subject already owns the board — re-entering `explore` here
		// would clobber the very line being discussed, so play frames inline.
		if (variant === 'B' && explore && subject && !subject.ref.line) {
			const s = subject;
			explore.enter(show === 'best' ? s.fenBefore : s.fenAfter, `move ${s.san}`);
			return;
		}
		playFrames(show === 'best' ? bestFrames : punishFrames);
	}

	/** Shared open path for both real moves and explored lines: reset state, seed
	 *  the bar, resolve the deep eval, build playback frames, then either resume a
	 *  saved conversation or (variant A) fire the opener. */
	async function openSubject(s: Subject) {
		subject = s;
		messages = [];
		choices = [];
		canGuide = false;
		wrapUpReady = false;
		convError = null;
		whiteWin = s.cachedWhiteWin;
		resetBoard(s);

		const deep = await resolveDeepEval(s);
		if (!deep) return;

		bestFrames = bestFramesFrom(s.fenBefore, deep.bestLines[0]?.pv ?? []);
		punishFrames = punishFramesFrom(s.fenBefore, s.playedUci, deep.replyLine?.pv ?? []);
		// Refine the bar from a deep eval of the position ON THE BOARD — i.e. AFTER
		// the move (`replyLine` evaluates fenAfter). `bestLines` evaluates fenBefore
		// (the engine's search position), so refining off it snapped the bar from
		// winAfter to winBefore with no move change. Null only when the move ended
		// the game — then the seed stands.
		const after = deep.replyLine;
		if (after) {
			const stm = sideToMove(s.fenAfter);
			whiteWin = stm === 'w' ? winPercent(after.cp) : 100 - winPercent(after.cp);
		}

		// Resume a saved conversation seamlessly: seed it and DON'T re-fire the
		// opener. Only an empty (no-messages) spot runs variant A's opening turn.
		const saved = loadThread?.(s.ref);
		if (saved && saved.messages.length) {
			messages = saved.messages;
			choices = saved.choices ?? [];
			wrapUpReady = saved.status === 'wrapped';
			if (saved.learnings.length) {
				const key = subjectKey(s.ref);
				learnings = [
					...learnings.filter((l) => l.key !== key),
					{ key, moveNumber: s.moveNumber, learnings: saved.learnings }
				];
			}
			return;
		}

		if (variant === 'A') await runTurn('open');
	}

	return {
		get currentPly() {
			return subject?.ref.ply ?? null;
		},
		/** The ref of the subject under discussion — for the page's star control,
		 *  which writes a mark facet to the right doc (real move vs explored line). */
		get currentRef(): MoveRef | null {
			return subject ? subject.ref : null;
		},
		/** True while coaching an explored "what if" line — the page sources the
		 *  board from this thread (inline playback) rather than from `explore`. */
		get ownsBoard() {
			return subject?.ref.line != null;
		},
		get messages() {
			return messages;
		},
		get choices() {
			return choices;
		},
		get canGuide() {
			return canGuide;
		},
		get thinking() {
			return thinking;
		},
		get evaluating() {
			return evaluating;
		},
		get wrapUpReady() {
			return wrapUpReady;
		},
		get learnings() {
			return learnings;
		},
		/** The committed learnings for the subject under discussion (variant A's tray). */
		get currentLearnings(): Learning[] {
			return subject ? learningsForKey(subjectKey(subject.ref)) : [];
		},
		get convError() {
			return convError;
		},
		get whiteWin() {
			return whiteWin;
		},
		get boardFen() {
			return boardFen;
		},
		get boardLast() {
			return boardLast;
		},
		get boardArrow() {
			return boardArrow;
		},

		/**
		 * Coach a REAL game move at `ply`. Resolves the deep eval (memo hit = instant;
		 * miss = fire the engine), seeds the EvalBar from cached analysis meanwhile,
		 * builds the playback frames, then per variant: A → the coach speaks first;
		 * B → stay silent until the player speaks or asks to be guided.
		 */
		async open(ply: number) {
			await openSubject(moveSubject(ply));
		},

		/**
		 * Coach an EXPLORED "what if" line. `ply` is the branch point (0 = the start),
		 * `line` the UCI moves from there; the discussed move is the last one. The
		 * deep eval is computed from the explored position just like a real move, so
		 * the conversation is identical — only the server-side validation (replay vs
		 * stored-move match) and the coach's framing ('explore') differ.
		 */
		async openExplore(args: {
			ply: number;
			line: string[];
			fenBefore: string;
			fenAfter: string;
			playedUci: string;
			san: string;
		}) {
			await openSubject({
				ref: { source: game.source, gameId: game.gameId, ply: args.ply, line: args.line },
				fenBefore: args.fenBefore,
				fenAfter: args.fenAfter,
				playedUci: args.playedUci,
				color: sideToMove(args.fenBefore),
				san: args.san,
				moveNumber: fullMoveNumber(args.fenBefore),
				cachedWhiteWin: null
			});
		},

		/** The player answered — a tapped chip or free text. */
		async answer(text: string) {
			if (thinking || subject === null) return;
			const t = text.trim();
			if (!t) return;
			messages = [...messages, { role: 'player', content: t }];
			await runTurn('answer', t);
		},

		/** The player is stuck — ask the coach for a narrowing hint. */
		async guideMe() {
			if (thinking || subject === null) return;
			await runTurn('guide');
		},

		/** Play out a precomputed line on the board (A) or hand it to explore (B). */
		playLine(which: 'best' | 'punish') {
			playShow(which);
		},

		/** Replay the discussed move's static position. */
		resetBoard() {
			if (subject) resetBoard(subject);
		},

		/** Commit the current subject's learnings (already in the tray) and clear the
		 *  thread, returning to picking. The tray persists across the session. */
		finish() {
			const s = subject;
			// Mark the thread wrapped on the way out so a return resumes it as done,
			// not mid-conversation. Skip empty threads (opened then abandoned).
			if (s !== null && messages.length) {
				const key = subjectKey(s.ref);
				persist(s.ref, { messages, learnings: learningsForKey(key), choices, status: 'wrapped' });
			}
			playToken++;
			subject = null;
			messages = [];
			choices = [];
			canGuide = false;
			thinking = false;
			wrapUpReady = false;
			convError = null;
		}
	};
}

export type CoachThread = ReturnType<typeof createCoachThread>;
