import { describe, it, expect } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '$lib/review/analysis';
import type { MoveClass } from '$lib/review/classify';
import type { ReviewGame, ReviewMove } from '$lib/review/types';
import type { Side } from '$lib/chess/types';
import { selectTurningPoints } from './moments';

/** A move's analysis with the only fields the selector reads (color/ply/delta). */
function mv(ply: number, color: Side, delta: number): MoveAnalysis {
	return {
		ply,
		color,
		cpBefore: 0,
		cpAfter: 0,
		winBefore: 50,
		winAfter: 50,
		delta,
		classification: 'good' as MoveClass,
		bestMoveUci: 'e2e4',
		bestMoveSan: 'e4'
	};
}

function analysis(moves: MoveAnalysis[]): GameAnalysis {
	return {
		source: 'chesscom',
		gameId: 'g1',
		depth: 16,
		analyzedAt: '2026-01-01',
		moves,
		accuracy: { white: 90, black: 90 }
	};
}

/** A game whose move SANs are addressable by ply (for opportunity setup). */
function game(sans: string[]): ReviewGame {
	const moves: ReviewMove[] = sans.map((san, i) => ({
		ply: i + 1,
		color: (i % 2 === 0 ? 'w' : 'b') as Side,
		san,
		uci: 'e2e4',
		fenBefore: 'f',
		fenAfter: 'f'
	}));
	return {
		source: 'chesscom',
		gameId: 'g1',
		playedAt: new Date('2026-01-01'),
		timeClass: 'rapid',
		timeControl: '600',
		opening: undefined,
		white: { username: 'me' },
		black: { username: 'foe' },
		result: '1-0',
		termination: '',
		moves
	};
}

describe('selectTurningPoints', () => {
	it('flags a player move whose win-drop clears the mistake bar', () => {
		const a = analysis([mv(1, 'w', 2), mv(2, 'b', 0), mv(3, 'w', 10)]);
		const out = selectTurningPoints(a, game(['e4', 'e5', 'Qh5']), 'w');
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ ply: 3, kind: 'mistake', magnitude: 10, setup: null });
	});

	it('ignores a player drop below the mistake bar', () => {
		const a = analysis([mv(1, 'w', 7)]);
		// No move clears 8; falls back to the single worst own move.
		const out = selectTurningPoints(a, game(['e4']), 'w');
		expect(out).toEqual([{ ply: 1, kind: 'mistake', magnitude: 7, setup: null }]);
	});

	it('turns an opponent blunder into an opportunity on the player reply', () => {
		// Black (opp) blunders on ply 2 (>=12); the opportunity lands on white ply 3.
		const a = analysis([mv(1, 'w', 0), mv(2, 'b', 20), mv(3, 'w', 1)]);
		const out = selectTurningPoints(a, game(['e4', 'Qf6', 'Nc3']), 'w');
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			ply: 3,
			kind: 'opportunity',
			magnitude: 20,
			setup: { opponentBlunderSan: 'Qf6', opponentDropPct: 20 }
		});
	});

	it('does not open an opportunity when there is no player reply ply', () => {
		// Opp blunders on the last ply (2); no ply 3 exists to punish on.
		const a = analysis([mv(1, 'w', 0), mv(2, 'b', 20)]);
		const out = selectTurningPoints(a, game(['e4', 'Qf6']), 'w');
		// Falls back to the worst own move (ply 1, delta 0).
		expect(out).toEqual([{ ply: 1, kind: 'mistake', magnitude: 0, setup: null }]);
	});

	it('keeps the top 3 by magnitude, ordered by ply', () => {
		const a = analysis([mv(1, 'w', 30), mv(3, 'w', 9), mv(5, 'w', 20), mv(7, 'w', 15)]);
		const out = selectTurningPoints(a, game(['e4', 'a', 'e5', 'b', 'd4', 'c', 'c4']), 'w');
		expect(out.map((m) => m.ply)).toEqual([1, 5, 7]); // dropped the 9 (smallest)
		expect(out.map((m) => m.magnitude)).toEqual([30, 20, 15]);
	});

	it('falls back to the single worst own move when nothing clears the bars', () => {
		const a = analysis([mv(1, 'w', 3), mv(3, 'w', 6), mv(5, 'w', 1)]);
		const out = selectTurningPoints(a, game(['e4', 'a', 'e5', 'b', 'd4']), 'w');
		expect(out).toEqual([{ ply: 3, kind: 'mistake', magnitude: 6, setup: null }]);
	});
});
