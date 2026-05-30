import { error } from '@sveltejs/kit';
import { useBetterAuth } from './env.ts';
import { getReviewAccounts, setReviewAccounts } from './reviewAccounts.ts';

/**
 * Identity seam — the single place a request's user is resolved. Better Auth
 * resolves the session in `hooks.server.ts` and populates `event.locals`; this
 * seam maps that to the app's `User` (Better Auth's `userId` + the chess.com
 * accounts the user owns). Downstream code keys on `User.userId` and never
 * touches the auth storage shape. See CLAUDE.md "Going public".
 */

export type User = {
	userId: string;
	/** chess.com usernames (lowercased) this user owns, for the review tool. */
	reviewAccounts: string[];
};

/** Resolve the current user, or `null` when no session is present. Use in
 *  layout/page loaders that degrade gracefully. */
export async function getUser(locals: App.Locals): Promise<User | null> {
	if (!locals.user) return null;
	const reviewAccounts = await getReviewAccounts(locals.user.id);
	return { userId: locals.user.id, reviewAccounts };
}

/** Route guard for authenticated endpoints: 503 if auth is unconfigured, 401
 *  without a resolved session. */
export async function requireUser(locals: App.Locals): Promise<User> {
	if (!useBetterAuth()) throw error(503, 'auth not configured');
	const user = await getUser(locals);
	if (!user) throw error(401, 'unauthorized');
	return user;
}

/** Replace the chess.com accounts a user owns. Storage detail lives in
 *  `reviewAccounts.ts`; the seam keeps call sites user-centric. */
export async function setUserReviewAccounts(userId: string, accounts: string[]): Promise<void> {
	await setReviewAccounts(userId, accounts);
}
