import { describe, it, expect } from 'vitest';
import { materialBalance, materialLead } from './material';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('materialBalance', () => {
	it('is zero from the starting position', () => {
		expect(materialBalance('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(0);
	});

	it('counts white up a knight as +3', () => {
		// White has an extra knight (one black knight removed).
		expect(materialBalance('r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(3);
	});

	it('counts black up a rook as -5', () => {
		// White is missing a rook.
		expect(materialBalance('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1')).toBe(-5);
	});

	it('ignores kings (worth 0) and only reads the placement field', () => {
		expect(materialBalance(START)).toBe(0); // mirrored pawns/pieces cancel
		expect(materialBalance('8/8/8/8/8/8/8/K6k w - - 0 1')).toBe(0);
	});
});

describe('materialLead', () => {
	it('flips sign for the black side', () => {
		const fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // white +3
		expect(materialLead(fen, 'w')).toBe(3);
		expect(materialLead(fen, 'b')).toBe(-3);
	});
});
