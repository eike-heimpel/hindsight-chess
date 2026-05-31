import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUser } from '$lib/server/auth';
import { useBetterAuth } from '$lib/server/env';
import { IMPORTABLE_SOURCES } from '$lib/review/sources';
import type { ReviewSource } from '$lib/review/types';

/** Parse a `?connect=source:username` carried from the landing teaser into a
 *  validated `{source, username}`, or null. The username may itself contain ':'
 *  in theory, so split only on the first separator and validate the source. */
function parseConnect(raw: string | null): { source: ReviewSource; username: string } | null {
	if (!raw) return null;
	const i = raw.indexOf(':');
	if (i <= 0) return null;
	const source = raw.slice(0, i) as ReviewSource;
	const username = raw.slice(i + 1).trim();
	if (!username || !IMPORTABLE_SOURCES.includes(source)) return null;
	return { source, username };
}

/** Magic-link sign-in. Already-signed-in users skip straight to their home —
 *  carrying any `connect` intent so the account links there. `authConfigured`
 *  lets the page show a clear notice instead of a silently broken form when
 *  Better Auth isn't set up (dev without keys). */
export const load: PageServerLoad = async ({ locals, url }) => {
	const connect = parseConnect(url.searchParams.get('connect'));
	const user = await getUser(locals);
	if (user) {
		redirect(
			303,
			connect
				? `/home?connect=${encodeURIComponent(`${connect.source}:${connect.username}`)}`
				: '/home'
		);
	}
	return { authConfigured: useBetterAuth(), connect };
};
