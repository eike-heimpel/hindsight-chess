import { applyMove, isCheckmate, isStalemate, sideToMove } from '$lib/chess/rules';
import { safeEvaluate } from '$lib/client/engine';
import { REVIEW_DEPTH } from '$lib/client/reviewAnalysis';
import { uciSquares, type GameAnalysis } from '$lib/review/analysis';
import { winPercent } from '$lib/review/winPercent';
import type { Square } from '$lib/chess/types';
import type { EngineEval, EngineLine } from '$lib/engine/engine';
import type { ReviewGame } from '$lib/review/types';
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
 *  conversation. The factory binds source/gameId from the game. */
function makePersist(source: ReviewGame['source'], gameId: string): PersistFn {
	return (ply, thread) => {
		void fetch('/api/review/moves', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				ref: { source, gameId, ply },
				facet: 'thread',
				value: thread
			})
		}).catch(() => {});
	};
}

type DiscussFn = (req: CoachTurnRequest) => Promise<CoachTurnResponse>;
type EvaluateFn = typeof safeEvaluate;
type ExploreLine = ReturnType<typeof createExploreLine>;

/** The persisted shape of one move's coach thread (the `thread` facet). */
export type ThreadState = {
	messages: DiscussTurn[];
	learnings: Learning[];
	status: 'open' | 'wrapped';
};

type PersistFn = (ply: number, thread: ThreadState) => void;
type LoadThreadFn = (ply: number) => ThreadState | undefined;

/** The deep eval we memoise per ply: multiPv:3 from `fenBefore` + the reply line. */
type DeepEval = { bestLines: EngineLine[]; replyLine: EngineLine | null };

type Frame = { fen: string; lastMove: { from: Square; to: Square } | null };

