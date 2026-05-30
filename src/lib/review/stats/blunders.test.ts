import { describe, it, expect } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../analysis';
import type { MoveClass } from '../classify';
import type { GameResult, ReviewGame, ReviewMove } from '../types';
import type { Side } from '$lib/chess/types';
import { collectBlunders } from './blunders';

let n = 0;

function game(opts: {
	white: string;
	black: string;
	result?: GameResult;
	timeClass?: string;
	/** [color, san, uci, fenBefore, fenAfter] per ply. */
	moves: { color: Side; san: string; uci: string; fenBefore: string; fenAfter: string }[];
}): ReviewGame {
	const id = `g${n++}`;
	const moves: ReviewMove[] = opts.moves.map((m, i) => ({
		ply: i + 1,
		color: m.color,
		san: m.san,
		uci: m.uci,
		fenBefore: m.fenBefore,
		fenAfter: m.fenAfter
	}));
	return {
		source: 'chesscom',
		gameId: id,
		playedAt: new Date('2026-01-01'),
		timeClass: opts.timeClass ?? 'rapid',
		timeControl: '600',
		white: { username: opts.white },
		black: { username: opts.black },
		result: opts.result ?? '0-1',
		termination: '',
		moves
	};
}

function analysis(
	g: ReviewGame,
	opts: { classes: MoveClass[]; winBefore: number[]; winAfter: number[] }
): GameAnalysis {
	const moves: MoveAnalysis[] = g.moves.map((m, i) => ({
		ply: m.ply,
		color: m.color,
		cpBefore: 0,
		cpAfter: 0,
		winBefore: opts.winBefore[i],
		winAfter: opts.winAfter[i],
		delta: Math.max(0, opts.winBefore[i] - opts.winAfter[i]),
		classification: opts.classes[i],
		bestMoveUci: `best${i}`,
		bestMoveSan: `B${i}`
	}));
	return {
		source: g.source,
		gameId: g.gameId,
		depth: 16,
		analyzedAt: '2026-01-01',
		moves,
		accuracy: { white: 90, black: 90 }
	};
}

const ME = new Set(['me']);

describe('collectBlunders', () => {
	it('returns only my-side blunders, joined with the right FENs and best move', () => {
		const g = game({
			white: 'me',
			black: 'foe',
			moves: [
				{ color: 'w', san: 'e4', uci: 'e2e4', fenBefore: 'fb1', fenAfter: 'fa1' },
				{ color: 'b', san: 'e5', uci: 'e7e5', fenBefore: 'fb2', fenAfter: 'fa2' },
				{ color: 'w', san: 'Qh5??', uci: 'd1h5', fenBefore: 'fb3', fenAfter: 'fa3' }
			]
		});
		const a = analysis(g, {
			// my move 1 = best, opponent move = blunder (must be ignored), my move 3 = blunder
			classes: ['best', 'blunder', 'blunder'],
			winBefore: [50, 50, 80],
			winAfter: [50, 50, 30]
		});
		const out = collectBlunders({
			games: [g],
			analyses: new Map([[`chesscom:${g.gameId}`, a]]),
			accounts: ME
		});
		expect(out).toHaveLength(1);
		const e = out[0];
		expect(e.ply).toBe(3);
		expect(e.moveNumber).toBe(2);
		expect(e.san).toBe('Qh5??');
		expect(e.uci).toBe('d1h5');
		expect(e.fenBefore).toBe('fb3');
		expect(e.fenAfter).toBe('fa3');
		expect(e.bestMoveSan).toBe('B2');
		expect(e.bestMoveUci).toBe('best2');
		expect(e.winBefore).toBe(80);
		expect(e.winAfter).toBe(30);
		// Held 50% after my move 1, ended at 30% → 20 lost, not the raw 80→30 = 50.
		expect(e.sustainedLoss).toBe(20);
		expect(e.side).toBe('w');
		expect(e.opponent).toBe('foe');
	});

	it('ranks a thrown advantage above an engine spike, not by raw drop', () => {
		const g = game({
			white: 'me',
			black: 'foe',
			moves: [
				{ color: 'w', san: 'a', uci: 'a2a3', fenBefore: 'b1', fenAfter: 'a1' },
				{ color: 'w', san: 'b', uci: 'b2b3', fenBefore: 'b2', fenAfter: 'a2' },
				{ color: 'w', san: 'c', uci: 'c2c3', fenBefore: 'b3', fenAfter: 'a3' },
				{ color: 'w', san: 'd', uci: 'd2d3', fenBefore: 'b4', fenAfter: 'a4' }
			]
		});
		const a = analysis(g, {
			// move 2: held 88% → 30% (thrown win, sustainedLoss 58).
			// move 4: 99% → 30% spiked from a held 28% (engine line I never had,
			//         raw drop 69 but sustainedLoss 0).
			classes: ['good', 'blunder', 'good', 'blunder'],
			winBefore: [90, 88, 28, 99],
			winAfter: [88, 30, 28, 30]
		});
		const out = collectBlunders({
			games: [g],
			analyses: new Map([[`chesscom:${g.gameId}`, a]]),
			accounts: ME
		});
		expect(out.map((e) => e.ply)).toEqual([2, 4]); // thrown win first, despite move 4's bigger raw drop
		expect(out[0].sustainedLoss).toBe(58);
		expect(out[1].sustainedLoss).toBe(0);
	});

	it('skips games with no analysis and games I did not play', () => {
		const mine = game({
			white: 'me',
			black: 'foe',
			moves: [{ color: 'w', san: 'a', uci: 'a2a3', fenBefore: 'b', fenAfter: 'a' }]
		});
		const notMine = game({
			white: 'x',
			black: 'y',
			moves: [{ color: 'w', san: 'a', uci: 'a2a3', fenBefore: 'b', fenAfter: 'a' }]
		});
		const a = analysis(notMine, { classes: ['blunder'], winBefore: [80], winAfter: [20] });
		const out = collectBlunders({
			games: [mine, notMine],
			// only notMine has analysis, but it isn't my game; mine has no analysis
			analyses: new Map([[`chesscom:${notMine.gameId}`, a]]),
			accounts: ME
		});
		expect(out).toHaveLength(0);
	});
});
