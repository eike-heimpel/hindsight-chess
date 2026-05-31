import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { linkAccount } from '$lib/server/reviewLink';
import { IMPORTABLE_SOURCES } from '$lib/review/sources';
import type { ReviewSource } from '$lib/review/types';

/**
 * POST /api/review/connect — link the profile a visitor typed on the landing
 * page, carried through the magic link as connect query params. Called by the home page
 * once, right after sign-in. Authoritative: it re-validates and imports server-
 * side (the anonymous teaser stored nothing).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const body = (await request.json().catch(() => null)) as {
		source?: string;
		username?: string;
	} | null;
	const source = body?.source as ReviewSource;
	const username = String(body?.username ?? '')
		.trim()
		.toLowerCase();
	if (!username || !IMPORTABLE_SOURCES.includes(source)) {
		throw error(400, 'bad connect request');
	}

	const result = await linkAccount(user, { source, username });
	if (!result.ok) {
		throw error(result.error.kind === 'not_found' ? 404 : 502, result.error.message);
	}
	return json({ added: result.value.added });
};
