import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { syncAccount } from '$lib/server/reviewSync';

/**
 * POST /api/review/sync — auto-pull new games for the signed-in user's linked
 * profiles (every platform), so swapping to another profile shows fresh games.
 * Called by the home page on load. Best-effort and throttled (see
 * `syncAccount`): a source hiccup never fails the request, it just returns
 * `{ added: 0 }` and lets the page proceed with what's stored.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const user = await requireUser(locals);

	let added = 0;
	for (const account of user.reviewAccounts) {
		try {
			const result = await syncAccount(account);
			if (result.ok) added += result.value.added;
		} catch {
			// Best-effort — swallow and move on.
		}
	}

	return json({ added });
};
