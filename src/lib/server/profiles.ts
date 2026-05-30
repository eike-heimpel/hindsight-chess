import type { Collection } from 'mongodb';
import { collectionAccessor, getDb } from './db.ts';
// Inlined from the kid app's opening module — the review app has no opening
// mode. These knobs (opening Elo/ply) are dead weight here; they survive only
// so the vendored profile shape stays unchanged. Revisit when the profile/auth
// model is redesigned for multi-user (see docs/review.md).
const DEFAULT_OPENING_PLY_LIMIT = 20;
const OPENING_PLY_LIMIT_MIN = 10;
const OPENING_PLY_LIMIT_MAX = 40;
const OPENING_ELO_MIN = 1320;
const OPENING_ELO_MAX = 2400;
const OPPONENT_CONFIG_DEFAULT = { uciElo: OPENING_ELO_MIN };

/**
 * Profiles for the trainer. v1 seeds two: `lia` (the child) and `papa` (the
 * parent). `_id` is a stable slug used as `profileId` everywhere in the app —
 * history, playthrough sessions, the active-profile cookie. Adding more
 * profiles is a deliberate seed change for now; a CRUD UI can come later.
 *
 * Per-profile difficulty knobs:
 * - `ratingMin` — rating floor for the playthrough queue (positions whose
 *   Lichess rating is below it are excluded; unrated rows excluded too
 *   once `ratingMin > 0`).
 * - `openingElo` — UCI Elo cap for the Eröffnungspartie opponent.
 * - `openingPlyLimit` — half-move cap for the Eröffnungspartie.
 *
 * All three are settable from the parent dashboard for any profile and
 * persist until changed.
 */

export type ProfileRole = 'child' | 'parent';

export type Profile = {
	id: string;
	name: string;
	emoji: string;
	role: ProfileRole;
	ratingMin: number;
	openingElo: number;
	openingPlyLimit: number;
	/** chess.com usernames (lowercased) this profile owns, for the Game Review
	 *  tool. Plain strings so this kid-app module never imports from `review/`. */
	reviewAccounts: string[];
	createdAt: Date;
};

export type ProfileDoc = {
	_id: string;
	name: string;
	emoji: string;
	role: ProfileRole;
	ratingMin?: number;
	openingElo?: number;
	openingPlyLimit?: number;
	reviewAccounts?: string[];
	createdAt: Date;
};

const SEED: ReadonlyArray<Omit<ProfileDoc, 'createdAt'>> = [
	{
		_id: 'lia',
		name: 'Lia',
		emoji: '🦊',
		role: 'child',
		ratingMin: 0,
		openingElo: OPPONENT_CONFIG_DEFAULT.uciElo,
		openingPlyLimit: DEFAULT_OPENING_PLY_LIMIT,
		reviewAccounts: []
	},
	{
		_id: 'papa',
		name: 'Papa',
		emoji: '🐻',
		role: 'parent',
		ratingMin: 0,
		openingElo: OPPONENT_CONFIG_DEFAULT.uciElo,
		openingPlyLimit: DEFAULT_OPENING_PLY_LIMIT,
		reviewAccounts: ['timbolt123']
	}
];

type ProfilesCache = { byId: Map<string, Profile>; list: Profile[] };
let cachePromise: Promise<ProfilesCache> | null = null;

const collection = collectionAccessor<ProfileDoc>('profiles', async (c, db) => {
	await ensureSeed(c);
	await backfillRatingMin(c);
	await backfillOpeningSettings(c);
	await backfillReviewAccounts(c);
	await migrateLegacyHistory(db);
});

/**
 * Cache the full profile set in-memory per isolate. Profiles are seeded-only
 * (no runtime CRUD), so a stale cache within an isolate is fine; a new
 * isolate gets a fresh load. Saves a Mongo round trip on every page load
 * (`listProfiles` + `getProfileById` are called from layout/page loaders).
 */
async function loadProfilesCache(): Promise<ProfilesCache> {
	if (cachePromise) return cachePromise;
	const promise = (async () => {
		const c = await collection();
		const docs = await c.find({}).sort({ createdAt: 1 }).toArray();
		const list = docs.map(toProfile);
		const byId = new Map(list.map((p) => [p.id, p]));
		return { byId, list };
	})();
	promise.catch(() => {
		if (cachePromise === promise) cachePromise = null;
	});
	cachePromise = promise;
	return promise;
}

async function ensureSeed(c: Collection<ProfileDoc>): Promise<void> {
	const now = new Date();
	for (const p of SEED) {
		await c.updateOne({ _id: p._id }, { $setOnInsert: { ...p, createdAt: now } }, { upsert: true });
	}
}

/** Pre-existing profiles predate `ratingMin`; default them to 0 so reads can
 *  rely on the field being set. Idempotent. */
async function backfillRatingMin(c: Collection<ProfileDoc>): Promise<void> {
	await c.updateMany({ ratingMin: { $exists: false } }, { $set: { ratingMin: 0 } });
}

/** Pre-existing profiles predate the Eröffnungspartie settings; default
 *  them to the current floor so reads can rely on both fields being set.
 *  Idempotent. */
