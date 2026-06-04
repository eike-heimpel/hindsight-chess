import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/betterAuth';
import { linkAccount } from '$lib/server/reviewLink';
import type { User } from '$lib/server/auth';
import type { ReviewSource } from '$lib/review/types';
import type { RequestHandler } from './$types';

/**
 * Dev-only login bypass: mints a real Better Auth session (via the dev-only
 * email+password provider) for a fixed dev user, links a chess.com profile so
 * the app lands on populated pages, and redirects home. Lets the screenshot
 * harness and manual testing skip the magic-link email round-trip. 404s in any
 * built/deployed bundle (`dev` is false there).
 *
 *   /dev-login                  → dev user, links chess.com "timbolt123"
 *   /dev-login?username=foo     → links chess.com "foo" instead
 *   /dev-login?next=/review     → redirect target after login
 */
const DEV_EMAIL = 'dev@hindsight.local';
const DEV_PASSWORD = 'dev-password-please';
const DEFAULT_USERNAME = 'timbolt123';

export const GET: RequestHandler = async ({ url, request }) => {
	if (!dev) throw error(404, 'not found');
	const auth = getAuth();
	if (!auth) throw error(503, 'auth not configured');

	// Ensure the dev user exists. Re-runs hit "user already exists" — ignore it.
	try {
		await auth.api.signUpEmail({
			body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: 'Dev' }
		});
	} catch {
		/* already exists */
	}

	const signIn = await auth.api.signInEmail({
		body: { email: DEV_EMAIL, password: DEV_PASSWORD },
		headers: request.headers,
		asResponse: true
	});
	const { user } = (await signIn.clone().json()) as { user: { id: string } };

	const username = url.searchParams.get('username') ?? DEFAULT_USERNAME;
	const source = (url.searchParams.get('source') ?? 'chesscom') as ReviewSource;
	const devUser: User = { userId: user.id, reviewAccounts: [], activeAccount: null };
	const linked = await linkAccount(devUser, { source, username });
	if (!linked.ok) throw error(502, `link ${source}/${username} failed: ${linked.error.message}`);

	const headers = new Headers();
	for (const cookie of signIn.headers.getSetCookie()) headers.append('set-cookie', cookie);
	headers.set('location', url.searchParams.get('next') ?? '/');
	return new Response(null, { status: 303, headers });
};
