import { isCheckmate, isStalemate } from '$lib/chess/rules';
import { MATE_SCORE_BASE, type EngineEval } from '$lib/engine/engine';
import { buildAnalysis, type GameAnalysis } from '$lib/review/analysis';
import type { ReviewGame } from '$lib/review/types';
import { type Result, ok, err } from '$lib/result';
import { safeEvaluate } from './engine';

/**
 * Browser-side game analysis. Evaluates every position of a finished game once
 * with the local Stockfish (one Web Worker → sequential), then hands the evals
 * to the pure `buildAnalysis()`. The "one eval per position" trick: the eval of
 * the position after move k is the eval before move k+1, so an n-move game is
 * n+1 evals, not 2n.
 *
 * A fixed depth (not movetime) keeps a cached analysis reproducible. Terminal
 * final positions (checkmate / stalemate) have no engine move, so we synthesise
 * their eval rather than asking the engine.
 */
export const REVIEW_DEPTH = 16;

/** Shallow pass for the anonymous landing teaser: an order of magnitude faster
 *  than REVIEW_DEPTH, enough for a recognisable win-% arc. The real, persisted
 *  analysis after login always runs at REVIEW_DEPTH. */
export const LIGHT_DEPTH = 10;

export async function analyzeGame(
	game: ReviewGame,
	onProgress?: (done: number, total: number) => void,
	depth: number = REVIEW_DEPTH
): Promise<Result<GameAnalysis>> {
	const { moves } = game;
	if (moves.length === 0) return err('engine_failed', 'game has no moves to analyze');

	const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
	const evals: EngineEval[] = [];

	for (let k = 0; k < fens.length; k++) {
		const terminal = terminalEval(fens[k]);
		if (terminal) {
			evals.push(terminal);
		} else {
			const r = await safeEvaluate(fens[k], { depth });
			if (!r.ok) return err(r.error.kind, r.error.message);
			evals.push(r.value);
		}
		onProgress?.(k + 1, fens.length);
	}

	return ok(buildAnalysis({ source: game.source, gameId: game.gameId, depth, moves, evals }));
}

/** Engine returns no move for terminal positions; encode the outcome directly.
 *  Side-to-move POV: checkmate = lost (−mate), stalemate = drawn (0). */
function terminalEval(fen: string): EngineEval | null {
	if (isCheckmate(fen)) {
		return { cp: -MATE_SCORE_BASE, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	}
	if (isStalemate(fen)) {
		return { cp: 0, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	}
	return null;
}
