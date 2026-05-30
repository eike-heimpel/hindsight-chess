import { collectionAccessor } from './db.ts';
import type { ReviewAccount, ReviewGame, ReviewSource } from '$lib/review/types';

/**
 * Server-side store for normalised review games. Own collection (`reviewGames`).
 * Doc shape is `ReviewGame` plus a composite `_id` ("source:gameId") and a
 * lowercased `accounts` array for case-insensitive "games for this player"
 * lookups (chess.com usernames keep their original case in PGN, but users type
 * any case). Lookups are source-qualified: the same username on chess.com and
 * lichess are different people, so `{source}` always pairs with `{accounts}`.
 */

export type ReviewGameDoc = ReviewGame & {
	_id: string;
	accounts: string[];
};

function docId(source: ReviewSource, gameId: string): string {
	return `${source}:${gameId}`;
}

const collection = collectionAccessor<ReviewGameDoc>('reviewGames', (c) =>
	c.createIndex({ source: 1, accounts: 1, playedAt: -1 })
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

const accountFilter = (a: ReviewAccount) => ({
	source: a.source,
	accounts: a.username.toLowerCase()
});

export async function listRecentGames(account: ReviewAccount, limit = 20): Promise<ReviewGame[]> {
	const c = await collection();
	const docs = await c.find(accountFilter(account)).sort({ playedAt: -1 }).limit(limit).toArray();
	return docs.map(toGame);
}

/** All stored games for a set of profiles, newest-first. Today the app passes a
 *  single active profile; the list signature keeps the door open to a future
 *  combined view (engine-derived stats only — never blended ratings). */
export async function listGamesForAccounts(
	accounts: ReviewAccount[],
	limit = 500
): Promise<ReviewGame[]> {
	if (accounts.length === 0) return [];
	const c = await collection();
	const docs = await c
		.find({ $or: accounts.map(accountFilter) })
		.sort({ playedAt: -1 })
		.limit(limit)
		.toArray();
	return docs.map(toGame);
}

/** Stored `gameId`s for a profile, for incremental sync — the source stops
 *  walking once it hits one of these. */
export async function listStoredGameIds(account: ReviewAccount): Promise<Set<string>> {
	const c = await collection();
	const docs = await c.find(accountFilter(account), { projection: { gameId: 1 } }).toArray();
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
