import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { drawLine as drawLineReveal, initialState, type GameState } from './recapReveal';
import type { RecapEngine, RecapRef } from './recapEngine';

/**
 * The home's per-game reveal queue, lifted out of the page so the concurrency
 * logic — the part most likely to break subtly — is unit-testable against a
 * scripted fake engine.
 *
 * Guarantees (preserved 1:1 from the original component):
 *   - single-flight: one `pump` loop, one reveal in flight (the engine is one
 *     Web Worker, no preempt);
 *   - dedup: a game already running/done/errored is never re-enqueued
 *     (`isUntouched`);
 *   - cancellation: `cancel()` halts the loop and every engine `await` checks it
 *     (used on unmount);
 *   - eager cap: only the newest `EAGER_ANALYZE_CAP` unanalyzed games auto-run;
 *   - flip-to-front: visiting an untouched game jumps it ahead of the cap.
 *
 * `states` is a `SvelteMap` so the page's `view` merge re-derives across the
 * module boundary as reveals patch it. Control state (`queue`, `processing`,
 * `cancelled`) is deliberately plain (non-reactive) — nothing renders off it.
 */

const EAGER_ANALYZE_CAP = 3;

export function keyOf(r: { source: string; gameId: string }): string {
	return `${r.source}:${r.gameId}`;
}

export function createRecapQueue({ engine }: { engine: RecapEngine }) {
	const states = new SvelteMap<string, GameState>();
	// Games whose line-draw has already played — so flipping away and back
	// doesn't replay it.
	const hasAnimated = new SvelteSet<string>();
	// A static key→recap lookup populated once in `start()`; deliberately a plain
	// (non-reactive) Map — nothing renders off it.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const recapByKey = new Map<string, RecapRef>();

	const queue: string[] = [];
	let processing = false;
	let cancelled = false;

	function patch(k: string, p: Partial<GameState>) {
		const prev: GameState = states.get(k) ?? initialState();
		// Always replace the value object so `states` (a SvelteMap) re-derives.
		states.set(k, { ...prev, ...p });
	}

	function isUntouched(k: string): boolean {
		const s = states.get(k);
		return !s || s.phase === 'pending';
	}

	async function processOne(k: string) {
		if (!isUntouched(k)) return; // dedupe — already running / done / errored
		const recap = recapByKey.get(k);
		if (!recap) return;
		await engine.reveal(recap, {
			onPatch: (p) => patch(k, p),
			cancelled: () => cancelled
		});
	}

	async function pump() {
		if (processing) return;
		processing = true;
		try {
			while (queue.length && !cancelled) {
				await processOne(queue.shift()!);
			}
		} finally {
			processing = false;
		}
	}

	return {
		/** The live state for a game key, or undefined before it's been touched. */
		get(key: string): GameState | undefined {
			return states.get(key);
		},

		/** Register the recents and eager-enqueue the newest unanalyzed ones (cap). */
		start(recents: RecapRef[]) {
			for (const r of recents) recapByKey.set(keyOf(r), r);
			let count = 0;
			for (const r of recents) {
				if (count >= EAGER_ANALYZE_CAP) break;
				const k = keyOf(r);
				if (r.analyzed || !isUntouched(k) || queue.includes(k)) continue;
				queue.push(k);
				count++;
			}
			pump();
		},

		/**
		 * On-flip lazy analysis: flipping to an untouched, unanalyzed game jumps it
		 * to the front of the queue. Sequential (no preempt) — the in-flight game
		 * finishes, then this one runs.
		 */
		flipTo(key: string | null) {
			if (!key) return;
			const recap = recapByKey.get(key);
			if (!recap || recap.analyzed || !isUntouched(key) || queue.includes(key)) return;
			queue.unshift(key);
			pump();
		},

		/** Halt the loop — call on unmount. Every engine `await` checks this. */
		cancel() {
			cancelled = true;
		},

		/** Line-draw the sparkline once per game, on the pending→analyzed reveal. */
		drawLine(key: string, animate: boolean) {
			return drawLineReveal(key, animate, hasAnimated);
		}
	};
}

export type RecapQueue = ReturnType<typeof createRecapQueue>;
