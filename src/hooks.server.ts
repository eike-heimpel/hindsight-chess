import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth } from '$lib/server/betterAuth';
import type { Handle } from '@sveltejs/kit';

/**
 * Resolve the Better Auth session on every request and expose it on
 * `event.locals`; the auth seam (`$lib/server/auth`) reads it. `svelteKitHandler`
 * serves the `/api/auth/*` endpoints. When auth isn't configured, skip both so
 * dev/tests run without it.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	if (!auth) {
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	return svelteKitHandler({ event, resolve, auth, building });
};
