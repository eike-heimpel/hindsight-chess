/**
 * Collect the person's own blunders across their analyzed games into a flat,
 * board-ready queue — the data behind the blunder trainer (`/review/blunders`).
 *
 * Pure (no engine/Mongo), same input shape as `computeReviewStats`. Each entry
 * joins three sources: the raw game move (for the FENs, which aren't on
 * `PerspectiveMove`), the `MoveAnalysis` at that ply (best move + win-% swing,
 * already my-POV since mover POV = my POV for my own moves), and game-level
 * context.
 *
 * Sorted by `sustainedLoss` (not the raw win-% drop): how far below my
 * previously-held win-% the move left me. This down-ranks engine spikes — a deep
 * tactic that materialised on the opponent's move and that I merely failed to
 * find — so the queue leads with blunders I could realistically have avoided.
 * See `robustness.ts`.
 *
 * Time classes are deliberately *not* segmented here — see `BlunderEntry`.
 */
import type { GameAnalysis } from '../analysis';
import type { ReviewGame } from '../types';
import { sideFor, phaseOf } from './perspective';
import { sustainedLoss } from './robustness';
import type { BlunderEntry } from './types';

const analysisKey = (source: string, gameId: string) => `${source}:${gameId}`;

export function collectBlunders(args: {
	games: ReviewGame[];
	analyses: Map<string, GameAnalysis>;
	accounts: Set<string>;
}): BlunderEntry[] {
	const { games, analyses, accounts } = args;
	const entries: BlunderEntry[] = [];

	for (const game of games) {
		const side = sideFor(game, accounts);
		if (!side) continue;
		const analysis = analyses.get(analysisKey(game.source, game.gameId));
		if (!analysis) continue;

		const opponent = side === 'w' ? game.black.username : game.white.username;

		// Walk my moves in order so each blunder knows my previous move's resulting
		// win-% (the level I'd actually held entering this one).
		let prevWinAfter: number | undefined;
		for (const a of analysis.moves) {
			if (a.color !== side) continue;
			if (a.classification === 'blunder') {
				const move = game.moves[a.ply - 1];
				if (move) {
					entries.push({
						source: game.source,
						gameId: game.gameId,
						url: game.url,
						playedAt: game.playedAt,
						opponent,
						side,
						timeClass: game.timeClass,
						opening: game.opening,
						ply: a.ply,
						moveNumber: Math.ceil(a.ply / 2),
						san: move.san,
						uci: move.uci,
						fenBefore: move.fenBefore,
						fenAfter: move.fenAfter,
						bestMoveSan: a.bestMoveSan,
						bestMoveUci: a.bestMoveUci,
						winBefore: a.winBefore,
						winAfter: a.winAfter,
						sustainedLoss: sustainedLoss({
							winBefore: a.winBefore,
							winAfter: a.winAfter,
							prevWinAfter
						}),
						phase: phaseOf(a.ply)
					});
				}
			}
			prevWinAfter = a.winAfter;
		}
	}

	return entries.sort((x, y) => y.sustainedLoss - x.sustainedLoss);
}
