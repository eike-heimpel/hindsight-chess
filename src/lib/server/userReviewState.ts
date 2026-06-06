import { collectionAccessor } from './db.ts';
import type { MoveRef } from './userMoveState.ts';

/**
 * General per-user review-session doc (`_id = userId`). Deliberately not a
 * cursor-only collection: foreseeable additive scalars (a "since last time"
 * watermark, a streak) land here without a migration. Today it carries only the
 * resume cursors. Mirrors `userSettings.ts`: defaults-when-missing. See
 * `docs/persistence.md`.
 */

export type ReviewState = {
	/** Resume pointer per queue, e.g. `{ blunders: {source,gameId,ply} }`. */
	cursors: Record<string, MoveRef>;
};

const DEFAULTS: ReviewState = { cursors: {} };

type ReviewStateDoc = ReviewState & { _id: string; updatedAt: Date };

const collection = collectionAccessor<ReviewStateDoc>('userReviewState');

export async function getReviewState(userId: string): Promise<ReviewState> {
	const c = await collection();
	const doc = await c.findOne({ _id: userId });
	if (!doc) return { cursors: { ...DEFAULTS.cursors } };
	return { cursors: doc.cursors ?? {} };
}

/** Point a queue's resume cursor at a move, or clear it with `null`. */
export async function setCursor(userId: string, queue: string, ref: MoveRef | null): Promise<void> {
	const c = await collection();
	if (ref === null) {
		await c.updateOne(
			{ _id: userId },
			{ $unset: { [`cursors.${queue}`]: '' as const }, $set: { updatedAt: new Date() } },
			{ upsert: true }
		);
		return;
	}
	await c.updateOne(
		{ _id: userId },
		{ $set: { [`cursors.${queue}`]: ref, updatedAt: new Date() } },
		{ upsert: true }
	);
}

/** Drop all cursors — the cursor half of the full per-user reset. */
export async function clearCursors(userId: string): Promise<void> {
	const c = await collection();
	await c.updateOne(
		{ _id: userId },
		{ $set: { cursors: {}, updatedAt: new Date() } },
		{ upsert: true }
	);
}
