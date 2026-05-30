import { describe, it, expect } from 'vitest';
import { templateHeadline } from './headlineTemplate.ts';
import type { PerspectiveGame } from './stats/types.ts';

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
		analyzed: false,
		maxMaterialLead: 0,
		moves: [],
		...over
	};
}

// Behaviour is intentionally identical to the old `headlineFor` in +page.server.ts.
describe('templateHeadline', () => {
	it('uses the un-analyzed copy when there is no win curve', () => {
		expect(templateHeadline(perspective({ outcome: 'win' }))).toBe(
			'A win over rival. See how you got there.'
		);
		expect(templateHeadline(perspective({ outcome: 'draw' }))).toBe(
			'A draw with rival. See how it played out.'
		);
		expect(templateHeadline(perspective({ outcome: 'loss' }))).toBe(
			"A loss to rival. Let's find where it turned."
		);
	});

	it('calls a dominant win wire-to-wire', () => {
		const p = perspective({
			outcome: 'win',
			analyzed: true,
			winTimeline: [60, 70, 80, 90],
			peakWin: 90
		});
		expect(templateHeadline(p)).toBe('Wire to wire — you stayed in control against rival.');
	});

	it('frames a win from a low point as a turnaround', () => {
		const p = perspective({
			outcome: 'win',
			analyzed: true,
			winTimeline: [50, 20, 60, 95],
			peakWin: 95
		});
		expect(templateHeadline(p)).toBe('You were in trouble — down to 20% — then turned it around.');
	});

	it('notes chances in a loss that peaked but stayed under the winning floor', () => {
		const p = perspective({
			outcome: 'loss',
			analyzed: true,
			winTimeline: [50, 65, 40, 10],
			peakWin: 65
		});
		expect(templateHeadline(p)).toBe(
			'You had your chances against rival — peaked at 65% — but it got away.'
		);
	});

	it('falls back to the "tough one" line when nothing stood out', () => {
		const p = perspective({
			outcome: 'loss',
			analyzed: true,
			winTimeline: [50, 45, 30, 10],
			peakWin: 50
		});
		expect(templateHeadline(p)).toBe("A tough one against rival. Let's find the moment it turned.");
	});
});
