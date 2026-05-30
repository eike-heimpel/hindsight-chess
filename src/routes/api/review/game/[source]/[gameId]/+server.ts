import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { getReviewGame } from '$lib/server/reviewGames';
import type { ReviewSource } from '$lib/review/types';

/** Full stored game (with moves), for the stats screen's batch-analyze loop —
 *  the page load only ships game *ids*, so the client fetches each game it needs
 *  to feed the engine. */
export const GET: RequestHandler = async ({ locals, params }) => {
	await requireUser(locals);
	const game = await getReviewGame(params.source as ReviewSource, params.gameId);
	if (!game) throw error(404, 'game not found');
	return json(game);
};
