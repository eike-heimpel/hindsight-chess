import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUser } from '$lib/server/auth';
import { useBetterAuth } from '$lib/server/env';

/** Magic-link sign-in. Already-signed-in users skip straight to their home.
 *  `authConfigured` lets the page show a clear notice instead of a silently
 *  broken form when Better Auth isn't set up (dev without keys). */
export const load: PageServerLoad = async ({ locals }) => {
	const user = await getUser(locals);
	if (user) redirect(303, '/home');
	return { authConfigured: useBetterAuth() };
};
