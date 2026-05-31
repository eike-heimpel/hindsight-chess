import { IMPORTABLE_SOURCES, type ReviewSource } from './types';

/**
 * The profile a visitor typed on the anonymous landing teaser, carried through
 * the sign-in round-trip (`/login` → magic-link `callbackURL` → `/home`) so the
 * account links automatically after they sign in.
 *
 * Carried as two plain query params, NOT a single `source:username`. Better
 * Auth validates the magic-link `callbackURL` against a relative-path regex that
 * `decodeURIComponent`s first and then forbids `:` in the query string — so a
 * colon separator makes it reject the URL ("Invalid callbackURL"). Two params
 * stay inside the allowed character set on every hop. One encode/parse pair,
 * shared by every producer and consumer, so the format can't drift again.
 */
export type ConnectIntent = { source: ReviewSource; username: string };

const SOURCE_PARAM = 'connect_source';
const USERNAME_PARAM = 'connect_username';

/** `base` with the connect intent appended as query params, or `base` unchanged
 *  when there's no intent. */
export function withConnect(base: string, intent: ConnectIntent | null): string {
	if (!intent) return base;
	const params = new URLSearchParams({
		[SOURCE_PARAM]: intent.source,
		[USERNAME_PARAM]: intent.username
	});
	return `${base}?${params}`;
}

/** Read a validated connect intent from a URL's query, or null. */
export function parseConnect(params: URLSearchParams): ConnectIntent | null {
	const source = params.get(SOURCE_PARAM) as ReviewSource | null;
	const username = (params.get(USERNAME_PARAM) ?? '').trim();
	if (!source || !username || !IMPORTABLE_SOURCES.includes(source)) return null;
	return { source, username };
}
