import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { parseMoveRef } from '$lib/server/moveRefRequest';
import { gateOwnedGame } from '$lib/server/userMoveState';
import { setCursor } from '$lib/server/userReviewState';

/**
 * POST /api/review/cursor — persist a queue's resume pointer. `{queue, ref}`,
 * ownership-gated like every move-state write. `requireUser` → validate →
 * ownership gate → `setCursor`.
 */

/** `queue` becomes a dotted Mongo field path (`cursors.${queue}`), so it must be
 *  a plain identifier — no `.`/`$` that could write outside the cursors map. */
const QUEUE = /^[a-z][a-z0-9_]{0,31}$/;

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const errors: string[] = [];
	const ref = parseMoveRef(body?.ref, errors);
	const queue = body?.queue;
	if (typeof queue !== 'string' || !QUEUE.test(queue)) errors.push('queue is invalid');
	if (!ref || errors.length) throw error(400, `Invalid request: ${errors.join('; ')}`);

	await gateOwnedGame(user.reviewAccounts, ref);
	await setCursor(user.userId, queue as string, ref);

	return json({ ok: true });
};
