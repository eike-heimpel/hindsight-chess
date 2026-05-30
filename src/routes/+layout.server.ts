import type { LayoutServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getActiveProfile } from '$lib/server/profileSession';
import { listProfiles, type Profile } from '$lib/server/profiles';

/**
 * Resolve the active profile for every request and expose the full profile
 * list. Pages read these from `data` (or `$page.data` in components) instead
 * of plumbing them through every loader.
 *
 * When Mongo isn't configured (e.g. unit-test dev runs without a db) we
 * return empty values rather than throwing — the home page surfaces a clear
 * error there. The /train and /api/* routes still throw when they need
 * Mongo, per the no-fallback rule.
 */
export const load: LayoutServerLoad = async ({ cookies }) => {
	if (!useMongo()) {
		return { profiles: [] as Profile[], activeProfile: null };
	}
	const [profiles, activeProfile] = await Promise.all([listProfiles(), getActiveProfile(cookies)]);
	return { profiles, activeProfile };
};