async function backfillOpeningSettings(c: Collection<ProfileDoc>): Promise<void> {
	await c.updateMany(
		{ openingElo: { $exists: false } },
		{ $set: { openingElo: OPPONENT_CONFIG_DEFAULT.uciElo } }
	);
	await c.updateMany(
		{ openingPlyLimit: { $exists: false } },
		{ $set: { openingPlyLimit: DEFAULT_OPENING_PLY_LIMIT } }
	);
}

/** Pre-existing profiles predate review-account linking. Give Papa the
 *  requested default before defaulting the rest to empty, then default any
 *  remaining profiles to `[]` so reads can rely on the field. Both idempotent
 *  (guarded on the field being absent), so clearing Papa's accounts in the UI
 *  later sticks. */
async function backfillReviewAccounts(c: Collection<ProfileDoc>): Promise<void> {
	await c.updateOne(
		{ _id: 'papa', reviewAccounts: { $exists: false } },
		{ $set: { reviewAccounts: ['timbolt123'] } }
	);
	await c.updateMany({ reviewAccounts: { $exists: false } }, { $set: { reviewAccounts: [] } });
}

/**
 * One-shot migration of legacy history docs:
 *   1. Value rename: `userId: 'kid'` → `userId: 'lia'` (the seeded child).
 *   2. Field rename: `userId` → `profileId`, matching the new naming.
 * Both are idempotent — once no docs match the filter, they're no-ops.
 * Lives here because introducing profiles is what makes the rename necessary.
 */
async function migrateLegacyHistory(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
	const history = db.collection('history');
	await history.updateMany({ userId: 'kid' }, { $set: { userId: 'lia' } });
	await history.updateMany({ userId: { $exists: true } }, { $rename: { userId: 'profileId' } });
}

function toProfile(doc: ProfileDoc): Profile {
	return {
		id: doc._id,
		name: doc.name,
		emoji: doc.emoji,
		role: doc.role,
		ratingMin: doc.ratingMin ?? 0,
		openingElo: doc.openingElo ?? OPPONENT_CONFIG_DEFAULT.uciElo,
		openingPlyLimit: doc.openingPlyLimit ?? DEFAULT_OPENING_PLY_LIMIT,
		reviewAccounts: doc.reviewAccounts ?? [],
		createdAt: doc.createdAt
	};
}

export async function listProfiles(): Promise<Profile[]> {
	const cache = await loadProfilesCache();
	return cache.list;
}

export async function getProfileById(id: string): Promise<Profile | null> {
	const cache = await loadProfilesCache();
	return cache.byId.get(id) ?? null;
}

/**
 * Set the per-profile rating floor. Drops the in-memory profiles cache so the
 * next read sees the new value (the cache is per-isolate; serving the same
 * stale value would survive across the same Vercel warm start otherwise).
 * Throws when the profile doesn't exist — fail fast.
 */
export async function setProfileRatingMin(id: string, ratingMin: number): Promise<void> {
	if (!Number.isFinite(ratingMin) || ratingMin < 0) {
		throw new Error(`invalid ratingMin: ${ratingMin}`);
	}
	const c = await collection();
	const result = await c.updateOne({ _id: id }, { $set: { ratingMin } });
	if (result.matchedCount === 0) throw new Error(`profile ${id} not found`);
	cachePromise = null;
}

/**
 * Set both Eröffnungspartie knobs at once. Single call so the parent UI
 * can stage and save a profile's opening config in one form submit (Elo
 * and ply-limit are conceptually one "how hard / how long" decision).
 * Validates against the same bounds the game state machine + opponent
 * advertise — invalid values throw rather than getting silently clamped,
 * so the parent UI never gets out of sync with what's actually stored.
 */
export async function setProfileOpeningSettings(
	id: string,
	settings: { openingElo: number; openingPlyLimit: number }
): Promise<void> {
	const { openingElo, openingPlyLimit } = settings;
	if (
		!Number.isFinite(openingElo) ||
		openingElo < OPENING_ELO_MIN ||
		openingElo > OPENING_ELO_MAX
	) {
		throw new Error(
			`invalid openingElo: ${openingElo} (expected [${OPENING_ELO_MIN}, ${OPENING_ELO_MAX}])`
		);
	}
	if (
		!Number.isInteger(openingPlyLimit) ||
		openingPlyLimit < OPENING_PLY_LIMIT_MIN ||
		openingPlyLimit > OPENING_PLY_LIMIT_MAX
	) {
		throw new Error(
			`invalid openingPlyLimit: ${openingPlyLimit} (expected integer in [${OPENING_PLY_LIMIT_MIN}, ${OPENING_PLY_LIMIT_MAX}])`
		);
	}
	const c = await collection();
	const result = await c.updateOne({ _id: id }, { $set: { openingElo, openingPlyLimit } });
	if (result.matchedCount === 0) throw new Error(`profile ${id} not found`);
	cachePromise = null;
}

/**
 * Replace a profile's linked Game-Review accounts. Usernames are lowercased,
 * trimmed, de-duplicated and emptied of blanks before storing (matching the
 * lowercased `accounts` index on `reviewGames`). Throws when the profile
 * doesn't exist — fail fast.
 */
export async function setProfileReviewAccounts(id: string, accounts: string[]): Promise<void> {
	const cleaned = [...new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))];
	const c = await collection();
	const result = await c.updateOne({ _id: id }, { $set: { reviewAccounts: cleaned } });
	if (result.matchedCount === 0) throw new Error(`profile ${id} not found`);
	cachePromise = null;
}
