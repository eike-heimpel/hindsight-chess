import { describe, it, expect } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../analysis';
import type { MoveClass } from '../classify';
import type { GameResult, ReviewGame, ReviewMove } from '../types';
import type { Side } from '$lib/chess/types';
import { computeReviewStats } from './compute';
import { toPerspective } from './perspective';

let n = 0;

function game(opts: {
	white: string;
	black: string;
	result: GameResult;
	timeClass?: string;
	playedAt?: Date;
	whiteRating?: number;
	blackRating?: number;
	opening?: string;
	termination?: string;
	/** [color, clockMs?] per ply, in order. */
	moves?: { color: Side; clockMs?: number }[];
}): ReviewGame {
	const id = `g${n++}`;
	const moves: ReviewMove[] = (opts.moves ?? []).map((m, i) => ({
		ply: i + 1,
		color: m.color,
		san: 'x',
		uci: 'e2e4',
		fenBefore: 'f',
		fenAfter: 'f',
		clockMs: m.clockMs
	}));
	return {
		source: 'chesscom',
		gameId: id,
		playedAt: opts.playedAt ?? new Date('2026-01-01'),
		timeClass: opts.timeClass ?? 'rapid',
		timeControl: '600',
		eco: undefined,
		opening: opts.opening,
		white: { username: opts.white, rating: opts.whiteRating },
		black: { username: opts.black, rating: opts.blackRating },
		result: opts.result,
		termination: opts.termination ?? '',
		moves
	};
}

/** Analysis whose per-move classifications + a white-POV win timeline we control. */
function analysis(
	g: ReviewGame,
	opts: {
		classes: MoveClass[];
		whiteWinBefore: number[];
		accuracy?: { white: number; black: number };
	}
): GameAnalysis {
	const moves: MoveAnalysis[] = g.moves.map((m, i) => {
		const wb = opts.whiteWinBefore[i];
		const winBefore = m.color === 'w' ? wb : 100 - wb;
		return {
			ply: m.ply,
			color: m.color,
			cpBefore: 0,
			cpAfter: 0,
			winBefore,
			winAfter: winBefore,
			delta: 0,
			classification: opts.classes[i],
			bestMoveUci: 'e2e4',
			bestMoveSan: 'e4'
		};
	});
	return {
		source: g.source,
		gameId: g.gameId,
		depth: 16,
		analyzedAt: '2026-01-01',
		moves,
		accuracy: opts.accuracy ?? { white: 90, black: 90 }
	};
}

const ME = new Set(['me']);

describe('toPerspective', () => {
	it('resolves the side I played and the outcome', () => {
		const g = game({ white: 'me', black: 'foe', result: '1-0' });
		const p = toPerspective(g, null, ME)!;
		expect(p.side).toBe('w');
		expect(p.outcome).toBe('win');
		expect(p.opponent).toBe('foe');
		expect(p.analyzed).toBe(false);
	});

	it('flips outcome when I am black', () => {
		const g = game({ white: 'foe', black: 'me', result: '1-0' });
		expect(toPerspective(g, null, ME)!.outcome).toBe('loss');
	});

	it('returns null when I did not play', () => {
		const g = game({ white: 'a', black: 'b', result: '1-0' });
		expect(toPerspective(g, null, ME)).toBeNull();
	});

	it('takes only my moves and enriches with classification + time spent', () => {
		const g = game({
			white: 'me',
			black: 'foe',
			moves: [
				{ color: 'w', clockMs: 60_000 },
				{ color: 'b', clockMs: 60_000 },
				{ color: 'w', clockMs: 52_000 }
			],
			result: '1-0'
		});
		const a = analysis(g, {
			classes: ['best', 'blunder', 'mistake'],
			whiteWinBefore: [50, 50, 50]
		});
		const p = toPerspective(g, a, ME)!;
		expect(p.moves.map((m) => m.ply)).toEqual([1, 3]);
		expect(p.moves[0].classification).toBe('best');
		expect(p.moves[1].msSpent).toBe(8_000); // 60s → 52s on my second move
	});
});

describe('computeReviewStats', () => {
	it('segments by time class, most-played first', () => {
		const games = [
			game({ white: 'me', black: 'a', result: '1-0', timeClass: 'blitz' }),
			game({ white: 'me', black: 'b', result: '0-1', timeClass: 'blitz' }),
			game({ white: 'me', black: 'c', result: '1-0', timeClass: 'rapid' })
		];
		const stats = computeReviewStats({ games, analyses: new Map(), accounts: ME });
		expect(stats.map((s) => s.timeClass)).toEqual(['blitz', 'rapid']);
		expect(stats[0].totalGames).toBe(2);
		expect(stats[0].record).toEqual({ win: 1, draw: 0, loss: 1 });
		expect(stats[0].winRate).toBe(50);
	});

	it('leaves analysis-only stats null until games are analyzed', () => {
		const games = [game({ white: 'me', black: 'a', result: '1-0' })];
		const [s] = computeReviewStats({ games, analyses: new Map(), accounts: ME });
		expect(s.analyzedGames).toBe(0);
		expect(s.avgAccuracy).toBeNull();
		expect(s.avgBlundersPerGame).toBeNull();
	});

	it('counts my blunders and surfaces a winnable-loss candidate', () => {
		const g = game({
			white: 'me',
			black: 'foe',
			result: '0-1', // I had it and lost
			moves: [{ color: 'w' }, { color: 'b' }, { color: 'w' }]
		});
		// I (white) was at 90% win before my last move, then lost.
		const a = analysis(g, {
			classes: ['best', 'good', 'blunder'],
			whiteWinBefore: [60, 88, 90]
		});
		const [s] = computeReviewStats({
			games: [g],
			analyses: new Map([[`chesscom:${g.gameId}`, a]]),
			accounts: ME
		});
		expect(s.avgBlundersPerGame).toBe(1);
		expect(s.winnable).toHaveLength(1);
		expect(s.winnable[0].peakWin).toBe(90);
		expect(s.winnable[0].myMoves).toHaveLength(2); // my two moves, both analyzed
		const blunders = s.moveClasses.find((c) => c.class === 'blunder')!;
		expect(blunders.count).toBe(1);
	});

	it('bands opponents by rating difference, keeping unknowns separate from even', () => {
		const games = [
			game({ white: 'me', black: 'a', result: '1-0', whiteRating: 1000, blackRating: 1500 }),
			game({ white: 'me', black: 'b', result: '1-0', whiteRating: 1000, blackRating: 1010 }),
			game({ white: 'me', black: 'c', result: '0-1', whiteRating: 1000 })
		];
		const [s] = computeReviewStats({ games, analyses: new Map(), accounts: ME });
		const bands = Object.fromEntries(s.byRatingBand.map((b) => [b.band, b.games]));
		expect(bands).toEqual({ stronger: 1, even: 1, unknown: 1 });
	});
});
