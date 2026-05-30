/**
 * Resolve a stored game (+ its analysis, if any) into the person's perspective:
 * which side they played, the outcome, and their own moves enriched with
 * classification / clock / phase. This is the single transform every stat builds
 * on — keep it the only place that reasons about "me" vs "opponent".
 */
import type { Side } from '$lib/chess/types';
import type { GameAnalysis, MoveAnalysis } from '../analysis';
import type { ReviewGame } from '../types';
import { materialLead } from '../material';
import type { Outcome, Phase, PerspectiveGame, PerspectiveMove } from './types';

/** Half-move bounds for the phase heuristic (no material count — a knob). */
export const PHASE_BOUNDS = { openingMaxPly: 20, middlegameMaxPly: 60 } as const;

export function phaseOf(ply: number): Phase {
	if (ply <= PHASE_BOUNDS.openingMaxPly) return 'opening';
	if (ply <= PHASE_BOUNDS.middlegameMaxPly) return 'middlegame';
	return 'endgame';
}

/** Which side, if any, the person played. White wins ties (self-games). */
export function sideFor(game: ReviewGame, accounts: Set<string>): Side | null {
	if (accounts.has(game.white.username.toLowerCase())) return 'w';
	if (accounts.has(game.black.username.toLowerCase())) return 'b';
	return null;
}

function outcomeFor(game: ReviewGame, side: Side): Outcome {
	if (game.result === '1/2-1/2') return 'draw';
	const whiteWon = game.result === '1-0';
	return (side === 'w') === whiteWon ? 'win' : 'loss';
}

/** White-POV win-% at every position (length = analysis.moves + 1), rebuilt from
 *  the mover-POV per-move win-%s. Mirrors the timeline `analysis.ts` derives for
 *  accuracy weighting, but here we keep it to find the person's peak. */
function whitePovTimeline(moves: MoveAnalysis[]): number[] {
	const out = moves.map((m) => (m.color === 'w' ? m.winBefore : 100 - m.winBefore));
	const last = moves[moves.length - 1];
	out.push(last.color === 'w' ? last.winAfter : 100 - last.winAfter);
	return out;
}

/** My-POV win-% at every position (length = analysis.moves + 1). */
function myWinTimeline(analysis: GameAnalysis, side: Side): number[] {
	const timeline = whitePovTimeline(analysis.moves);
	return side === 'w' ? timeline : timeline.map((w) => 100 - w);
}

/**
 * My-POV recap overlay from a freshly-computed analysis — the fields the home
 * card animates in after a just-finished browser analysis. Pure, browser-safe
 * (only chess/analysis types), so the client can call it without re-running
 * `toPerspective` (which also needs the full game). Mirrors the `peakWin` /
 * `accuracy` / `winTimeline` picks `toPerspective` makes.
 */
export function recapOverlayFrom(
	analysis: GameAnalysis,
	side: Side
): { spark: number[]; accuracy: number; peakWin: number } {
	const spark = myWinTimeline(analysis, side);
	return {
		spark,
		accuracy: side === 'w' ? analysis.accuracy.white : analysis.accuracy.black,
		peakWin: Math.max(...spark)
	};
}

/** My half-moves, enriched. `msSpent` needs the previous same-side clock, so we
 *  walk my moves in order and diff consecutive clocks. */
function myMoves(game: ReviewGame, side: Side, analysis: GameAnalysis | null): PerspectiveMove[] {
	const byPly = new Map<number, MoveAnalysis>();
	if (analysis) for (const m of analysis.moves) byPly.set(m.ply, m);

	const out: PerspectiveMove[] = [];
	let prevClock: number | undefined;
	for (const m of game.moves) {
		if (m.color !== side) continue;
		const a = byPly.get(m.ply);
		const msSpent =
			prevClock != null && m.clockMs != null ? Math.max(0, prevClock - m.clockMs) : undefined;
		out.push({
			ply: m.ply,
			phase: phaseOf(m.ply),
			san: m.san,
			classification: a?.classification,
			winBefore: a?.winBefore,
			winAfter: a?.winAfter,
			winDrop: a?.delta,
			materialLeadBefore: materialLead(m.fenBefore, side),
			clockMs: m.clockMs,
			msSpent
		});
		if (m.clockMs != null) prevClock = m.clockMs;
	}
	return out;
}

/** Most material I was ever up across my moves (points, my POV). Computed from
 *  FENs, so it's available whether or not the game has been analyzed. */
function maxMaterialLeadFor(game: ReviewGame, side: Side): number {
	let max = -Infinity;
	for (const m of game.moves) {
		if (m.color !== side) continue;
		max = Math.max(max, materialLead(m.fenAfter, side));
	}
	return Number.isFinite(max) ? max : 0;
}

/** Returns null when the person didn't play in this game (shouldn't happen for a
 *  correctly-linked account — caller filters). */
export function toPerspective(
	game: ReviewGame,
	analysis: GameAnalysis | null,
	accounts: Set<string>
): PerspectiveGame | null {
	const side = sideFor(game, accounts);
	if (!side) return null;

	const me = side === 'w' ? game.white : game.black;
	const opp = side === 'w' ? game.black : game.white;

	const timeline = analysis ? myWinTimeline(analysis, side) : undefined;

	return {
		source: game.source,
		gameId: game.gameId,
		url: game.url,
		playedAt: game.playedAt,
		timeClass: game.timeClass,
		opening: game.opening,
		eco: game.eco,
		termination: game.termination,
		side,
		outcome: outcomeFor(game, side),
		opponent: opp.username,
		myRating: me.rating,
		opponentRating: opp.rating,
		analyzed: analysis != null,
		accuracy: analysis
			? side === 'w'
				? analysis.accuracy.white
				: analysis.accuracy.black
			: undefined,
		peakWin: timeline ? Math.max(...timeline) : undefined,
		winTimeline: timeline,
		maxMaterialLead: maxMaterialLeadFor(game, side),
		moves: myMoves(game, side, analysis)
	};
}
