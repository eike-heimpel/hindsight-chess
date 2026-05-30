import { describe, it, expect } from 'vitest';
import { MATE_SCORE_BASE, type EngineEval } from '$lib/engine/engine';
import { buildAnalysis } from './analysis';
import { winPercent } from './winPercent';
import { classifyMove } from './classify';
import { moveAccuracy } from './accuracy';
import type { ReviewMove } from './types';

const ev = (cp: number, bestMoveUci = ''): EngineEval => ({
	cp,
	bestMoveUci,
	bestMoveSan: bestMoveUci,
	depth: 16
});

describe('winPercent', () => {
	it('is 50 at an equal eval and saturates at mate', () => {
		expect(winPercent(0)).toBe(50);
		expect(winPercent(MATE_SCORE_BASE)).toBe(100);
		expect(winPercent(-MATE_SCORE_BASE)).toBe(0);
	});

	it('is symmetric around 50 and monotonic', () => {
		expect(winPercent(-300)).toBeCloseTo(100 - winPercent(300), 6);
		expect(winPercent(300)).toBeGreaterThan(winPercent(50));
	});
});

describe('classifyMove', () => {
	it('buckets by win-% drop, and best move is always best', () => {
		expect(classifyMove({ delta: 0.5, isBest: false })).toBe('best');
		expect(classifyMove({ delta: 2, isBest: false })).toBe('good');
		expect(classifyMove({ delta: 5, isBest: false })).toBe('inaccuracy');
		expect(classifyMove({ delta: 10, isBest: false })).toBe('mistake');
		expect(classifyMove({ delta: 20, isBest: false })).toBe('blunder');
		expect(classifyMove({ delta: 99, isBest: true })).toBe('best');
	});
});

describe('moveAccuracy', () => {
	it('is ~100 for a perfect move and decreases with the drop', () => {
		expect(moveAccuracy(0)).toBeCloseTo(100, 1);
		expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(2));
	});
});

describe('buildAnalysis', () => {
	const moves: ReviewMove[] = [
		{ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', fenBefore: 'a', fenAfter: 'b' },
		{ ply: 2, color: 'b', san: 'e5', uci: 'e7e5', fenBefore: 'b', fenAfter: 'c' }
	];
	// White plays the engine's pick (best); Black plays a move that hands White +300 (blunder).
	const evals = [ev(20, 'e2e4'), ev(-20, 'd7d5'), ev(300, 'd2d4')];
	const analysis = buildAnalysis({ source: 'chesscom', gameId: 't', depth: 16, moves, evals });

	it('flags white best (played engine move, no win% drop)', () => {
		const w = analysis.moves[0];
		expect(w.classification).toBe('best');
		expect(w.delta).toBeCloseTo(0, 5);
		expect(w.cpBefore).toBe(20);
		expect(w.cpAfter).toBe(20); // -evals[1].cp
	});

	it('flags black blunder from the win% drop', () => {
		const b = analysis.moves[1];
		expect(b.cpBefore).toBe(-20);
		expect(b.cpAfter).toBe(-300); // -evals[2].cp
		expect(b.delta).toBeGreaterThan(15);
		expect(b.classification).toBe('blunder');
	});

	it('computes per-side accuracy (white ~perfect, black low)', () => {
		expect(analysis.accuracy.white).toBeCloseTo(100, 0);
		expect(analysis.accuracy.black).toBeLessThan(60);
	});

	it('throws when the eval count does not match moves+1', () => {
		expect(() =>
			buildAnalysis({ source: 'chesscom', gameId: 't', depth: 16, moves, evals: [ev(0)] })
		).toThrow();
	});
});
