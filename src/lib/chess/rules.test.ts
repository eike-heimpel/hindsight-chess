import { describe, it, expect } from 'vitest';
import { describeMove } from './rules';

describe('describeMove — board-diff facts', () => {
	it('f5-style: a pawn that moves to defend an own pawn lists it in nowDefends and not hanging', () => {
		// Black has pawns on e4 and f7; White knight on f3 attacks e4. Black plays
		// ...f5, putting a pawn on f5 that DEFENDS e4. e4 must then be defended and
		// must NOT appear as hanging. (Black to move.)
		const fen = '4k3/5p2/8/8/4p3/5N2/8/4K3 b - - 0 1';
		const facts = describeMove(fen, 'f7f5');

		expect(facts.san).toBe('f5');
		expect(facts.nowDefends).toContainEqual({ pieceDe: 'Bauer', square: 'e4' });
		expect(facts.hangingAfter.some((h) => h.square === 'e4')).toBe(false);
	});

	it('lists enemy pieces the moved piece now attacks', () => {
		// White bishop on c1 plays Bf4, attacking the black knight on b8 along the
		// f4–b8 diagonal. (White to move.)
		const fen = '1n2k3/8/8/8/8/8/8/2B1K3 w - - 0 1';
		const facts = describeMove(fen, 'c1f4');
		expect(facts.nowAttacks).toContainEqual({ pieceDe: 'Springer', square: 'b8' });
	});

	it('flags a truly hanging mover piece (attacked, zero defenders)', () => {
		// White bishop on h8 is attacked by the black rook on h2 and has no defender.
		// White plays a quiet pawn move; the bishop stays hanging. (White to move.)
		const fen = '4k2B/8/8/8/8/8/P6r/4K3 w - - 0 1';
		const facts = describeMove(fen, 'a2a3');
		const hung = facts.hangingAfter.find((h) => h.square === 'h8');
		expect(hung).toBeDefined();
		expect(hung!.pieceDe).toBe('Läufer');
		expect(hung!.attackers).toContainEqual({ pieceDe: 'Turm', square: 'h2' });
		expect(hung!.defenders).toEqual([]);
	});
});
