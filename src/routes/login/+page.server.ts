import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUser } from '$lib/server/auth';
import { useBetterAuth } from '$lib/server/env';
import { parseConnect, withConnect } from '$lib/review/connectIntent';

/** Magic-link sign-in. Already-signed-in users skip straight to their home —
 *  carrying any `connect` intent so the account links there. `authConfigured`
 *  lets the page show a clear notice instead of a silently broken form when
 *  Better Auth isn't set up (dev without keys). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const connect = parseConnect(url.searchParams);
	const user = await getUser(locals);
	if (user) redirect(303, withConnect('/home', connect));
	return { authConfigured: useBetterAuth(), connect };
};
