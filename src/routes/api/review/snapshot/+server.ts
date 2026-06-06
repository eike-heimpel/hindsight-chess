import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { parseExplainRequest } from '$lib/review/explainRequest';
import { freezeSnapshot, gateOwnedGame } from '$lib/server/userMoveState';

/**
 * POST /api/review/snapshot — freeze a saved explanation for one move. Takes the
 * SAME engine-number body as /api/review/explain (the browser sends only engine
 * numbers); the server re-reads the prose via `getExplanation` and rebuilds the
 * structured facts from the stored move. `requireUser` → validate → ownership
 * gate (derives `side`) → `freezeSnapshot`.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const parsed = parseExplainRequest(await request.json().catch(() => null));
	if ('errors' in parsed) throw error(400, `Invalid request: ${parsed.errors.join('; ')}`);
	const body = parsed.value;

	const { game, side } = await gateOwnedGame(user.reviewAccounts, {
		source: body.source,
		gameId: body.gameId,
		ply: body.ply
	});

	await freezeSnapshot(user.userId, game, side, body);
	return json({ ok: true });
};
