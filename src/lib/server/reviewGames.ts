import { collectionAccessor } from './db.ts';
import type { ReviewGame, ReviewSource } from '$lib/review/types';

/**
 * Server-side store for normalised review games. Own collection (`reviewGames`)
 * so the review tool stays separable from the kid app. Doc shape is `ReviewGame`
 * plus a composite `_id` ("source:gameId") and a lowercased `accounts` array for
 * case-insensitive "games for this player" lookups (chess.com usernames keep
 * their original case in PGN, but users type any case).
 */

export type ReviewGameDoc = ReviewGame & {
	_id: string;
	accounts: string[];
};

function docId(source: ReviewSource, gameId: string): string {
	return `${source}:${gameId}`;
}

const collection = collectionAccessor<ReviewGameDoc>('reviewGames', (c) =>
	c.createIndex({ accounts: 1, playedAt: -1 })
);

function toDoc(game: ReviewGame): ReviewGameDoc {
	return {
		...game,
		_id: docId(game.source, game.gameId),
		accounts: [game.white.username.toLowerCase(), game.black.username.toLowerCase()]
	};
}

function toGame(doc: ReviewGameDoc): ReviewGame {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip Mongo-only keys
	const { _id, accounts, ...game } = doc;
	return game;
}

export async function upsertGames(games: ReviewGame[]): Promise<void> {
	if (games.length === 0) return;
	const c = await collection();
	await c.bulkWrite(
		games.map((g) => {
			const doc = toDoc(g);
			return { updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true } };
		})
	);
}

export async function listRecentGames(account: string, limit = 20): Promise<ReviewGame[]> {
	const c = await collection();
	const docs = await c
		.find({ accounts: account.toLowerCase() })
		.sort({ playedAt: -1 })
		.limit(limit)
		.toArray();
	return docs.map(toGame);
}

/** All stored games across several accounts (one person owning multiple
 *  usernames), newest-first. Backs the cross-game stats screen. */
export async function listGamesForAccounts(accounts: string[], limit = 500): Promise<ReviewGame[]> {
	if (accounts.length === 0) return [];
	const c = await collection();
	const docs = await c
		.find({ accounts: { $in: accounts.map((a) => a.toLowerCase()) } })
		.sort({ playedAt: -1 })
		.limit(limit)
		.toArray();
	return docs.map(toGame);
}

/** Stored `gameId`s for an account, for incremental sync — the source stops
 *  walking chess.com once it hits one of these. */
export async function listStoredGameIds(account: string): Promise<Set<string>> {
	const c = await collection();
	const docs = await c
		.find({ accounts: account.toLowerCase() }, { projection: { gameId: 1 } })
		.toArray();
	return new Set(docs.map((d) => d.gameId));
}

export async function getReviewGame(
	source: ReviewSource,
	gameId: string
): Promise<ReviewGame | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: docId(source, gameId) });
	return doc ? toGame(doc) : null;
}
