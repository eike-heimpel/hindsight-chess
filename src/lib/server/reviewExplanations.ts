import { collectionAccessor } from './db.ts';
import type { ReviewSource } from '$lib/review/types';

/**
 * Cache of LLM move explanations, keyed `source:gameId:ply`. On-demand and
 * idempotent: a repeat "explain this move" re-serves the stored text instead of
 * burning another LLM call. Separate from `reviewAnalysis` so the deterministic
 * analysis stays free of LLM concerns.
 */
export type ReviewExplanation = {
	source: ReviewSource;
	gameId: string;
	ply: number;
	text: string;
	createdAt: string;
};

type ReviewExplanationDoc = ReviewExplanation & { _id: string };

function docId(source: ReviewSource, gameId: string, ply: number): string {
	return `${source}:${gameId}:${ply}`;
}

const collection = collectionAccessor<ReviewExplanationDoc>('reviewExplanations');

export async function getExplanation(
	source: ReviewSource,
	gameId: string,
	ply: number
): Promise<string | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: docId(source, gameId, ply) });
	return doc?.text ?? null;
}

/** All cached explanations for a game, as a `ply → text` map for seeding the UI. */
export async function listExplanations(
	source: ReviewSource,
	gameId: string
): Promise<Record<number, string>> {
	const c = await collection();
	const docs = await c.find({ source, gameId }).toArray();
	const out: Record<number, string> = {};
	for (const d of docs) out[d.ply] = d.text;
	return out;
}

export async function saveExplanation(e: ReviewExplanation): Promise<void> {
	const c = await collection();
	const _id = docId(e.source, e.gameId, e.ply);
	await c.updateOne({ _id }, { $set: { ...e, _id } }, { upsert: true });
}
