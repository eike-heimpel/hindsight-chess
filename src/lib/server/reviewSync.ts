import { collectionAccessor } from './db.ts';
import { sourceFor } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';
import { listStoredGameIds, upsertGames } from './reviewGames.ts';
import { ok, type Result } from '$lib/result';
import { accountKey, type ReviewAccount, type ReviewError } from '$lib/review/types';

/**
 * The pull-and-store core, extracted so the manual `?/sync` form action and the
 * home page's auto-sync endpoint share one implementation. `pullAndStore` is the
 * raw pull (used by the actions, which add their own redirect / error mapping);
 * `syncAccount` is the throttled incremental wrapper the home loads call on
 * every visit, so rapid reloads don't hammer the source. Both work for any
 * platform via the source registry.
 */

/** Incremental-sync page size (newest games), matching the manual action. */
export const SYNC_LIMIT = 50;
/** Skip the network pull if we synced this profile within this window. */
const SYNC_THROTTLE_MS = 60_000;

type SyncMetaDoc = { _id: string; lastSyncedAt: Date };
const syncMeta = collectionAccessor<SyncMetaDoc>('reviewSyncMeta');

async function lastSyncedAt(key: string): Promise<Date | null> {
	const c = await syncMeta();
	const doc = await c.findOne({ _id: key });
	return doc?.lastSyncedAt ?? null;
}

async function touchSyncedAt(key: string): Promise<void> {
	const c = await syncMeta();
	await c.updateOne({ _id: key }, { $set: { lastSyncedAt: new Date() } }, { upsert: true });
}

/** Pull from the profile's platform and upsert. Returns the number of new games pulled. */
export async function pullAndStore(
	account: ReviewAccount,
	opts: { limit: number; knownGameIds?: Set<string> }
): Promise<Result<{ added: number }, ReviewError>> {
	const result = await sourceFor(account.source).listGames(account.username, opts);
	if (!result.ok) return result;
	await upsertGames(result.value.map(normalize));
	return ok({ added: result.value.length });
}

/**
 * Incremental, throttled sync for one profile — the home page calls this per
 * linked profile on load. Returns `{ added: 0 }` (no error) when throttled, so
 * the caller can treat it as a quiet no-op.
 */
export async function syncAccount(
	account: ReviewAccount
): Promise<Result<{ added: number }, ReviewError>> {
	const key = accountKey(account);
	const last = await lastSyncedAt(key);
	if (last && Date.now() - last.getTime() < SYNC_THROTTLE_MS) return ok({ added: 0 });

	const knownGameIds = await listStoredGameIds(account);
	const result = await pullAndStore(account, { limit: SYNC_LIMIT, knownGameIds });
	if (result.ok) await touchSyncedAt(key);
	return result;
}
