import { describe, it, expect } from 'vitest';
import { buildHeadlineFacts } from './headlineFacts.ts';
import type { PerspectiveGame, PerspectiveMove } from './stats/types.ts';

function perspective(over: Partial<PerspectiveGame>): PerspectiveGame {
	return {
		source: 'chesscom',
		gameId: 'g1',
		playedAt: new Date('2026-01-01'),
		timeClass: 'rapid',
		termination: 'resignation',
		side: 'w',
		outcome: 'loss',
		opponent: 'rival',
		analyzed: true,
		maxMaterialLead: 0,
		moves: [],
		...over
	};
}

function move(over: Partial<PerspectiveMove>): PerspectiveMove {
	return { ply: 1, phase: 'opening', san: 'e4', materialLeadBefore: 0, ...over };
}

describe('buildHeadlineFacts', () => {
	it('detects the largest reversals as swings, in move order', () => {
		// up to 90 (move 3), collapse to 20 (move 4), comeback to 80 (move 6).
		const timeline = [50, 50, 50, 90, 90, 90, 20, 20, 20, 80, 80, 80, 80];
		const facts = buildHeadlineFacts(perspective({ winTimeline: timeline }));
		expect(facts.swings).toEqual([
			{ moveNumber: 3, from: 50, to: 90 },
			{ moveNumber: 4, from: 90, to: 20 },
			{ moveNumber: 6, from: 20, to: 80 }
		]);
	});

	it('ignores reversals below the threshold', () => {
		// every step is small (<15) → no swings worth narrating.
		const facts = buildHeadlineFacts(perspective({ winTimeline: [50, 55, 48, 52, 49] }));
		expect(facts.swings).toEqual([]);
	});

	it('downsamples a long timeline to a handful of points, keeping both ends', () => {
		const timeline = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40
		const facts = buildHeadlineFacts(perspective({ winTimeline: timeline }));
		expect(facts.trajectory.length).toBeGreaterThanOrEqual(12);
		expect(facts.trajectory.length).toBeLessThanOrEqual(16);
		expect(facts.trajectory[0].winPct).toBe(1);
		expect(facts.trajectory.at(-1)!.winPct).toBe(40);
	});

	it('picks the costliest move as the biggest mistake', () => {
		const facts = buildHeadlineFacts(
			perspective({
				winTimeline: [50, 50],
				moves: [
					move({ ply: 5, san: 'Qh5', classification: 'blunder', winDrop: 30 }),
					move({ ply: 9, san: 'Nf3', classification: 'inaccuracy', winDrop: 8 })
				]
			})
		);
		expect(facts.biggestMistake).toEqual({
			moveNumber: 3,
			san: 'Qh5',
			classification: 'blunder',
			drop: 30
		});
	});

	it('has no biggest mistake when no move lost win chance', () => {
		const facts = buildHeadlineFacts(
			perspective({ winTimeline: [50, 50], moves: [move({ san: 'e4', winDrop: 0 })] })
		);
		expect(facts.biggestMistake).toBeNull();
	});

	it('carries through the recap fields', () => {
		const facts = buildHeadlineFacts(
			perspective({
				outcome: 'win',
				opponent: 'bob',
				opening: 'Italian Game',
				accuracy: 88,
				side: 'b',
				winTimeline: [50, 60]
			})
		);
		expect(facts).toMatchObject({
			outcome: 'win',
			opponent: 'bob',
			opening: 'Italian Game',
			accuracy: 88,
			side: 'b'
		});
	});
});
