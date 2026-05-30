import { describe, it, expect } from 'vitest';
import { longestRunAtOrAbove, sustainedLoss } from './robustness';

describe('longestRunAtOrAbove', () => {
	it('finds the longest consecutive run at/above the floor', () => {
		expect(longestRunAtOrAbove([85, 86, 88, 30], 80)).toBe(3);
		expect(longestRunAtOrAbove([40, 95, 35], 80)).toBe(1); // lone spike
		expect(longestRunAtOrAbove([82, 70, 84, 85], 80)).toBe(2); // run resets at 70
		expect(longestRunAtOrAbove([], 80)).toBe(0);
	});
});

describe('sustainedLoss', () => {
	it('measures the drop below the previously-held level', () => {
		// Held 88% entering the move, ended at 30% → gave back 58.
		expect(sustainedLoss({ winBefore: 88, winAfter: 30, prevWinAfter: 88 })).toBe(58);
	});

	it('is ~0 for an engine spike I never held', () => {
		// Was at 28%, the position spiked to 99% on the opponent's move, I end at 30%.
		expect(sustainedLoss({ winBefore: 99, winAfter: 30, prevWinAfter: 28 })).toBe(0);
	});

	it('falls back to winBefore on my first move', () => {
		expect(sustainedLoss({ winBefore: 70, winAfter: 40 })).toBe(30);
	});
});
