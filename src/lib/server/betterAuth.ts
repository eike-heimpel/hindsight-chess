import { dev } from '$app/environment';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { magicLink } from 'better-auth/plugins/magic-link';
import { getMongoDb } from './db.ts';
import { getBetterAuthSecret, getBetterAuthUrl, useBetterAuth } from './env.ts';
import { sendMagicLinkEmail } from './email.ts';

/**
 * Better Auth instance — owns the `user`/`session`/`account`/`verification`
 * collections in the same Mongo database (the adapter is schemaless, so no
 * migration step). Sign-in is magic-link only for now.
 *
 * Constructed lazily and cached per isolate: `betterAuth()` reads env + opens
 * the Mongo handle at call time, so we only build it when configured. When auth
 * isn't configured (dev/tests without keys), `getAuth()` returns null and the
 * handler/seam degrade — see `useBetterAuth`.
 */
function createAuth() {
	return betterAuth({
		baseURL: getBetterAuthUrl(),
		secret: getBetterAuthSecret(),
		database: mongodbAdapter(getMongoDb()),
		// Magic-link only in production. Email+password exists purely so the
		// dev-only `/dev-login` route can mint a real session without the email
		// round-trip — `dev` is false in any built/deployed bundle.
		emailAndPassword: { enabled: dev },
		// Memory storage (the default) is per-isolate and useless on Vercel's
		// serverless functions — persist limits in Mongo instead.
		rateLimit: { storage: 'database' },
		plugins: [
			magicLink({
				sendMagicLink: async ({ email, url }) => {
					await sendMagicLinkEmail(email, url);
				}
			})
		]
	});
}

type Auth = ReturnType<typeof createAuth>;

export type AuthUser = Auth['$Infer']['Session']['user'];
export type AuthSession = Auth['$Infer']['Session']['session'];

let cached: Auth | null | undefined;

export function getAuth(): Auth | null {
	if (cached !== undefined) return cached;
	cached = useBetterAuth() ? createAuth() : null;
	return cached;
}
