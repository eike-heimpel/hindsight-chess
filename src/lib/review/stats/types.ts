/**
 * Cross-game stats domain. Pure + platform-blind, same posture as the rest of
 * `src/lib/review/`: everything here is computed from already-stored games +
 * analyses, no engine or Mongo. The aggregation unit is a *person* — modelled as
 * a set of linked accounts (lowercased usernames, matching `reviewGames.accounts`).
 *
 * Two deliberate axes:
 *  - **Segmentation by time class.** Rapid / blitz / bullet / daily are never
 *    pooled (accuracy across them is apples-to-oranges). `computeReviewStats`
 *    returns one `ReviewStats` per time class.
 *  - **"Me" perspective.** Every personal stat is taken from the side the person
 *    played; `toPerspective` resolves that once and everything builds on it.
 *
 * Extension paths (documented, not built): accounts become `(source, username)`
 * pairs when a second platform lands; `source` then becomes a second axis shown
 * side-by-side, never pooled. See `docs/review.md`.
 */
import type { Side } from '$lib/chess/types';
import type { MoveClass } from '../classify';

/** chess.com-style time classes, in display order. `timeClass` is a free string
 *  on `ReviewGame`; this is the known set we order and label by. */
export const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'] as const;

/** Game phase, by half-move index. A crude-but-honest heuristic (no material
 *  count): see `PHASE_BOUNDS`. */
export type Phase = 'opening' | 'middlegame' | 'endgame';

/** Outcome from the person's perspective. */
export type Outcome = 'win' | 'loss' | 'draw';

/** Win / draw / loss tally. */
export type Record = { win: number; draw: number; loss: number };

/** One of the person's half-moves, enriched with whatever analysis exists. */
export type PerspectiveMove = {
	ply: number;
	phase: Phase;
	/** Standard algebraic notation, e.g. "Qxf2". */
	san: string;
	/** Present only when the game has been analyzed. */
	classification?: MoveClass;
	/** My win-% entering the move (mover POV = my POV) — analyzed games only. */
	winBefore?: number;
	/** My win-% after the move — analyzed games only. */
	winAfter?: number;
	/** Win-% conceded (`winBefore - winAfter`, >= 0) — analyzed games only. */
	winDrop?: number;
	/** Material lead in points (my POV) entering the move — context, every game. */
	materialLeadBefore: number;
	/** Remaining clock after the move (ms), from the PGN when present. */
	clockMs?: number;
	/** Time spent on this move (ms), prev-same-side clock minus this one,
	 *  clamped >= 0 (ignores increment — an approximation). */
	msSpent?: number;
};

/** A finished game viewed from the person's side. The unit every reducer folds. */
export type PerspectiveGame = {
	source: string;
	gameId: string;
	url?: string;
	playedAt: Date;
	timeClass: string;
	opening?: string;
	eco?: string;
	termination: string;
	side: Side;
	outcome: Outcome;
	opponent: string;
	myRating?: number;
	opponentRating?: number;
	analyzed: boolean;
	/** My-side accuracy %, analyzed games only. */
	accuracy?: number;
	/** Highest win-% I reached at any point (my POV), analyzed games only. */
	peakWin?: number;
	/** My-POV win-% at every position (length = total plies + 1), analyzed games
	 *  only. The full game shape — drives the winnable-loss sparkline. */
	winTimeline?: number[];
	/** Most material I was ever up in the game (points, my POV). Context only. */
	maxMaterialLead: number;
	/** My half-moves only. */
	moves: PerspectiveMove[];
};

/** A point in a per-game chronological trend. */
export type TrendPoint = {
	source: string;
	gameId: string;
	playedAt: Date;
	value: number;
};

/** One of my analyzed moves carried into the winnable-loss analysis. Enough for
 *  the client to re-tier reactively as the levers (winning floor, sustain) move. */
export type WinnableMove = {
	ply: number;
	moveNumber: number;
	san: string;
	classification: MoveClass;
	/** My win-% entering / leaving the move (my POV). */
	winBefore: number;
	winAfter: number;
	phase: Phase;
	/** Material lead (points, my POV) entering the move — context. */
	materialLeadBefore: number;
};

