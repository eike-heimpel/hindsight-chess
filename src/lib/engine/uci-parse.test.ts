import { describe, it, expect } from 'vitest';
import { MATE_SCORE_BASE } from './engine';
import { parseScore, parseDepth, parseMultipv, parsePv } from './uci-parse';

describe('parseScore', () => {
	it('reads cp and mate (signed)', () => {
		expect(parseScore('info depth 16 score cp -42 pv e2e4')).toBe(-42);
		expect(parseScore('info depth 16 score mate 3 pv e2e4')).toBe(MATE_SCORE_BASE - 3);
		expect(parseScore('info depth 16 score mate -2 pv e2e4')).toBe(-(MATE_SCORE_BASE - 2));
	});
});

describe('parseMultipv', () => {
	it('reads the index, defaulting to 1 when absent', () => {
		expect(parseMultipv('info depth 16 multipv 2 score cp 10 pv g1f3')).toBe(2);
		expect(parseMultipv('info depth 16 score cp 10 pv g1f3')).toBe(1);
	});
});

describe('parsePv', () => {
	it('extracts the UCI line after pv and caps length', () => {
		const line = 'info depth 20 multipv 1 score cp 31 pv e2e4 e7e5 g1f3 b8c6';
		expect(parsePv(line)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
		expect(parsePv(line, 2)).toEqual(['e2e4', 'e7e5']);
	});

	it('handles promotion moves and a missing pv', () => {
		expect(parsePv('info depth 12 score mate 1 pv e7e8q')).toEqual(['e7e8q']);
		expect(parsePv('info depth 1 score cp 0 nodes 20')).toEqual([]);
	});
});

describe('parseDepth', () => {
	it('reads the reached depth', () => {
		expect(parseDepth('info depth 18 multipv 1 score cp 5 pv e2e4')).toBe(18);
		expect(parseDepth('info string no depth here')).toBeNull();
	});
});
