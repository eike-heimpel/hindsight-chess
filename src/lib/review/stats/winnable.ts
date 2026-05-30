/**
 * Winnable-loss analysis — the honest answer to "I was winning and lost; was it
 * a real chance I blew, or engine-vision I never had?"
 *
 * The discriminator is *robustness*, not material (this is the adult review tool;
 * material-counting would be a beginner crutch — see `docs/review.md`):
 *
 *  - A **mate-in-12 / deep-tactic spike** is winning for a single ply, at the tip
 *    of a forced only-move line. You never held it. → fails the sustain gate.
 *  - A **real winnable position** stays winning across several of your own moves.
 *    There's slack; reasonable moves keep it. → clears the sustain gate.
 *
 * So a candidate qualifies when your win-% was ≥ `floor` for a *sustained* run of
 * your own moves and you then conceded it. The "give-back" is your single biggest
 * win-% drop in that winning zone; its classification splits a coachable own-
 * blunder ('thrown') from getting out-resourced ('outplayed').
 *
 * Pure + lever-driven: `buildCandidate` ships the raw facts; `classifyWinnable`
 * applies the page's live levers (floor / sustain / optional material edge), so
 * re-tiering as a slider moves is a client-side recompute, not a round trip.
 */
import type { MoveClass } from '../classify';
import { longestRunAtOrAbove } from './robustness';
import type { PerspectiveGame, WinnableCandidate, WinnableMove } from './types';

/** Lowest win-% the page lets you call "clearly winning" — also the cutoff for a
 *  game to be a candidate at all (a game never this winning can't qualify at any
 *  lever setting). */
export const CANDIDATE_FLOOR = 70;

/** Lever defaults. */
export const WINNING_FLOOR_DEFAULT = 80;
export const SUSTAIN_DEFAULT = 3;

/** Build the raw winnable-loss candidate for one game, or null if it doesn't
 *  apply (won, not analyzed, or never reached `CANDIDATE_FLOOR`). */
export function buildCandidate(game: PerspectiveGame): WinnableCandidate | null {
	if (game.outcome === 'win') return null;
	if (!game.analyzed || !game.winTimeline || game.peakWin == null) return null;
	if (game.peakWin < CANDIDATE_FLOOR) return null;

	const myMoves: WinnableMove[] = game.moves
		.filter((m) => m.classification != null && m.winBefore != null && m.winAfter != null)
		.map((m) => ({
			ply: m.ply,
			moveNumber: Math.ceil(m.ply / 2),
			san: m.san,
			classification: m.classification!,
			winBefore: m.winBefore!,
			winAfter: m.winAfter!,
			phase: m.phase,
			materialLeadBefore: m.materialLeadBefore
		}));

	return {
		source: game.source,
		gameId: game.gameId,
		url: game.url,
		playedAt: game.playedAt,
		opponent: game.opponent,
		side: game.side,
		outcome: game.outcome,
		peakWin: game.peakWin,
		maxMaterialLead: game.maxMaterialLead,
		winTimeline: game.winTimeline,
		myMoves
	};
}

export type WinnableTier = 'thrown' | 'outplayed';

export type WinnableOpts = {
	/** Win-% that counts as "clearly winning". */
	floor: number;
	/** Minimum run of my consecutive moves at/above `floor` to count as "held". */
	sustain: number;
	/** When set, also require I was up at least this many points of material. */
	materialMin?: number;
};

export type GiveBack = WinnableMove & { drop: number };

export type WinnableVerdict = {
	/** Passed all the active levers — a loss worth reviewing. */
	qualifies: boolean;
	/** Longest run of my consecutive moves entering at/above `floor`. */
	sustainedRun: number;
	/** My biggest win-% drop inside the winning zone, or null if I never moved
	 *  while at/above `floor`. */
	giveBack: GiveBack | null;
	/** 'thrown' = the give-back was my mistake/blunder; 'outplayed' = a smaller
	 *  slip / gradual erosion (opponent earned it). */
	tier: WinnableTier;
};

const COACHABLE: ReadonlySet<MoveClass> = new Set<MoveClass>(['mistake', 'blunder']);

/** Apply the live levers to a candidate. Pure — the page calls this per candidate
 *  whenever a slider moves. */
export function classifyWinnable(c: WinnableCandidate, opts: WinnableOpts): WinnableVerdict {
	const { floor, sustain } = opts;

	const sustainedRun = longestRunAtOrAbove(
		c.myMoves.map((m) => m.winBefore),
		floor
	);

	// The give-back is my biggest win-% drop among the moves I entered while at or
	// above the floor — the single move where the held advantage was conceded.
	let giveBack: GiveBack | null = null;
	for (const m of c.myMoves) {
		if (m.winBefore < floor) continue;
		const drop = Math.max(0, m.winBefore - m.winAfter);
		if (!giveBack || drop > giveBack.drop) giveBack = { ...m, drop };
	}

	const materialOk = opts.materialMin == null || c.maxMaterialLead >= opts.materialMin;
	const qualifies = sustainedRun >= sustain && giveBack != null && materialOk;
	const tier: WinnableTier =
		giveBack && COACHABLE.has(giveBack.classification) ? 'thrown' : 'outplayed';

	return { qualifies, sustainedRun, giveBack, tier };
}