/** A non-won, analyzed game in which I was *ever* clearly winning — the raw
 *  material the winnable-loss page tiers client-side. "Winnable" is decided by
 *  the levers (`classifyWinnable` in `winnable.ts`), not baked in here: a deep
 *  one-ply engine spike (mate-in-12) is a candidate but fails the sustain gate. */
export type WinnableCandidate = {
	source: string;
	gameId: string;
	url?: string;
	playedAt: Date;
	opponent: string;
	/** The side I played — for orienting the replay board on a deep link. */
	side: Side;
	outcome: 'loss' | 'draw';
	/** Highest win-% I reached (my POV). */
	peakWin: number;
	/** Most material I was ever up (points, my POV) — context badge, not a gate. */
	maxMaterialLead: number;
	/** My-POV win-% per position (length = total plies + 1), for the sparkline. */
	winTimeline: number[];
	/** My analyzed moves, in order. */
	myMoves: WinnableMove[];
};

/** One of the person's own blunders, fully joined for the board-centric blunder
 *  trainer (`/review/blunders`). Carries both sides of the move (raw FENs from the
 *  game) plus the engine's better move and the my-POV win-% swing. Unlike the stats
 *  dashboard, blunders are pooled across time classes — a blunder is a blunder, and
 *  the trainer wants volume + continuity (the "never pool" rule is about accuracy
 *  being apples-to-oranges, which doesn't apply here). */
export type BlunderEntry = {
	source: string;
	gameId: string;
	url?: string;
	playedAt: Date;
	opponent: string;
	/** The side I played — for orienting the board + deep-linking the replay. */
	side: Side;
	timeClass: string;
	opening?: string;
	/** 1-based half-move index of the blunder. */
	ply: number;
	/** 1-based full-move number (`ceil(ply / 2)`). */
	moveNumber: number;
	/** The move I played, SAN + UCI. */
	san: string;
	uci: string;
	/** Decision position (before my move) and its consequence (after). */
	fenBefore: string;
	fenAfter: string;
	/** The engine's better move at the decision position. */
	bestMoveSan: string;
	bestMoveUci: string;
	/** My win-% entering / leaving the move (mover POV = my POV). */
	winBefore: number;
	winAfter: number;
	/** How far below my *previously-held* win-% this move left me (`sustainedLoss`
	 *  in `robustness.ts`). This is the queue's primary sort key, not the raw
	 *  `winBefore - winAfter` drop: it strips out advantage that only spiked on the
	 *  opponent's move (an engine-only line I never held), so a deep tactic I merely
	 *  failed to find doesn't dishonestly top the list ahead of a real own-blunder. */
	sustainedLoss: number;
	phase: Phase;
	/** Seeded by the loader from the explanation cache, when one exists — lets a
	 *  revisit render instantly with zero engine cost. */
	cachedExplanation?: string;
};

/** Everything we show for one time class. Cheap stats (record, rating, openings,
 *  matchups, terminations) cover every game; analysis-derived stats (accuracy,
 *  blunders, move classes, thrown-away) cover analyzed games only. */
export type ReviewStats = {
	timeClass: string;
	totalGames: number;
	analyzedGames: number;
	record: Record;
	winRate: number;
	avgAccuracy: number | null;
	accuracyTrend: TrendPoint[];
	avgBlundersPerGame: number | null;
	blunderTrend: TrendPoint[];
	ratingTrend: TrendPoint[];
	moveClasses: { class: MoveClass; count: number }[];
	blundersByPhase: { phase: Phase; count: number }[];
	timeVsQuality: { bucket: string; sample: number; slipRate: number }[];
	byColor: {
		side: Side;
		games: number;
		record: Record;
		winRate: number;
		accuracy: number | null;
	}[];
	byOpening: { opening: string; games: number; winRate: number; accuracy: number | null }[];
	byRatingBand: { band: RatingBand; games: number; winRate: number }[];
	terminations: { method: string; count: number }[];
	/** Non-won games I was ever clearly winning in. Tiered client-side by the
	 *  winnable-loss levers; see `winnable.ts`. */
	winnable: WinnableCandidate[];
};

/** Opponent strength relative to me. */
export type RatingBand = 'weaker' | 'even' | 'stronger' | 'unknown';
