import { error } from '@sveltejs/kit';
import { collectionAccessor } from './db.ts';
import { getReviewGame } from './reviewGames.ts';
import { getExplanation } from './reviewExplanations.ts';
import { buildExplainFacts, type ReviewExplainRequest } from '$lib/review/explain';
import type { ReviewAccount, ReviewGame, ReviewSource } from '$lib/review/types';
import type { Side } from '$lib/chess/types';
import type { MoveClass } from '$lib/review/classify';
import type { DiscussTurn, Learning } from '$lib/review/coach/types';

/**
 * Per-user move-state — one doc per touched move, the substrate every per-user
 * review feature (mark, note, saved explanation, coach memory) attaches a facet
 * to. Mirrors `userSettings.ts`: `collectionAccessor`, defaults-when-missing, a
 * thin set of `userId`-first helpers. The four key fields are stored as separate
 * indexed fields (not only baked into `_id`) so future cross-user / cross-position
 * reads don't have to parse the composite id. See `docs/persistence.md`.
 */

/** Identity of one move, the atom of per-user state. */
export type MoveRef = { source: ReviewSource; gameId: string; ply: number };

/** Structured, re-derived snapshot of the engine facts at save time — the single
 *  source of truth a standalone share-card can later render from. Never copied
 *  from a cache; rebuilt server-side (see `freezeSnapshot`). */
export type SnapshotFacts = {
	fenBefore: string;
	playedSan: string;
	bestSan: string;
	bestUci: string;
	evalBefore: string;
	classification: MoveClass;
};

/** The four facets a feature attaches to a move (see the facet table in the doc). */
export type MoveState = {
	mark?: 'star' | 'done' | 'dismissed';
	note?: { text: string; updatedAt: Date };
	snapshot?: {
		text: string;
		facts: SnapshotFacts;
		from: 'explain' | 'coach';
		frozenAt: Date;
	};
	thread?: {
		messages: DiscussTurn[];
		learnings: Learning[];
		status: 'open' | 'wrapped';
		updatedAt: Date;
	};
};

type MoveStateDoc = MoveState & {
	/** `${userId}:${source}:${gameId}:${ply}` — composite, for uniqueness only.
	 *  `ply` is appended last and is a pure integer; `userId`/`source` are
	 *  delimiter-free, so a colon-bearing `gameId` can't shift the boundary. Never
	 *  reorder the segments. */
	_id: string;
	userId: string; // indexed field, not just an _id segment
	source: ReviewSource;
	gameId: string;
	ply: number;
	side: Side; // DERIVED server-side via the ownership gate, never trusted from a body
	updatedAt: Date;
};

const collection = collectionAccessor<MoveStateDoc>('userMoveState', (c) =>
	Promise.all([
		c.createIndex({ userId: 1, source: 1, gameId: 1 }),
		c.createIndex({ userId: 1, updatedAt: -1 })
	])
);

/** Composite `_id`. Load-bearing ordering — see the doc. */
export function moveStateId(userId: string, ref: MoveRef): string {
	return `${userId}:${ref.source}:${ref.gameId}:${ref.ply}`;
}

/** `source:gameId:ply` — the per-game-overlay map key (no userId; the map is
 *  already scoped to one user). */
function refKey(ref: MoveRef): string {
	return `${ref.source}:${ref.gameId}:${ref.ply}`;
}

/** Strip the Mongo-only / identity keys, leaving the facet view. */
function toState(doc: MoveStateDoc): MoveState {
	const { mark, note, snapshot, thread } = doc;
	const state: MoveState = {};
	if (mark) state.mark = mark;
	if (note) state.note = note;
	if (snapshot) state.snapshot = snapshot;
	if (thread) state.thread = thread;
	return state;
}

/** Per-game overlay, `ply → MoveState`. Mirrors `listExplanations` — one indexed
 *  range read of the user's touched moves in this game. */
export async function getGameMoveStates(
	userId: string,
	source: ReviewSource,
	gameId: string
): Promise<Record<number, MoveState>> {
	const c = await collection();
	const docs = await c.find({ userId, source, gameId }).toArray();
	const out: Record<number, MoveState> = {};
	for (const d of docs) out[d.ply] = toState(d);
	return out;
}

/** Batch read by ref, `source:gameId:ply → MoveState` — for the shortlist and
 *  study-sets, which query across games. */
export async function getMoveStatesByRefs(
	userId: string,
	refs: MoveRef[]
): Promise<Record<string, MoveState>> {
	if (refs.length === 0) return {};
	const c = await collection();
	const docs = await c.find({ _id: { $in: refs.map((r) => moveStateId(userId, r)) } }).toArray();
	const out: Record<string, MoveState> = {};
	for (const d of docs) out[refKey(d)] = toState(d);
	return out;
}

/** Everything the user starred, noted, or saved — newest-first. Only the `mark`
 *  branch is index-covered; `note`/`snapshot` fall back to a per-user scan,
 *  bounded by the user's touched-move count. */
export async function listShortlist(userId: string): Promise<MoveState[]> {
	const c = await collection();
	const docs = await c
		.find({
			userId,
			$or: [{ mark: 'star' }, { note: { $exists: true } }, { snapshot: { $exists: true } }]
		})
		.sort({ updatedAt: -1 })
		.toArray();
	return docs.map(toState);
}

export async function getMoveState(userId: string, ref: MoveRef): Promise<MoveState | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: moveStateId(userId, ref) });
	return doc ? toState(doc) : null;
}

/** Upsert one facet, stamping identity + derived `side` on insert. `side` is set
 *  via `$setOnInsert` so a body can never overwrite the server-derived value. */
