import type { GameState } from './recapReveal';
import { keyOf } from './recapQueue.svelte';
import type { RecapEngine } from './recapEngine';

/**
 * Dev-only mock engine for /?mock=1 — a scripted timing loop that fakes the
 * engine + LLM run so we can eyeball the recap reveal (fetching → analyzing
 * progress → sparkline line-draw → headline swap) without real games or auth.
 * Dynamically imported by the page so none of this ships in the production
 * bundle.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The reveal each unanalyzed mock game animates into: a win-% timeline plus the
// "story" headline that swaps in after the (fake) engine + LLM run. Keyed by
// `source:gameId` to match the page's fixtures.
const MOCK_REVEAL: Record<
	string,
	{ spark: number[]; accuracy: number; peakWin: number; headline: string }
> = {
	'chesscom:mock-1': {
		spark: [
			50, 53, 51, 55, 58, 56, 60, 57, 54, 50, 46, 48, 43, 40, 42, 38, 35, 33, 36, 30, 27, 24, 22, 20
		],
		accuracy: 71,
		peakWin: 60,
		headline:
			'Even after the engine ran, the verdict holds — a strong middlegame undone by a couple of late slips.'
	},
	'chesscom:mock-3': {
		spark: [50, 48, 52, 49, 53, 51, 47, 50, 54, 52, 48, 51, 49, 53, 50, 47, 52, 50, 49, 51, 50],
		accuracy: 80,
		peakWin: 54,
		headline: 'The engine agrees it was balanced throughout — a hard-earned, well-deserved draw.'
	}
};

export function createMockRecapEngine({ llmHeadlines }: { llmHeadlines: boolean }): RecapEngine {
	return {
		async reveal(recap, { onPatch, cancelled }) {
			const reveal = MOCK_REVEAL[keyOf(recap)];
			if (!reveal) return;
			const patch = (p: Partial<GameState>) => onPatch(p);

			patch({ phase: 'fetching', done: 0, total: 0 });
			await sleep(600);
			if (cancelled()) return;
			const total = reveal.spark.length;
			patch({ phase: 'analyzing', total });
			for (let done = 1; done <= total; done++) {
				await sleep(55);
				if (cancelled()) return;
				patch({ done });
			}
			patch({
				phase: 'analyzed',
				animateGraph: true,
				spark: reveal.spark,
				accuracy: reveal.accuracy,
				peakWin: reveal.peakWin
			});
			await sleep(2800); // let the line finish drawing before the headline swaps
			if (cancelled()) return;
			if (llmHeadlines) {
				patch({ phase: 'headlineLoading' });
				await sleep(1300);
				if (cancelled()) return;
				patch({ headline: reveal.headline });
			}
			patch({ phase: 'done' });
		}
	};
}
