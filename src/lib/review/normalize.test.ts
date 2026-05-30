import { describe, it, expect } from 'vitest';
import { normalize } from './normalize';
import type { RawGame } from './source';

// Scholar's mate with chess.com-style headers + %clk annotations.
const PGN = `[Event "Test Game"]
[Site "Chess.com"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[ECO "C20"]
[ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening-2.Bc4"]
[WhiteElo "1500"]
[BlackElo "1480"]
[TimeControl "180+2"]
[Termination "Alice won by checkmate"]
[UTCDate "2026.01.02"]
[UTCTime "10:00:00"]
[EndDate "2026.01.02"]
[EndTime "10:05:00"]

1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:02:58]} 2. Bc4 {[%clk 0:02:59.5]} 2... Nc6 {[%clk 0:02:55]} 3. Qh5 {[%clk 0:02:57]} 3... Nf6 {[%clk 0:02:50]} 4. Qxf7# {[%clk 0:02:56]} 1-0`;

const raw: RawGame = {
	source: 'chesscom',
	gameId: 'test1',
	url: 'https://www.chess.com/game/live/test1',
	pgn: PGN,
	rated: true
};

describe('normalize', () => {
	const game = normalize(raw);

	it('carries source identity and rated flag through from RawGame', () => {
		expect(game.source).toBe('chesscom');
		expect(game.gameId).toBe('test1');
		expect(game.url).toBe('https://www.chess.com/game/live/test1');
		expect(game.rated).toBe(true);
	});

	it('reads players, ratings, result, eco and termination from headers', () => {
		expect(game.white).toEqual({ username: 'Alice', rating: 1500 });
		expect(game.black).toEqual({ username: 'Bob', rating: 1480 });
		expect(game.result).toBe('1-0');
		expect(game.eco).toBe('C20');
		expect(game.termination).toBe('Alice won by checkmate');
	});

	it('derives a readable opening name from the ECO url slug', () => {
		expect(game.opening).toBe('Kings Pawn Opening 2.Bc4');
	});

	it('derives time class from the time control', () => {
		expect(game.timeControl).toBe('180+2');
		expect(game.timeClass).toBe('blitz'); // 180 + 40*2 = 260s
	});

	it('parses played-at from EndDate/EndTime as UTC', () => {
		expect(game.playedAt.toISOString()).toBe('2026-01-02T10:05:00.000Z');
	});

	it('captures every half-move with SAN, UCI and before/after FEN', () => {
		expect(game.moves).toHaveLength(7);

		const first = game.moves[0];
		expect(first.ply).toBe(1);
		expect(first.color).toBe('w');
		expect(first.san).toBe('e4');
		expect(first.uci).toBe('e2e4');
		expect(first.fenBefore).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
		expect(first.fenAfter).toContain('4P3');

		const last = game.moves[6];
		expect(last.san).toBe('Qxf7#');
		expect(last.color).toBe('w');
	});

	it('parses per-move clocks from %clk comments', () => {
		expect(game.moves[0].clockMs).toBe(180_000); // 0:03:00
		expect(game.moves[1].clockMs).toBe(178_000); // 0:02:58
		expect(game.moves[2].clockMs).toBe(179_500); // 0:02:59.5
	});
});
