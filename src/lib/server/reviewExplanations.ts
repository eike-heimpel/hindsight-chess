import { collectionAccessor } from './db.ts';
import type { ReviewSource } from '$lib/review/types';
import type { Side } from '$lib/chess/types';

/**
 * Cache of LLM move explanations, keyed `source:gameId:ply:perspective`. On-demand
 * and idempotent: a repeat "explain this move" re-serves the stored text instead
 * of burning another LLM call. Separate from `reviewAnalysis` so the deterministic
 * analysis stays free of LLM concerns.
 *
 * The `perspective` is the *viewer's* colour: the same move reads differently to
 * each side ("you played Nxd5" for the mover, "White played Nxd5" for the
 * opponent), so it is part of the key — two perspectives never share an entry.
 * The cache stays global across users (cost still dedupes between the two players
 * of a game), only now split by which side is reviewing.
 */
export type ReviewExplanation = {
	source: ReviewSource;
	gameId: string;
	ply: number;
	/** The viewer's colour — see the module note on why it keys the cache. */
	perspective: Side;
	text: string;
	createdAt: string;
};

type ReviewExplanationDoc = ReviewExplanation & { _id: string };

function docId(source: ReviewSource, gameId: string, ply: number, perspective: Side): string {
	return `${source}:${gameId}:${ply}:${perspective}`;
}

const collection = collectionAccessor<ReviewExplanationDoc>('reviewExplanations');

export async function getExplanation(
	source: ReviewSource,
	gameId: string,
	ply: number,
	perspective: Side
): Promise<string | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: docId(source, gameId, ply, perspective) });
	return doc?.text ?? null;
}

/** Cached explanations for a game from one side's perspective, as a `ply → text`
 *  map for seeding the UI. */
export async function listExplanations(
	source: ReviewSource,
	gameId: string,
	perspective: Side
): Promise<Record<number, string>> {
	const c = await collection();
	const docs = await c.find({ source, gameId, perspective }).toArray();
	const out: Record<number, string> = {};
	for (const d of docs) out[d.ply] = d.text;
	return out;
}

export async function saveExplanation(e: ReviewExplanation): Promise<void> {
	const c = await collection();
	const _id = docId(e.source, e.gameId, e.ply, e.perspective);
	await c.updateOne({ _id }, { $set: { ...e, _id } }, { upsert: true });
}
