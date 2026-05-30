import { describe, it, expect } from 'vitest';
import { windowTrend, recentMean } from './trend';

describe('windowTrend', () => {
	it('returns null below two minimum windows', () => {
		expect(windowTrend([1, 2, 3, 4, 5])).toBeNull(); // n=5 < 2*3
		expect(windowTrend([])).toBeNull();
	});

	it('compares recent third against first third', () => {
		// n=6, k=max(3, floor(6/3)=2)=3 → first [10,10,10], last [20,20,20]
		const t = windowTrend([10, 10, 10, 20, 20, 20]);
		expect(t).not.toBeNull();
		expect(t!.earlier).toBe(10);
		expect(t!.recent).toBe(20);
		expect(t!.delta).toBe(10);
	});

	it('dilutes a single outlier vs a raw endpoint comparison', () => {
		// One flukey low first game, then flat at 50. Raw last−first = +50 over-
		// states the rise; the windowed delta is the same sign but much smaller.
		const values = [0, 50, 50, 50, 50, 50, 50, 50, 50];
		const t = windowTrend(values)!;
		const rawEndpointDelta = values.at(-1)! - values[0];
		expect(t.delta).toBeGreaterThan(0);
		expect(t.delta).toBeLessThan(rawEndpointDelta);
	});

	it('ignores the unused middle of the series', () => {
		// n=9, k=3 → first three vs last three; the middle [0,0,0] is dropped.
		const t = windowTrend([4, 4, 4, 0, 0, 0, 8, 8, 8])!;
		expect(t.earlier).toBe(4);
		expect(t.recent).toBe(8);
	});
});

describe('recentMean', () => {
	it('averages the last `window` values', () => {
		expect(recentMean([10, 20, 30, 40, 50, 60], 3)).toBe(50); // (40+50+60)/3
	});

	it('uses the whole series when shorter than the window', () => {
		expect(recentMean([10, 20], 5)).toBe(15);
	});

	it('returns null for an empty series', () => {
		expect(recentMean([])).toBeNull();
	});
});
