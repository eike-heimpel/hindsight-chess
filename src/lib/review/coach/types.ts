/**
 * Contract for the guided coach. Browser-safe (no server imports).
 *
 * The shape of the experience: the player picks a spot (any move, not just the
 * auto-flagged turning points), talks through their read in free text, and the
 * coach asks grounded multiple-choice follow-ups, confirms/corrects against the
 * engine facts, and offers an on-demand hint ("guide me"). The LLM judges
 * relevance; it never just checks boxes.
 */
import type { MoveClass } from '$lib/review/classify';
import type { EngineLine } from '$lib/engine/engine';
import type { ReviewSource } from '$lib/review/types';

/** A coaching principle the engine *suspects* applies, computed deterministically.
 *  It is a candidate the LLM may use, ignore, or contradict — never gospel. */
export type PrincipleSignal = {
	id: 'undeveloped' | 'late-castle' | 'moved-twice' | 'king-wander' | 'early-queen';
	/** Short human label, e.g. "Develop your pieces". */
	label: string;
	/** Grounded specifics, e.g. "light-squared bishop still on c8 at move 12". */
	detail: string;
};

type AttackerEn = { pieceEn: string; square: string };

/** Why this moment is being discussed. 'mistake' = the player's own slip;
 *  'opportunity' = the opponent just blundered and it's the player's turn to
 *  punish; 'chosen' = a quiet move the user picked themselves (no eval swing). */
export type MomentKind = 'mistake' | 'opportunity' | 'chosen';

/** Everything the coach LLM is allowed to know about one moment. Built server-
 *  side from the stored game + engine lines. All evals are pre-rendered to text
 *  so the prompt never juggles signs. */
export type TurningPointFacts = {
	ply: number;
	moveNumber: number;
	/** Whose move it is — also the player we're coaching. */
	mover: 'White' | 'Black';
	playerColor: 'w' | 'b';
	kind: MomentKind;
	/** Set on 'opportunity' moments: the opponent's blunder that set this up. */
	setup: { opponentBlunderSan: string; opponentDropPct: number } | null;
	playedSan: string;
	bestSan: string;
	isBest: boolean;
	classification: MoveClass;
	/** Win % for the PLAYER, before vs after the move (0..100). NOTE: `winBefore`
	 *  is the engine's BEST move's value — it already assumes that move was found,
	 *  so for a move that IS the best, `winBefore ≈ winAfter` even though finding it
	 *  was the achievement. Judge moves against `winSecondBest`, not `winBefore`. */
	winBefore: number;
	winAfter: number;
	/** Win % of the engine's SECOND-best line. Used ONLY as a sharpness gauge for
	 *  the POSITION: a big gap to `winBefore` means most alternatives lose ground
	 *  (the position punished imprecision); a small gap means it was forgiving. It is
	 *  NOT a model of what the player would otherwise have played — we have no such
	 *  model, so never read it as a human counterfactual. Null on a forced/only move. */
	winSecondBest: number | null;
	/** Eval after the played move, pawns from the player's POV ("-1.4", "-M3"). */
	evalPlayed: string;
	played: {
		pieceEn: string;
		capturedEn: string | null;
		to: string;
		givesCheck: boolean;
		isCheckmate: boolean;
		attackersOfTo: AttackerEn[];
		defendersOfTo: AttackerEn[];
	};
	/** Engine's #1 line from before the move (SAN), and the next-best alternatives. */
	bestLineSan: string;
	altLinesSan: string[];
	/** The reply the played move allows — the punishment line (SAN), or null if
	 *  the move ended the game. */
	punishLineSan: string | null;
	nature: {
		allowedMate: boolean;
		threwAwayWin: boolean;
		hangsMovedPiece: boolean;
	};
	principles: PrincipleSignal[];
	opening: string | null;
	resultForPlayer: 'win' | 'loss' | 'draw';
};

/** One conversational turn already exchanged, for context on follow-ups. Holds
 *  no chess claims — only the prose said by each side. */
export type DiscussTurn = { role: 'coach' | 'player'; content: string };

/** What the coach LLM is asked to do this turn. 'open' = first turn (scene +
 *  ask, no explanation); 'answer' = respond to the player's chip/free text;
 *  'guide' = the player is stuck, give a narrowing hint (never the full answer). */
export type CoachIntent = 'open' | 'answer' | 'guide';

export type DiscussRequest = {
	facts: TurningPointFacts;
	history: DiscussTurn[];
	intent: CoachIntent;
	/** The free text OR the tapped choice label. Absent on the opening turn. */
	playerText?: string;
	/** Gate-retry instruction: the prior reply's grounding error to fix. */
	correction?: string;
};

/** A learning, tagged by the level it lives at — what the user asked for. */
export type Learning = {
	level: 'tactical' | 'principle' | 'process';
	point: string;
};

export type DiscussResponse = {
	/** Coach prose for this turn — the conversational reply. */
	message: string;
	/** Which precomputed line the client should play out on the board. The client
	 *  owns move legality; the LLM only picks which to show. */
	show: 'best' | 'punish' | 'none';
	/** Multi-level takeaways. Usually empty until the point is being wrapped up. */
	learnings: Learning[];
	/** Options for the next question. May be non-empty even when `wrapUp` is true. */
	choices: string[];
	/** Advisory "a good place to stop" — never hides the input. (Was `done`.) */
	wrapUp: boolean;
};

/** The wire request the browser POSTs to /api/review/coach/discuss. Engine
 *  numbers only — the server re-derives kind/setup/facts from the stored game.
 *  Mirrors the explain route's trust boundary. */
export type CoachTurnRequest = {
	source: ReviewSource;
	gameId: string;
	/** Identity → re-derived server-side. */
	ply: number;
	fenBefore: string;
	/** Validated vs the stored game's moves[ply-1]. */
	playedUci: string;
	bestLines: EngineLine[];
	/** Engine numbers, trusted (like explain). Null when the move ended the game. */
	replyLine: EngineLine | null;
	intent: CoachIntent;
	/** The free text OR the tapped choice label. */
	playerText?: string;
	/** Conversational context only — no chess claims. */
	history: DiscussTurn[];
};

/** The discuss route's response: the coach turn plus a `canGuide` affordance hint
 *  (added in the route, not by the LLM). */
export type CoachTurnResponse = DiscussResponse & {
	/** Whether a "guide me" affordance makes sense next. */
	canGuide: boolean;
};
