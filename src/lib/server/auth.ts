import { error } from '@sveltejs/kit';
import { useBetterAuth } from './env.ts';
import { getReviewAccountsState, setActiveAccount, setReviewAccounts } from './reviewAccounts.ts';
import type { ReviewAccount } from '$lib/review/types';

/**
 * Identity seam — the single place a request's user is resolved. Better Auth
 * resolves the session in `hooks.server.ts` and populates `event.locals`; this
 * seam maps that to the app's `User` (Better Auth's `userId` + the platform
 * profiles the user owns + the one they're actively viewing). Downstream code
 * keys on `User.userId` and never touches the auth storage shape. See CLAUDE.md
 * "Going public".
 */

export type User = {
	userId: string;
	/** Platform profiles (`{source, username}`) this user owns. */
	reviewAccounts: ReviewAccount[];
	/** The profile the whole app is currently scoped to (null until one is
	 *  linked). Profiles stay separate — see `reviewAccounts.ts`. */
	activeAccount: ReviewAccount | null;
};

/** Resolve the current user, or `null` when no session is present. Use in
 *  layout/page loaders that degrade gracefully. */
export async function getUser(locals: App.Locals): Promise<User | null> {
	if (!locals.user) return null;
	const { accounts, active } = await getReviewAccountsState(locals.user.id);
	return { userId: locals.user.id, reviewAccounts: accounts, activeAccount: active };
}

/** Route guard for authenticated endpoints: 503 if auth is unconfigured, 401
 *  without a resolved session. */
export async function requireUser(locals: App.Locals): Promise<User> {
	if (!useBetterAuth()) throw error(503, 'auth not configured');
	const user = await getUser(locals);
	if (!user) throw error(401, 'unauthorized');
	return user;
}

/** Replace the platform profiles a user owns. Storage detail lives in
 *  `reviewAccounts.ts`; the seam keeps call sites user-centric. */
export async function setUserReviewAccounts(
	userId: string,
	accounts: ReviewAccount[]
): Promise<void> {
	await setReviewAccounts(userId, accounts);
}

/** Point the user at a profile; the whole app scopes to it on the next load. */
export async function setUserActiveAccount(userId: string, active: ReviewAccount): Promise<void> {
	await setActiveAccount(userId, active);
}
