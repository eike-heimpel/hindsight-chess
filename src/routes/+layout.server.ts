import type { LayoutServerLoad } from './$types';
import { getUser } from '$lib/server/auth';

/**
 * Resolve the current user for every request and expose it on layout `data`
 * (read as `$page.data.user` in components) instead of plumbing it through
 * every loader. `null` when no session is resolved — loaders that need Mongo
 * still throw, per the no-fallback rule.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { user: await getUser(locals) };
};
