/**
 * Contract for the guided-coach spike. Deliberately isolated from the main
 * review types so this whole `spike/` tree can be deleted or rewired wholesale
 * once we decide where it lands. Browser-safe (no server imports).
 *
 * The shape of the experience: the engine finds the moments that mattered
 * (turning points), and for each one we run a short *guided* discussion — the
 * coach asks the player what they were thinking (grounded multiple-choice),
 * then explains using the engine facts and, where genuinely relevant, names a
 * principle. The LLM judges relevance; it never just checks boxes.
 */
import type { MoveClass } from '$lib/review/classify';

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

/** Everything the coach LLM is allowed to know about one turning point. Built
 *  on the client (it has the engine lines) and POSTed to /spike/coach/discuss.
 *  All evals are pre-rendered to text so the prompt never juggles signs. */
export type TurningPointFacts = {
	ply: number;
	moveNumber: number;
	/** Whose move it is — also the player we're coaching. */
	mover: 'White' | 'Black';
	playerColor: 'w' | 'b';
	/** Why this moment was picked: 'mistake' = the player's own slip; 'opportunity'
	 *  = the opponent just blundered and it's the player's turn to punish. */
	kind: 'mistake' | 'opportunity';
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

/** One conversational turn already exchanged, for context on follow-ups. */
export type DiscussTurn = { role: 'coach' | 'player'; content: string };

export type DiscussRequest = {
	facts: TurningPointFacts;
	history: DiscussTurn[];
	/** The option the player just tapped (absent on the opening turn). */
	playerChoice?: string;
	isFirstTurn: boolean;
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
	/** Options for the next question. Empty when this turning point is finished. */
	choices: string[];
	/** True when there's nothing more to discuss for this turning point. */
	done: boolean;
};
