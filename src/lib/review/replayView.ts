/**
 * Pure derivations shared by the two board-replay routes (the review board and
 * the coach board): the per-ply analysis index, the white-POV eval-bar value,
 * the best-move arrow, the move-dot colour, and the current move. The win-%
 * sign-flip (per-move win%s are mover-POV; the bar is white-POV) is subtle and
 * easy to get wrong — keeping it in one place stops the two boards from drifting.
 */
import { uciSquares, type GameAnalysis, type MoveAnalysis } from './analysis';
import { CLASS_COLOR } from './charts/palette';
import type { Square } from '$lib/chess/types';

/** Analysis moves indexed by ply, for O(1) lookup while stepping the board. */
export function indexByPly(analysis: GameAnalysis | null): Record<number, MoveAnalysis> {
	const m: Record<number, MoveAnalysis> = {};
	if (analysis) for (const x of analysis.moves) m[x.ply] = x;
	return m;
}

/** White-POV win% at `ply` for the eval bar (per-move win%s are mover-POV, so a
 *  black move's winAfter is flipped back to white's perspective). */
export function whiteWinAt(
	analysis: GameAnalysis | null,
	byPly: Record<number, MoveAnalysis>,
	ply: number
): number | null {
	if (!analysis) return null;
	if (ply === 0) return analysis.moves[0]?.winBefore ?? 50;
	const m = byPly[ply];
	if (!m) return null;
	return m.color === 'w' ? m.winAfter : 100 - m.winAfter;
}

/** The better move for the move just played, as board squares, or null. */
export function bestArrowAt(
	byPly: Record<number, MoveAnalysis>,
	ply: number
): { from: Square; to: Square } | null {
	const m = byPly[ply];
	return m?.bestMoveUci ? uciSquares(m.bestMoveUci) : null;
}

/** Classification colour for the move at ply `p`, for the move-list dots. */
export function dotColorAt(byPly: Record<number, MoveAnalysis>, p: number): string | null {
	const m = byPly[p];
	return m ? CLASS_COLOR[m.classification] : null;
}

/** The current move's analysis joined with its SAN, or null at the start / when
 *  the game isn't analysed. */
export function currentMoveAt(
	byPly: Record<number, MoveAnalysis>,
	moves: { san: string }[],
	ply: number
): (MoveAnalysis & { san: string }) | null {
	if (ply < 1) return null;
	const m = byPly[ply];
	if (!m) return null;
	return { ...m, san: moves[ply - 1]?.san ?? '' };
}
