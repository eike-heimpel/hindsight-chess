import { describe, it, expect } from 'vitest';
import type { ReviewMove } from '$lib/review/types';
import type { Side } from '$lib/chess/types';
import { detectPrinciples } from './principles';

/** A white-to-move opening position with both knights still home (b1, g1). */
const KNIGHTS_HOME = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 5';
/** King still on e1, otherwise irrelevant pieces stripped. */
const KING_HOME = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 10';

function mv(ply: number, san: string, uci: string): ReviewMove {
	return {
		ply,
		color: (ply % 2 === 1 ? 'w' : 'b') as Side,
		san,
		uci,
		fenBefore: 'f',
		fenAfter: 'f'
	};
}

function ids(signals: { id: string }[]): string[] {
	return signals.map((s) => s.id);
}

describe('detectPrinciples', () => {
	it('flags an early queen sortie before minors are developed', () => {
		const moves = [mv(1, 'e4', 'e2e4'), mv(3, 'Qh5', 'd1h5')];
		const out = detectPrinciples({ moves, ply: 3, side: 'w', fenBefore: 'f', moveNumber: 2 });
		const eq = out.find((s) => s.id === 'early-queen');
		expect(eq).toBeDefined();
		expect(eq!.detail).toContain('move 2');
	});

	it('does not flag the queen when two minors are already developed', () => {
		const moves = [mv(1, 'Nf3', 'g1f3'), mv(3, 'Bc4', 'f1c4'), mv(5, 'Qe2', 'd1e2')];
		const out = detectPrinciples({ moves, ply: 5, side: 'w', fenBefore: 'f', moveNumber: 3 });
		expect(ids(out)).not.toContain('early-queen');
	});

	it('flags moving the same minor piece twice in the opening', () => {
		// Knight g1->f3 (ply 1), then f3->g5 (ply 3): same knight, count 2.
		const moves = [mv(1, 'Nf3', 'g1f3'), mv(3, 'Ng5', 'f3g5')];
		const out = detectPrinciples({ moves, ply: 3, side: 'w', fenBefore: 'f', moveNumber: 2 });
		const mt = out.find((s) => s.id === 'moved-twice');
		expect(mt).toBeDefined();
		expect(mt!.detail).toContain('knight');
		expect(mt!.detail).toContain('g5');
	});

	it('flags undeveloped minors still on the back rank', () => {
		const moves = [mv(1, 'e4', 'e2e4')];
		const out = detectPrinciples({
			moves,
			ply: 9,
			side: 'w',
			fenBefore: KNIGHTS_HOME,
			moveNumber: 8
		});
		const und = out.find((s) => s.id === 'undeveloped');
		expect(und).toBeDefined();
		expect(und!.detail).toContain('b1');
		expect(und!.detail).toContain('g1');
	});

	it('flags a king still uncastled by the early middlegame', () => {
		// Only pawn/minor moves so the king never moved and never castled.
		const moves = [mv(1, 'e4', 'e2e4'), mv(3, 'Nf3', 'g1f3'), mv(5, 'Nc3', 'b1c3')];
		const out = detectPrinciples({
			moves,
			ply: 19,
			side: 'w',
			fenBefore: KING_HOME,
			moveNumber: 10
		});
		const lc = out.find((s) => s.id === 'late-castle');
		expect(lc).toBeDefined();
		expect(lc!.detail).toContain('e1');
	});

	it('flags a king walk in the opening', () => {
		const moves = [mv(1, 'e4', 'e2e4'), mv(3, 'Ke2', 'e1e2')];
		const out = detectPrinciples({ moves, ply: 3, side: 'w', fenBefore: 'f', moveNumber: 2 });
		expect(ids(out)).toContain('king-wander');
	});

	it('returns no late-castle signal once the player has castled', () => {
		const moves = [
			mv(1, 'e4', 'e2e4'),
			mv(3, 'Nf3', 'g1f3'),
			mv(5, 'Bc4', 'f1c4'),
			mv(7, 'O-O', 'e1g1')
		];
		const out = detectPrinciples({
			moves,
			ply: 19,
			side: 'w',
			fenBefore: KING_HOME,
			moveNumber: 10
		});
		expect(ids(out)).not.toContain('late-castle');
	});
});