/** A learning captured for one move, for the session tray. */
type CapturedLearnings = {
	ply: number;
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
 * `createExploreLine`). It owns the picked ply, the per-ply deep-eval memo, the
 * conversation, the board playback, and the session learnings tray.
 *
 * `discuss` and `evaluate` are injected so the whole flow is unit-testable
 * against fakes — no Stockfish, no network. The thread builds the full
 * `CoachTurnRequest` from its own state; `discuss` only transports it.
 *
 * Two interaction variants share this core: 'A' is conversation-first (the coach
 * speaks first on `open`), 'B' is voice-first (the coach stays silent until the
 * player speaks or asks for a hint, and show-playback routes through `explore`).
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
	const persist = opts.persist ?? makePersist(game.source, game.gameId);
	const loadThread = opts.loadThread;

	let currentPly = $state<number | null>(null);
	// Per-ply deep eval; populated on the first `open(ply)` and reused after.
	// Deliberately a plain (non-reactive) Map — a memo, nothing renders off it.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const deepEvals = new Map<number, DeepEval>();

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

	function move(ply: number) {
		return game.moves[ply - 1];
	}

	/** Resolve the deep eval for `ply`, hitting the memo first. */
	async function resolveDeepEval(ply: number): Promise<DeepEval | null> {
		const hit = deepEvals.get(ply);
		if (hit) return hit;

		const mv = move(ply);
		evaluating = true;
		try {
			const before = await evaluate(mv.fenBefore, { depth: REVIEW_DEPTH, multiPv: 3 });
			if (!before.ok) {
				convError = before.error.message;
				return null;
			}
			const ended = isCheckmate(mv.fenAfter) || isStalemate(mv.fenAfter);
			let replyLine: EngineLine | null = null;
			if (!ended) {
				const after = await evaluate(mv.fenAfter, { depth: REVIEW_DEPTH, multiPv: 1 });
				if (after.ok) replyLine = toLines(after.value)[0] ?? null;
			}
			const deep: DeepEval = { bestLines: toLines(before.value), replyLine };
			deepEvals.set(ply, deep);
			return deep;
		} finally {
			evaluating = false;
		}
	}

	/** Drive the EvalBar instantly from cached analysis while the deep eval lands. */
	function seedWhiteWin(ply: number) {
		const cached = analysis?.moves[ply - 1];
		if (!cached) {
			whiteWin = null;
			return;
		}
		const mv = move(ply);
		// `winAfter` is from the mover's POV; flip to white-POV for the bar.
		whiteWin = mv.color === 'w' ? cached.winAfter : 100 - cached.winAfter;
	}

	function resetBoard(ply: number) {
		playToken++;
		const mv = move(ply);
		boardFen = mv.fenAfter;
		boardLast = uciSquares(mv.uci);
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
		const ply = currentPly;
		if (ply === null) return;
		const deep = deepEvals.get(ply);
		if (!deep) return; // open() resolves the eval before any turn
		const mv = move(ply);

		thinking = true;
		convError = null;
		try {
			const resp = await discuss({
				source: game.source,
				gameId: game.gameId,
				ply,
				fenBefore: mv.fenBefore,
				playedUci: mv.uci,
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
					...learnings.filter((l) => l.ply !== ply),
					{
						ply,
						moveNumber: mv.color === 'w' ? Math.ceil(ply / 2) : ply / 2,
						learnings: resp.learnings
					}
				];
			}
			if (resp.show !== 'none') playShow(resp.show);
			persist(ply, {
				messages,
				learnings: learningsFor(ply),
				status: wrapUpReady ? 'wrapped' : 'open'
			});
		} catch (e) {
			convError = e instanceof Error ? e.message : String(e);
		} finally {
			thinking = false;
		}
	}

	/** This ply's committed learnings (the tray entry), or [] if none yet. */
	function learningsFor(ply: number): Learning[] {
		return learnings.find((l) => l.ply === ply)?.learnings ?? [];
	}

	function playShow(show: 'best' | 'punish') {
		if (variant === 'B' && explore) {
			const ply = currentPly;
			if (ply === null) return;
			const mv = move(ply);
			explore.enter(show === 'best' ? mv.fenBefore : mv.fenAfter, `move ${mv.san}`);
			return;
		}
		playFrames(show === 'best' ? bestFrames : punishFrames);
	}

	return {
		get currentPly() {
			return currentPly;
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
		 * Pick a spot. Resolves the deep eval (memo hit = instant; miss = fire the
		 * engine), seeds the EvalBar from cached analysis meanwhile, builds the
		 * playback frames, then per variant: A → the coach speaks first; B → stay
		 * silent until the player speaks or asks to be guided.
		 */
		async open(ply: number) {
			currentPly = ply;
			messages = [];
			choices = [];
			canGuide = false;
			wrapUpReady = false;
			convError = null;
			seedWhiteWin(ply);
			resetBoard(ply);

			const deep = await resolveDeepEval(ply);
			if (!deep) return;

			const mv = move(ply);
			bestFrames = bestFramesFrom(mv.fenBefore, deep.bestLines[0]?.pv ?? []);
			punishFrames = punishFramesFrom(mv.fenBefore, mv.uci, deep.replyLine?.pv ?? []);
			// Refine the bar from a deep eval of the position ON THE BOARD — i.e. AFTER
			// the move (`replyLine` evaluates fenAfter). `bestLines` evaluates fenBefore
			// (the engine's search position), so refining off it snapped the bar from
			// winAfter to winBefore with no move change. Null only when the move ended
			// the game — then the cached seed stands.
			const after = deep.replyLine;
			if (after) {
				const stm = sideToMove(mv.fenAfter);
				whiteWin = stm === 'w' ? winPercent(after.cp) : 100 - winPercent(after.cp);
			}

			// Resume a saved conversation seamlessly: seed it and DON'T re-fire the
			// opener. Only an empty (no-messages) spot runs variant A's opening turn.
			const saved = loadThread?.(ply);
			if (saved && saved.messages.length) {
				messages = saved.messages;
				wrapUpReady = saved.status === 'wrapped';
				if (saved.learnings.length) {
					learnings = [
						...learnings.filter((l) => l.ply !== ply),
						{
							ply,
							moveNumber: mv.color === 'w' ? Math.ceil(ply / 2) : ply / 2,
							learnings: saved.learnings
						}
					];
				}
				return;
			}

			if (variant === 'A') await runTurn('open');
		},

		/** The player answered — a tapped chip or free text. */
		async answer(text: string) {
			if (thinking || currentPly === null) return;
			const t = text.trim();
			if (!t) return;
			messages = [...messages, { role: 'player', content: t }];
			await runTurn('answer', t);
		},

		/** The player is stuck — ask the coach for a narrowing hint. */
		async guideMe() {
			if (thinking || currentPly === null) return;
			await runTurn('guide');
		},

		/** Play out a precomputed line on the board (A) or hand it to explore (B). */
		playLine(which: 'best' | 'punish') {
			playShow(which);
		},

		/** Replay the played move's static position. */
		resetBoard() {
			if (currentPly !== null) resetBoard(currentPly);
		},

		/** Commit the current move's learnings (already in the tray) and clear the
		 *  thread, returning to picking. The tray persists across the session. */
		finish() {
			const ply = currentPly;
			// Mark the thread wrapped on the way out so a return resumes it as done,
			// not mid-conversation. Skip empty threads (opened then abandoned).
			if (ply !== null && messages.length) {
				persist(ply, { messages, learnings: learningsFor(ply), status: 'wrapped' });
			}
			playToken++;
			currentPly = null;
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
