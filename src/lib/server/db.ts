import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { getMongoDbName, getMongoUri } from './env.ts';

/**
 * Singleton Mongo client cached on globalThis so SvelteKit serverless invocations
 * on Vercel can reuse the connection across warm starts. A fresh cold start
 * gets a fresh client; warm-start invocations within the same isolate share it.
 */

type Cached = { client: MongoClient; dbPromise: Promise<Db> } | undefined;

const GLOBAL_KEY = '__myChessMongo' as const;

function cache(): { value: Cached } {
	const g = globalThis as unknown as Record<string, { value: Cached }>;
	if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { value: undefined };
	return g[GLOBAL_KEY];
}

export async function getDb(): Promise<Db> {
	const slot = cache();
	if (slot.value) return slot.value.dbPromise;

	const client = new MongoClient(getMongoUri(), { maxPoolSize: 5 });
	const dbPromise = client.connect().then(() => client.db(getMongoDbName()));
	const entry = { client, dbPromise };
	slot.value = entry;
	// Don't poison the cache on a transient connect failure — clear our slot if
	// it still points at this entry, so the next getDb() retries with a fresh client.
	dbPromise.catch(() => {
		if (cache().value === entry) cache().value = undefined;
	});
	return dbPromise;
}

/**
 * Build a typed accessor for one collection. The returned function resolves
 * the shared Db and returns the collection; if `init` is given it runs once on
 * first access (latched per isolate) — used to create indexes or seed. This is
 * the single home for the `getDb()` → `db.collection<T>(name)` boilerplate that
 * every store module would otherwise repeat.
 */
export function collectionAccessor<T extends Document>(
	name: string,
	init?: (c: Collection<T>, db: Db) => Promise<unknown>
): () => Promise<Collection<T>> {
	let initialized = false;
	return async () => {
		const db = await getDb();
		const c = db.collection<T>(name);
		if (init && !initialized) {
			await init(c, db);
			initialized = true;
		}
		return c;
	};
}

/** Test seam — drop the singleton so tests can swap in a fake. */
export function _resetDbCache(): void {
	cache().value = undefined;
}

/** Test seam — inject a fake Db without going through env/connect. */
export function _setDbForTests(db: Db): void {
	cache().value = {
		client: null as unknown as MongoClient,
		dbPromise: Promise.resolve(db)
	};
}
