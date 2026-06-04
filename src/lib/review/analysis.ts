/**
 * Game analysis: turn a sequence of per-position engine evals into per-move
 * classifications + accuracy. Pure — the engine pass that produces the evals
 * lives in `src/lib/client/reviewAnalysis.ts` (browser Stockfish). Keeping the
 * math here means it's testable without an engine.
 */
import type { Side, Square } from '$lib/chess/types';
import type { EngineEval } from '$lib/engine/engine';
import type { ReviewMove, ReviewSource } from './types';
import { winPercent } from './winPercent';
import { classifyMove, type MoveClass } from './classify';
import { gameAccuracy } from './accuracy';

export type MoveAnalysis = {
	ply: number;
	color: Side;
	/** Centipawn eval before the move, from the mover's POV (= best play). */
	cpBefore: number;
	/** Centipawn eval after the move, from the mover's POV. */
	cpAfter: number;
	winBefore: number;
	winAfter: number;
	/** Win-% conceded (>= 0). */
	delta: number;
	classification: MoveClass;
	bestMoveUci: string;
	bestMoveSan: string;
	/** Principal variation (UCI) of the engine's best line — filled in slice 3. */
	pv?: string[];
};

export type GameAnalysis = {
	source: ReviewSource;
	gameId: string;
	depth: number;
	analyzedAt: string;
	moves: MoveAnalysis[];
	accuracy: { white: number; black: number };
};

/**
 * What the browser POSTs to `/api/review/analyze`: the raw engine evals plus the
 * game identity, NOT the derived analysis. The server re-runs `buildAnalysis`
 * against its own stored game moves so the classification/accuracy layer is
 * authenticated — only the engine numbers (`cp`/`bestMove`/`pv`) are trusted, the
 * same trust boundary the explain route uses.
 */
export type AnalyzeRequest = {
	source: ReviewSource;
	gameId: string;
	depth: number;
	evals: EngineEval[];
};

/**
 * `evals[k]` is the engine eval of the position *before* move `k+1` (i.e.
 * `moves[k].fenBefore`) for `k` in `0..n-1`, plus `evals[n]` for the final
 * position after the last move. So `evals.length === moves.length + 1`, and
 * each eval's `cp` is from that position's side-to-move POV. This lets us reuse
 * one eval as both "after move k" and "before move k+1".
 */
export function buildAnalysis(args: {
	source: ReviewSource;
	gameId: string;
	depth: number;
	moves: ReviewMove[];
	evals: EngineEval[];
}): GameAnalysis {
	const { moves, evals } = args;
	if (evals.length !== moves.length + 1) {
		throw new Error(`buildAnalysis: expected ${moves.length + 1} evals, got ${evals.length}`);
	}

	const analyzed: MoveAnalysis[] = moves.map((m, j) => {
		const cpBefore = evals[j].cp; // mover is side-to-move at fenBefore
		const cpAfter = -evals[j + 1].cp; // next position is the opponent's POV; flip
		const winBefore = winPercent(cpBefore);
		const winAfter = winPercent(cpAfter);
		const delta = Math.max(0, winBefore - winAfter);
		return {
			ply: m.ply,
			color: m.color,
			cpBefore,
			cpAfter,
			winBefore,
			winAfter,
			delta,
			classification: classifyMove({ delta, isBest: m.uci === evals[j].bestMoveUci }),
			bestMoveUci: evals[j].bestMoveUci,
			bestMoveSan: evals[j].bestMoveSan
		};
	});

	// White-POV win-% of every position, for the volatility weighting. `evals[k].cp`
	// is the side-to-move POV; flip when Black is to move. Side-to-move at position
	// k is `moves[k].color` (and the opposite of the last mover at the final one).
	const lastMover = moves[moves.length - 1].color;
	const winPercents = evals.map((e, k) => {
		const sideToMove = k < moves.length ? moves[k].color : lastMover === 'w' ? 'b' : 'w';
		const wp = winPercent(e.cp);
		return sideToMove === 'w' ? wp : 100 - wp;
	});

	return {
		source: args.source,
		gameId: args.gameId,
		depth: args.depth,
		analyzedAt: new Date().toISOString(),
		moves: analyzed,
		accuracy: gameAccuracy({
			winPercents,
			colors: moves.map((m) => m.color),
			deltas: analyzed.map((m) => m.delta)
		})
	};
}

/** From-square / to-square of a UCI move, for board overlays. */
export function uciSquares(uci: string): { from: Square; to: Square } {
	return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}
