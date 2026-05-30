import { collectionAccessor } from './db.ts';
import type { Side } from '$lib/chess/types';
import type { ReviewSource } from '$lib/review/types';

/**
 * Cache of LLM "story" headlines, keyed `source:gameId:side`. Mirrors
 * `reviewExplanations.ts`: idempotent, so a repeat home visit re-serves the
 * stored sentence instead of burning another LLM call. Keyed by `side` because
 * the headline is my-POV ("you were winning") — the same game from each color is
 * a different story; like the analyze/explain caches it's global across users by
 * design (cost dedupe — see CLAUDE.md trust model).
 */
export type ReviewHeadline = {
	source: ReviewSource;
	gameId: string;
	side: Side;
	text: string;
	createdAt: string;
};

type ReviewHeadlineDoc = ReviewHeadline & { _id: string };

function docId(source: ReviewSource, gameId: string, side: Side): string {
	return `${source}:${gameId}:${side}`;
}

const collection = collectionAccessor<ReviewHeadlineDoc>('reviewHeadlines');

export async function getHeadline(
	source: ReviewSource,
	gameId: string,
	side: Side
): Promise<string | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: docId(source, gameId, side) });
	return doc?.text ?? null;
}

/** Cached headlines for a batch of recents, keyed `source:gameId:side` — the
 *  home loader seeds SSR from this so a known story shows with no flash. */
export async function getHeadlinesByIds(
	refs: { source: ReviewSource; gameId: string; side: Side }[]
): Promise<Map<string, string>> {
	if (refs.length === 0) return new Map();
	const c = await collection();
	const ids = refs.map((r) => docId(r.source, r.gameId, r.side));
	const docs = await c.find({ _id: { $in: ids } }).toArray();
	return new Map(docs.map((d) => [d._id, d.text] as const));
}

export async function saveHeadline(h: ReviewHeadline): Promise<void> {
	const c = await collection();
	const _id = docId(h.source, h.gameId, h.side);
	await c.updateOne({ _id }, { $set: { ...h, _id } }, { upsert: true });
}
