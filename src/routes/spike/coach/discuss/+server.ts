import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { discuss } from '$lib/spike/coach/coach';
import type { DiscussRequest } from '$lib/spike/coach/types';

/**
 * POST /spike/coach/discuss — one turn of the guided coaching conversation.
 * Body is a DiscussRequest (facts are trusted, client-derived — this is a spike).
 * Needs only the OpenRouter key; no auth/Mongo coupling.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as DiscussRequest | null;
	if (!body || typeof body !== 'object' || !body.facts || typeof body.facts !== 'object') {
		throw error(400, 'body must include `facts`');
	}
	if (typeof body.isFirstTurn !== 'boolean') throw error(400, '`isFirstTurn` must be a boolean');

	const result = await discuss({
		facts: body.facts,
		history: Array.isArray(body.history) ? body.history : [],
		playerChoice: typeof body.playerChoice === 'string' ? body.playerChoice : undefined,
		isFirstTurn: body.isFirstTurn
	});

	if (!result.ok) throw error(502, `${result.error.kind}: ${result.error.message}`);
	return json(result.value);
};
