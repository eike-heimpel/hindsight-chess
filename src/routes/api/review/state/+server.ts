import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { clearAllMoveState } from '$lib/server/userMoveState';
import { clearCursors } from '$lib/server/userReviewState';

/**
 * DELETE /api/review/state — full per-user reset: wipe every touched move and
 * clear the resume cursors. No ownership gate needed; it only ever touches the
 * caller's own docs.
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	const user = await requireUser(locals);
	await clearAllMoveState(user.userId);
	await clearCursors(user.userId);
	return json({ ok: true });
};
