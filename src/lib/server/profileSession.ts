import { error, type Cookies } from '@sveltejs/kit';
import { getProfileById, type Profile } from './profiles.ts';
import { useMongo } from './env.ts';

/**
 * Active-profile session, stored in a single cookie (`profileId`). The cookie
 * value is the profile slug — not a credential. Tampering with it just shows
 * another profile's progress; everyone in the household sees the picker on
 * the home page anyway. v1 chooses simplicity over signing for that reason.
 */

const PROFILE_COOKIE_NAME = 'profileId';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function getActiveProfileId(cookies: Cookies): string | null {
	return cookies.get(PROFILE_COOKIE_NAME) ?? null;
}

export function setActiveProfileId(cookies: Cookies, id: string): void {
	cookies.set(PROFILE_COOKIE_NAME, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: ONE_YEAR_SECONDS
	});
}

export function clearActiveProfileId(cookies: Cookies): void {
	cookies.delete(PROFILE_COOKIE_NAME, { path: '/' });
}

/**
 * Resolve the active profile for the current request. Returns `null` when
 * the cookie is missing OR when its value no longer points to an existing
 * profile (e.g. profile was removed from the seed).
 */
export async function getActiveProfile(cookies: Cookies): Promise<Profile | null> {
	const id = getActiveProfileId(cookies);
	if (!id) return null;
	const profile = await getProfileById(id);
	if (!profile) {
		clearActiveProfileId(cookies);
		return null;
	}
	return profile;
}

/**
 * Route guard: resolve the active profile or throw a 401. For endpoints that
 * any profile may call.
 */
export async function requireActiveProfile(cookies: Cookies): Promise<Profile> {
	const profile = await getActiveProfile(cookies);
	if (!profile) throw error(401, 'no active profile');
	return profile;
}

/**
 * Route guard for parent-only, Mongo-backed endpoints: 503 if Mongo is not
 * configured, 403 unless the active profile is a parent.
 */
export async function requireParentProfile(cookies: Cookies): Promise<Profile> {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const profile = await getActiveProfile(cookies);
	if (!profile || profile.role !== 'parent') throw error(403, 'forbidden');
	return profile;
}
