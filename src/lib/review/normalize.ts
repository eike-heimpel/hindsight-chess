/**
 * PGN → ReviewGame. chess.js does the parsing; verbose history gives us the
 * before/after FEN and UCI (`lan`) per ply, and `getComments()` carries the
 * `%clk` annotations keyed by the post-move FEN.
 *
 * Platform-blind: works off PGN headers alone, so the same code handles
 * chess.com, lichess, or a pasted game. The one bit PGN can't express (`rated`)
 * rides along on `RawGame`.
 */
import { Chess } from 'chess.js';
import type { RawGame } from './source';
import type { GameResult, PlayerRef, ReviewGame, ReviewMove } from './types';

type Headers = Record<string, string | null>;

function parseClockMs(comment: string | undefined): number | undefined {
	if (!comment) return undefined;
	const m = comment.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
	if (!m) return undefined;
	return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

function openingName(ecoUrl: string | null | undefined): string | undefined {
	if (!ecoUrl) return undefined;
	// "https://www.chess.com/openings/Pirc-Defense" → "Pirc Defense"
	const slug = ecoUrl.split('/').filter(Boolean).pop();
	return slug ? slug.replace(/-/g, ' ') : undefined;
}

/** chess.com-style class from estimated game length (base + 40·increment seconds). */
function classifyTimeControl(tc: string): string {
	if (tc.includes('/')) return 'daily';
	const [base, inc] = tc.split('+').map(Number);
	const estimated = base + 40 * (inc || 0);
	if (estimated < 180) return 'bullet';
	if (estimated < 600) return 'blitz';
	return 'rapid';
}

function player(name: string | null | undefined, elo: string | null | undefined): PlayerRef {
	const rating = elo == null ? NaN : Number(elo);
	const ref: PlayerRef = { username: name ?? '' };
	if (!Number.isNaN(rating)) ref.rating = rating;
	return ref;
}

function gameDate(date: string | null | undefined, time: string | null | undefined): Date {
	// PGN dates use dots ("2026.05.25"); time is UTC ("07:28:05").
	return new Date(`${(date ?? '1970.01.01').replace(/\./g, '-')}T${time ?? '00:00:00'}Z`);
}

export function normalize(raw: RawGame): ReviewGame {
	const chess = new Chess();
	chess.loadPgn(raw.pgn);
	const h = chess.header() as Headers;

	const clockByFen = new Map(chess.getComments().map((c) => [c.fen, c.comment] as const));
	const moves: ReviewMove[] = chess.history({ verbose: true }).map((m, i) => ({
		ply: i + 1,
		color: m.color,
		san: m.san,
		uci: m.lan,
		fenBefore: m.before,
		fenAfter: m.after,
		clockMs: parseClockMs(clockByFen.get(m.after))
	}));

	const timeControl = h.TimeControl ?? '';
	return {
		source: raw.source,
		gameId: raw.gameId,
		url: raw.url,
		playedAt: gameDate(h.EndDate ?? h.UTCDate, h.EndTime ?? h.UTCTime),
		timeClass: classifyTimeControl(timeControl),
		timeControl,
		rated: raw.rated,
		eco: h.ECO ?? undefined,
		opening: openingName(h.ECOUrl),
		white: player(h.White, h.WhiteElo),
		black: player(h.Black, h.BlackElo),
		result: (h.Result ?? '*') as GameResult,
		termination: h.Termination ?? '',
		moves
	};
}