async function upsertFacet(
	userId: string,
	ref: MoveRef,
	side: Side,
	patch: Partial<Pick<MoveStateDoc, 'mark' | 'note' | 'snapshot' | 'thread'>>
): Promise<void> {
	const c = await collection();
	await c.updateOne(
		{ _id: moveStateId(userId, ref) },
		{
			$set: { ...patch, updatedAt: new Date() },
			$setOnInsert: {
				userId,
				source: ref.source,
				gameId: ref.gameId,
				ply: ref.ply,
				side
			}
		},
		{ upsert: true }
	);
}

export async function setMark(
	userId: string,
	ref: MoveRef,
	side: Side,
	mark: NonNullable<MoveState['mark']>
): Promise<void> {
	await upsertFacet(userId, ref, side, { mark });
}

export async function setNote(
	userId: string,
	ref: MoveRef,
	side: Side,
	text: string
): Promise<void> {
	await upsertFacet(userId, ref, side, { note: { text, updatedAt: new Date() } });
}

export async function saveThread(
	userId: string,
	ref: MoveRef,
	side: Side,
	thread: NonNullable<MoveState['thread']>
): Promise<void> {
	await upsertFacet(userId, ref, side, { thread });
}

/** Remove one facet via `$unset`, leaving any coexisting facets intact — so
 *  un-starring a move doesn't drop a note saved on it. No-op if the doc is
 *  absent. */
async function unsetFacet(userId: string, ref: MoveRef, facet: keyof MoveState): Promise<void> {
	const c = await collection();
	await c.updateOne(
		{ _id: moveStateId(userId, ref) },
		{ $unset: { [facet]: '' }, $set: { updatedAt: new Date() } }
	);
}

export async function clearMark(userId: string, ref: MoveRef): Promise<void> {
	await unsetFacet(userId, ref, 'mark');
}

export async function clearNote(userId: string, ref: MoveRef): Promise<void> {
	await unsetFacet(userId, ref, 'note');
}

/** Remove one move's state entirely. */
export async function clearMove(userId: string, ref: MoveRef): Promise<void> {
	const c = await collection();
	await c.deleteOne({ _id: moveStateId(userId, ref) });
}

/** Wipe every touched move for the user. Atomic — no cross-references. */
export async function clearAllMoveState(userId: string): Promise<void> {
	const c = await collection();
	await c.deleteMany({ userId });
}

/**
 * Ownership gate for every per-user write. `getReviewGame` is a global lookup
 * with no ownership filter and `requireUser` only proves a session exists, so
 * without this any signed-in user could attach state to games they never played.
 * Re-reads the stored game, asserts the user owns a side, and DERIVES that side
 * server-side. Throws 404 (unknown game) / 403 (not the user's game).
 */
export async function gateOwnedGame(
	accounts: ReviewAccount[],
	ref: MoveRef
): Promise<{ game: ReviewGame; side: Side }> {
	const game = await getReviewGame(ref.source, ref.gameId);
	if (!game) throw error(404, 'unknown game');
	const side = ownedSide(game, accounts);
	if (!side) throw error(403, 'not your game');
	return { game, side };
}

/** The side the user played in this game — any owned account that matches a
 *  player, compared lowercased (the `coachedSide` shape). Null when none match.
 *  Source-qualified: the same username on chess.com and lichess are different
 *  people, so the account's source must match the game's. */
export function ownedSide(game: ReviewGame, accounts: ReviewAccount[]): Side | null {
	const white = game.white.username.toLowerCase();
	const black = game.black.username.toLowerCase();
	for (const a of accounts) {
		if (a.source !== game.source) continue;
		const u = a.username.toLowerCase();
		if (u === white) return 'w';
		if (u === black) return 'b';
	}
	return null;
}

/** Body the snapshot route forwards — the engine numbers, same shape `explain`
 *  takes, so facts are rebuilt by the identical validate-then-rebuild path. */
export type FreezeSnapshotBody = ReviewExplainRequest;

/**
 * Freeze a saved explanation: re-read the prose server-side (404 if it was never
 * generated), then rebuild the structured facts from the POSTed engine numbers —
 * validated against the stored move exactly as `explain/+server.ts` does. Facts
 * are STRUCTURED and re-derived, never copied from the cache (which stores only
 * text). `from:'coach'` is deferred to Phase 4.
 */
export async function freezeSnapshot(
	userId: string,
	game: ReviewGame,
	side: Side,
	body: FreezeSnapshotBody
): Promise<void> {
	const ref: MoveRef = { source: body.source, gameId: body.gameId, ply: body.ply };

	const text = await getExplanation(ref.source, ref.gameId, ref.ply);
	if (!text) throw error(404, 'no explanation to snapshot');

	const stored = game.moves[ref.ply - 1];
	if (!stored) throw error(400, `ply ${ref.ply} is out of range for this game`);
	if (stored.fenBefore !== body.fenBefore || stored.uci !== body.playedUci) {
		throw error(400, 'fenBefore/playedUci do not match the stored move');
	}

	let facts;
	try {
		facts = buildExplainFacts(body);
	} catch (e) {
		throw error(400, `Could not ground snapshot: ${e instanceof Error ? e.message : String(e)}`);
	}

	const snapshotFacts: SnapshotFacts = {
		fenBefore: body.fenBefore,
		playedSan: facts.playedSan,
		bestSan: facts.bestSan,
		bestUci: body.bestLines[0]!.moveUci,
		evalBefore: facts.lines[0]!.evalText,
		classification: facts.classification
	};

	await upsertFacet(userId, ref, side, {
		snapshot: { text, facts: snapshotFacts, from: 'explain', frozenAt: new Date() }
	});
}
