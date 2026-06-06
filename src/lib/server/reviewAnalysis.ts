import { collectionAccessor } from './db.ts';
import type { GameAnalysis } from '$lib/review/analysis';
import type { ReviewSource } from '$lib/review/types';

/**
 * Cache of computed game analyses. Analysis is produced by the browser engine
 * (Vercel can't run 40+ evals in <10s), so the server only stores what the
 * client computed and serves it back on revisit. Keyed `source:gameId` — a
 * deeper re-analysis simply overwrites.
 */

export type ReviewAnalysisDoc = GameAnalysis & { _id: string };

function docId(source: ReviewSource, gameId: string): string {
	return `${source}:${gameId}`;
}

const collection = collectionAccessor<ReviewAnalysisDoc>('reviewAnalysis');

export async function getAnalysis(
	source: ReviewSource,
	gameId: string
): Promise<GameAnalysis | null> {
	const c = await collection();
	const doc = await c.findOne({ _id: docId(source, gameId) });
	if (!doc) return null;
	const { _id, ...analysis } = doc; // strip Mongo _id
	return analysis;
}

/** Analyses for a batch of games, keyed `source:gameId`. Missing games are
 *  simply absent from the map — the stats layer treats them as un-analyzed. */
export async function getAnalysesByIds(
	refs: { source: ReviewSource; gameId: string }[]
): Promise<Map<string, GameAnalysis>> {
	if (refs.length === 0) return new Map();
	const c = await collection();
	const ids = refs.map((r) => docId(r.source, r.gameId));
	const docs = await c.find({ _id: { $in: ids } }).toArray();
	return new Map(
		docs.map((doc) => {
			const { _id, ...analysis } = doc; // strip Mongo _id
			return [`${analysis.source}:${analysis.gameId}`, analysis] as const;
		})
	);
}

export async function saveAnalysis(analysis: GameAnalysis): Promise<void> {
	const c = await collection();
	const _id = docId(analysis.source, analysis.gameId);
	await c.updateOne({ _id }, { $set: { ...analysis, _id } }, { upsert: true });
}
