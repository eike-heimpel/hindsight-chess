import { collectionAccessor } from './db.ts';

/**
 * App-side per-user data: the chess.com usernames a user owns for the review
 * tool. Keyed by Better Auth's `userId` (`_id`), kept separate from Better
 * Auth's own `user` collection so the auth library and app domain evolve
 * independently. A user has no doc until they link their first account —
 * `getReviewAccounts` defaults to `[]`, `setReviewAccounts` upserts.
 */

type ReviewAccountsDoc = {
	_id: string;
	accounts: string[];
	updatedAt: Date;
};

const collection = collectionAccessor<ReviewAccountsDoc>('userReviewAccounts');

export async function getReviewAccounts(userId: string): Promise<string[]> {
	const c = await collection();
	const doc = await c.findOne({ _id: userId });
	return doc?.accounts ?? [];
}

/**
 * Replace a user's linked review accounts. Usernames are lowercased, trimmed,
 * de-duplicated and emptied of blanks before storing (matching the lowercased
 * `accounts` index on `reviewGames`).
 */
export async function setReviewAccounts(userId: string, accounts: string[]): Promise<void> {
	const cleaned = [...new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))];
	const c = await collection();
	await c.updateOne(
		{ _id: userId },
		{ $set: { accounts: cleaned, updatedAt: new Date() } },
		{ upsert: true }
	);
}
