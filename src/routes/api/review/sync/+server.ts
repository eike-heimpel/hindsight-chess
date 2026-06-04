import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { syncAccount } from '$lib/server/reviewSync';

/**
 * POST /api/review/sync — auto-pull new games for the signed-in user's linked
 * profiles (every platform), so swapping to another profile shows fresh games.
 * Called by the home page on load (treated there as a non-critical enhancement).
 *
 * An expected source hiccup comes back as a non-ok `Result` from `syncAccount`:
 * we count it in `failed` and move to the next profile, so one platform being
 * down doesn't starve the others. Unexpected errors (DB outage, a bug) are NOT
 * swallowed — they throw and surface as a 500, per the fail-fast bar.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const user = await requireUser(locals);

	let added = 0;
	let failed = 0;
	for (const account of user.reviewAccounts) {
		const result = await syncAccount(account);
		if (result.ok) added += result.value.added;
		else failed++;
	}

	return json({ added, failed });
};
