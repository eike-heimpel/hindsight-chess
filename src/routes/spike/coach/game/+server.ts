import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sourceFor } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';

/**
 * GET /spike/coach/game?user=<chesscom>&limit=<n>
 * Spike-local game fetch — server-side because chess.com needs a real
 * User-Agent and blocks browser CORS. Returns recent games already normalized,
 * newest first. No auth, no Mongo: this is a throwaway probe.
 */
export const GET: RequestHandler = async ({ url }) => {
	const user = (url.searchParams.get('user') ?? '').trim();
	if (!user) throw error(400, 'pass ?user=<chess.com username>');
	const limit = Math.min(15, Math.max(1, Number(url.searchParams.get('limit') ?? 8) || 8));

	const result = await sourceFor('chesscom').listGames(user, { limit });
	if (!result.ok) {
		const status = result.error.kind === 'not_found' ? 404 : 502;
		throw error(status, result.error.message);
	}

	const games = result.value
		.map((raw) => {
			try {
				return normalize(raw);
			} catch {
				return null;
			}
		})
		.filter((g) => g !== null);

	return json({ games });
};
