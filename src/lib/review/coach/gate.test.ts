import { describe, it, expect } from 'vitest';
import { deterministicGate } from './gate';
import type { TurningPointFacts } from './types';

// Position after 1.e4 e5 — White to move, full-move 2. Nf3, Bc4, Qh5 etc. are legal.
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

function facts(over: Partial<TurningPointFacts> = {}): TurningPointFacts {
	return {
		ply: 3,
		moveNumber: 2,
		mover: 'White',
		playerColor: 'w',
		playerIsMover: true,
		kind: 'mistake',
		setup: null,
		playedSan: 'Qh5',
		bestSan: 'Nf3',
		isBest: false,
		classification: 'inaccuracy',
		winBefore: 55,
		winAfter: 50,
		winSecondBest: 52,
		evalPlayed: '+0.2',
		played: {
			pieceEn: 'queen',
			capturedEn: null,
			to: 'h5',
			givesCheck: false,
			isCheckmate: false,
			attackersOfTo: [],
			defendersOfTo: []
		},
		bestLineSan: 'Nf3 Nc6 Bb5',
		altLinesSan: ['Bc4 Nf6'],
		punishLineSan: 'Nc6',
		nature: { allowedMate: false, threwAwayWin: false, hangsMovedPiece: false },
		principles: [],
		opening: 'Open Game',
		resultForPlayer: 'win',
		...over
	};
}

describe('deterministicGate', () => {
	it('passes a message citing only moves that appear in the known lines', () => {
		const msg = 'Instead of Qh5, Nf3 develops and after Nc6 Bb5 you keep pressure.';
		expect(deterministicGate(msg, facts(), FEN)).toBeNull();
	});

	it('fails a move that is in no known line and not legal from the position', () => {
		// Rd8 is not in any line and not legal in this opening position.
		const v = deterministicGate('You should have tried Rd8 there.', facts(), FEN);
		expect(v).not.toBeNull();
		expect(v!.pass).toBe(false);
		expect(v!.reason).toContain('Rd8');
	});

	it('passes a legal-but-unmentioned move (defers to the LLM)', () => {
		// Bc4 is legal here but absent from the known lines; the gate should defer.
		expect(
			deterministicGate('What about Bc4 instead?', facts({ altLinesSan: [] }), FEN)
		).toBeNull();
	});

	it('normalizes + and # decorations against the known set', () => {
		// Bb5 is in bestLineSan; citing it with a check mark must still pass.
		expect(deterministicGate('Then Bb5+ pins the knight.', facts(), FEN)).toBeNull();
	});
});
