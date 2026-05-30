import { describe, it, expect } from 'vitest';
import { withinWindow } from './recency';

describe('withinWindow', () => {
	const now = new Date('2026-05-30T00:00:00Z');
	const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

	it("'all' keeps everything, however old", () => {
		expect(withinWindow(daysAgo(10_000), 'all', now)).toBe(true);
	});

	it('keeps games on the near side of the cutoff, drops the far side', () => {
		expect(withinWindow(daysAgo(29), '30d', now)).toBe(true);
		expect(withinWindow(daysAgo(31), '30d', now)).toBe(false);
		expect(withinWindow(daysAgo(100), '90d', now)).toBe(false);
		expect(withinWindow(daysAgo(200), '6m', now)).toBe(false);
	});

	it('accepts a date string (playedAt may arrive serialized)', () => {
		expect(withinWindow(daysAgo(5).toISOString(), '30d', now)).toBe(true);
	});
});
