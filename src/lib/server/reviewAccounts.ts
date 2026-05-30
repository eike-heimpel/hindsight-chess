import { collectionAccessor } from './db.ts';
import { accountKey, type ReviewAccount } from '$lib/review/types';

/**
 * App-side per-user data for the review tool: the platform profiles a user owns
 * (`{source, username}`) plus a pointer to the one they're currently looking at
 * (`activeKey`). The whole app scopes to the active profile — profiles are kept
 * separate because ratings don't translate across platforms. Keyed by Better
 * Auth's `userId` (`_id`), separate from Better Auth's own `user` collection so
 * the auth library and app domain evolve independently. A user has no doc until
 * they link their first account.
 */

type StoredAccount = ReviewAccount | string;
type ReviewAccountsDoc = {
	_id: string;
	accounts: StoredAccount[];
	/** `accountKey` of the active profile; resolved against `accounts` on read. */
	activeKey?: string;
	updatedAt: Date;
};

const collection = collectionAccessor<ReviewAccountsDoc>('userReviewAccounts');

/** Legacy docs stored bare lowercased chess.com usernames. Coerce them so old
 *  data keeps working without a migration. */
function coerce(a: StoredAccount): ReviewAccount {
	return typeof a === 'string' ? { source: 'chesscom', username: a } : a;
}

export type ReviewAccountsState = {
	accounts: ReviewAccount[];
	active: ReviewAccount | null;
};

export async function getReviewAccountsState(userId: string): Promise<ReviewAccountsState> {
	const c = await collection();
	const doc = await c.findOne({ _id: userId });
	const accounts = (doc?.accounts ?? []).map(coerce);
	const active = accounts.find((a) => accountKey(a) === doc?.activeKey) ?? accounts[0] ?? null;
	return { accounts, active };
}

/**
 * Replace a user's linked profiles. Usernames are lowercased/trimmed/de-duped
 * (by `{source, username}` key) and blanks dropped. Keeps the existing active
 * pointer when it still resolves; otherwise falls back to the first profile.
 */
export async function setReviewAccounts(userId: string, accounts: ReviewAccount[]): Promise<void> {
	const seen = new Set<string>();
	const cleaned: ReviewAccount[] = [];
	for (const a of accounts) {
		const account = { source: a.source, username: a.username.trim().toLowerCase() };
		if (!account.username) continue;
		const key = accountKey(account);
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(account);
	}
	const c = await collection();
	await c.updateOne(
		{ _id: userId },
		{ $set: { accounts: cleaned, updatedAt: new Date() } },
		{ upsert: true }
	);
}

/** Point the user at a profile. Persisted so every route (home, stats, …)
 *  reflects the swap, not just `/review`. */
export async function setActiveAccount(userId: string, active: ReviewAccount): Promise<void> {
	const c = await collection();
	await c.updateOne(
		{ _id: userId },
		{ $set: { activeKey: accountKey(active), updatedAt: new Date() } },
		{ upsert: true }
	);
}
