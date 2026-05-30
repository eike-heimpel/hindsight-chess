import type { ReviewGame, ReviewSource } from '$lib/review/types';
import { analyzeGame } from './reviewAnalysis';

/**
 * Batch-analyze a person's un-analyzed games for the stats screen. The page load
 * ships only game ids (cheap); here we fetch each full game, run the same browser
 * engine pass the replay page uses, and POST the result to the analysis cache.
 *
 * Sequential by design — one Web Worker, and we don't want to peg the tab. A
 * single game failing doesn't abort the run; failures are collected and reported
 * rather than hidden.
 */
export type GameRef = { source: ReviewSource; gameId: string };

export type BatchProgress = {
	gamesDone: number;
	gamesTotal: number;
	/** Position progress within the game currently being analyzed. */
	current: { done: number; total: number };
};

export type BatchResult = { analyzed: number; failed: { ref: GameRef; message: string }[] };

async function fetchGame(ref: GameRef): Promise<ReviewGame> {
	const res = await fetch(`/api/review/game/${ref.source}/${ref.gameId}`);
	if (!res.ok) throw new Error(`could not load game ${ref.gameId} (${res.status})`);
	return (await res.json()) as ReviewGame;
}

export async function batchAnalyze(
	pending: GameRef[],
	onProgress: (p: BatchProgress) => void
): Promise<BatchResult> {
	const failed: BatchResult['failed'] = [];
	let analyzed = 0;

	for (let i = 0; i < pending.length; i++) {
		const ref = pending[i];
		const report = (done: number, total: number) =>
			onProgress({ gamesDone: i, gamesTotal: pending.length, current: { done, total } });
		report(0, 0);

		try {
			const game = await fetchGame(ref);
			const result = await analyzeGame(game, report);
			if (!result.ok) {
				failed.push({ ref, message: result.error.message });
				continue;
			}
			const res = await fetch('/api/review/analyze', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(result.value)
			});
			if (!res.ok) {
				failed.push({ ref, message: `cache write failed (${res.status})` });
				continue;
			}
			analyzed++;
		} catch (e) {
			failed.push({ ref, message: e instanceof Error ? e.message : String(e) });
		}
	}

	onProgress({
		gamesDone: pending.length,
		gamesTotal: pending.length,
		current: { done: 0, total: 0 }
	});
	return { analyzed, failed };
}
