import { fetchGame } from './reviewStats';
import { revealGame, type GameState } from './recapReveal';
import type { ReviewSource } from '$lib/review/types';

/**
 * What the recap queue hands an engine to reveal. The minimal slice of a home
 * recent the engine cares about — enough to fetch + key the game.
 */
export type RecapRef = {
	source: string;
	gameId: string;
	analyzed: boolean;
};

/**
 * Reveals one game into its `GameState` patches. The queue owns scheduling,
 * dedup and cancellation; the engine owns the per-game work (fetch → analyze →
 * persist → headline). Injectable so the queue can be unit-tested against a
 * scripted fake, and so dev-only mock mode swaps in without touching the queue.
 */
export interface RecapEngine {
	reveal(
		recap: RecapRef,
		opts: { onPatch: (p: Partial<GameState>) => void; cancelled: () => boolean }
	): Promise<void>;
}

/**
 * The production engine: fetch the full game, run the browser Stockfish pass
 * (shared `revealGame`), persist the raw evals (the server re-derives the
 * analysis), then optionally upgrade the headline to a freshly-written story.
 */
export function createRealRecapEngine({
	accounts,
	llmHeadlines
}: {
	accounts: Set<string>;
	llmHeadlines: boolean;
}): RecapEngine {
	return {
		async reveal(recap, { onPatch, cancelled }) {
			onPatch({ phase: 'fetching', done: 0, total: 0 });
			try {
				const game = await fetchGame({
					source: recap.source as ReviewSource,
					gameId: recap.gameId
				});
				if (cancelled()) return;

				const revealed = await revealGame(game, {
					accounts,
					onPatch,
					cancelled
				});
				if (!revealed.ok || cancelled()) return;

				// Persist the analysis before the headline endpoint reads it. We send the
				// raw evals; the server re-derives the analysis from its own stored moves.
				await fetch('/api/review/analyze', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						source: revealed.analysis.source,
						gameId: revealed.analysis.gameId,
						depth: revealed.analysis.depth,
						evals: revealed.evals
					})
				});
				if (cancelled()) return;

				if (llmHeadlines) {
					onPatch({ phase: 'headlineLoading' });
					try {
						const res = await fetch('/api/review/headline', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ source: recap.source, gameId: recap.gameId })
						});
						if (res.ok) {
							const { text } = (await res.json()) as { text: string };
							if (text) onPatch({ headline: text });
						} else {
							console.warn('recap_headline_fetch_failed', {
								source: recap.source,
								gameId: recap.gameId,
								status: res.status
							});
						}
					} catch (e) {
						// Headline is non-critical — keep the template line, but log so a
						// sustained headline failure is visible rather than silent.
						console.warn('recap_headline_fetch_failed', {
							source: recap.source,
							gameId: recap.gameId,
							error: e instanceof Error ? e.message : String(e)
						});
					}
				}
				onPatch({ phase: 'done' });
			} catch (e) {
				onPatch({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
			}
		}
	};
}
