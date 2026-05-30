/**
 * lichess ingestion adapter. Public game-export API, no auth required (an
 * optional token raises rate limits). We ask for newest-first ndjson with the
 * PGN inlined (`pgnInJson`) plus clocks + opening so `normalize()` has the same
 * raw material it gets from chess.com. One streamed request — no monthly
 * archives to walk like chess.com. Standard-chess games only.
 */
import { ok, type Result } from '$lib/result';
import type { GameSource, RawGame } from '../source';
import { reviewErr, type ReviewError } from '../types';
import { getLichessToken } from '$lib/server/env';

const API_BASE = 'https://lichess.org/api';
const DEFAULT_LIMIT = 20;

type LichessGame = {
	id: string;
	rated: boolean;
	variant: string;
	pgn?: string;
};

export class LichessSource implements GameSource {
	async listGames(
		account: string,
		opts?: { limit?: number; knownGameIds?: Set<string> }
	): Promise<Result<RawGame[], ReviewError>> {
		const user = account.trim().toLowerCase();
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		const known = opts?.knownGameIds ?? new Set<string>();

		const params = new URLSearchParams({
			max: String(limit),
			pgnInJson: 'true',
			clocks: 'true',
			opening: 'true',
			sort: 'dateDesc'
		});
		const token = getLichessToken();
		const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
		if (token) headers.Authorization = `Bearer ${token}`;

		try {
			const res = await fetch(`${API_BASE}/games/user/${user}?${params}`, { headers });
			if (res.status === 404) {
				return { ok: false, error: reviewErr('not_found', `unknown lichess user: ${user}`) };
			}
			if (res.status === 429) {
				return { ok: false, error: reviewErr('fetch_failed', 'lichess rate limited (429)') };
			}
			if (!res.ok) {
				return { ok: false, error: reviewErr('fetch_failed', `games ${res.status}`) };
			}

			// ndjson: one game object per line, already newest-first.
			const body = await res.text();
			const games: RawGame[] = [];
			for (const line of body.split('\n')) {
				if (!line.trim()) continue;
				const g = JSON.parse(line) as LichessGame;
				if (g.variant !== 'standard' || !g.pgn) continue;
				// newest-first → the first stored id we hit means the rest is stored too.
				if (known.has(g.id)) break;
				games.push({
					source: 'lichess',
					gameId: g.id,
					url: `https://lichess.org/${g.id}`,
					pgn: g.pgn,
					rated: g.rated
				});
				if (games.length >= limit) break;
			}
			return ok(games);
		} catch (e) {
			return {
				ok: false,
				error: reviewErr('fetch_failed', e instanceof Error ? e.message : String(e))
			};
		}
	}
}
