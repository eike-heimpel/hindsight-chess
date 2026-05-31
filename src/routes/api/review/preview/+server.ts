import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sourceFor, IMPORTABLE_SOURCES } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';
import type { ReviewGame, ReviewSource } from '$lib/review/types';

/**
 * POST /api/review/preview — the anonymous landing teaser's data source. Given a
 * `{source, username}`, fetch that player's single most recent standard game
 * live from the public platform API and return it (with moves) for the browser
 * to analyze. UNAUTHENTICATED on purpose, and it STORES NOTHING — a stranger's
 * input never touches the game-keyed caches, so the trust-model hole in
 * CLAUDE.md doesn't widen. The "keep it" path is behind login.
 */

const CACHE_TTL_MS = 60_000;
/** Distinct lookups one IP may trigger per window before we start refusing. */
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60_000;

// Best-effort, per-isolate. On Vercel each isolate has its own memory, so this
// caps a single warm instance, not the fleet — enough to blunt a tight retry
// loop and protect the platform API. Back it with Mongo (a TTL collection) only
// if real abuse shows up.
const cache = new Map<string, { at: number; game: ReviewGame }>();
const ipHits = new Map<string, { windowStart: number; count: number }>();

function platformLabel(source: ReviewSource): string {
	return source === 'lichess' ? 'lichess' : 'chess.com';
}

function rateLimited(ip: string, now: number): boolean {
	const hit = ipHits.get(ip);
	if (!hit || now - hit.windowStart > IP_WINDOW_MS) {
		ipHits.set(ip, { windowStart: now, count: 1 });
		return false;
	}
	hit.count++;
	return hit.count > IP_LIMIT;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = (await request.json().catch(() => null)) as {
		source?: string;
		username?: string;
	} | null;
	const source = body?.source as ReviewSource;
	const username = String(body?.username ?? '')
		.trim()
		.toLowerCase();
	if (!username || !IMPORTABLE_SOURCES.includes(source)) {
		throw error(400, 'Pick a platform and enter a username.');
	}

	const now = Date.now();
	const key = `${source}:${username}`;

	const cached = cache.get(key);
	if (cached && now - cached.at < CACHE_TTL_MS) {
		return json(cached.game);
	}

	if (rateLimited(getClientAddress(), now)) {
		throw error(429, 'Too many lookups. Give it a moment and try again.');
	}

	const result = await sourceFor(source).listGames(username, { limit: 1 });
	if (!result.ok) {
		const platform = platformLabel(source);
		if (result.error.kind === 'not_found') {
			throw error(404, `No ${platform} player "${username}".`);
		}
		throw error(502, `Could not reach ${platform}. Try again.`);
	}
	// listGames returns ok([]) when the account exists but has no standard-chess
	// games to show — a distinct, common case worth its own message.
	if (result.value.length === 0) {
		throw error(404, `No standard games found for "${username}".`);
	}

	const game = normalize(result.value[0]);
	cache.set(key, { at: now, game });
	return json(game);
};
