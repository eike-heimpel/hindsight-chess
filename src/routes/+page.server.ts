import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The public face — the only page a stranger sees without signing in. Its whole
 * job is to land the pitch and send you to /login. Signed-in visitors don't
 * belong here; their home is the dashboard, so bounce them straight there.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(307, '/home');
	return {};
};
