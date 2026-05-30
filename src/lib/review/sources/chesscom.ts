/**
 * chess.com ingestion adapter. Public Published-Data API, no auth. We list the
 * monthly archives, then walk them newest-first pulling standard-chess games
 * until we have `limit`. The username must be lowercased; the API rejects
 * mixed case. A descriptive User-Agent is required or chess.com returns 403.
 */
import { ok, type Result } from '$lib/result';
import type { GameSource, RawGame } from '../source';
import { reviewErr, type ReviewError } from '../types';

const API_BASE = 'https://api.chess.com/pub';
const USER_AGENT = 'kids-chess-learner/review (game review tool; contact eike@paretos.com)';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
const DEFAULT_LIMIT = 20;

type ChessComGame = {
	url: string;
	pgn?: string;
	rules: string;
	rated: boolean;
};

function gameIdFromUrl(url: string): string {
	return url.split('/').filter(Boolean).pop() ?? url;
}

export class ChessComSource implements GameSource {
	async listGames(
		account: string,
		opts?: { limit?: number; knownGameIds?: Set<string> }
	): Promise<Result<RawGame[], ReviewError>> {
		const user = account.trim().toLowerCase();
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		const known = opts?.knownGameIds ?? new Set<string>();

		try {
			const archivesRes = await fetch(`${API_BASE}/player/${user}/games/archives`, {
				headers: HEADERS
			});
			if (archivesRes.status === 404) {
				return { ok: false, error: reviewErr('not_found', `unknown chess.com user: ${user}`) };
			}
			if (!archivesRes.ok) {
				return { ok: false, error: reviewErr('fetch_failed', `archives ${archivesRes.status}`) };
			}
			const { archives } = (await archivesRes.json()) as { archives: string[] };

			const games: RawGame[] = [];
			// archives are oldest-first; walk from the newest month backwards.
			// Incremental sync: stop at the first already-stored game — newest-first
			// means everything past it is already in the store too.
			let reachedKnown = false;
			for (let i = archives.length - 1; i >= 0 && games.length < limit && !reachedKnown; i--) {
				const monthRes = await fetch(archives[i], { headers: HEADERS });
				if (!monthRes.ok) {
					return { ok: false, error: reviewErr('fetch_failed', `archive ${monthRes.status}`) };
				}
				const { games: monthGames } = (await monthRes.json()) as { games: ChessComGame[] };
				// games within a month are oldest-first too; reverse for newest-first.
				for (const g of monthGames.slice().reverse()) {
					if (g.rules !== 'chess' || !g.pgn) continue;
					const gameId = gameIdFromUrl(g.url);
					if (known.has(gameId)) {
						reachedKnown = true;
						break;
					}
					games.push({ source: 'chesscom', gameId, url: g.url, pgn: g.pgn, rated: g.rated });
					if (games.length >= limit) break;
				}
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
