import { describe, it, expect } from 'vitest';
import { createRecapQueue, keyOf, type RecapQueue } from './recapQueue.svelte';
import type { RecapEngine, RecapRef } from './recapEngine';
import type { GameState } from './recapReveal';

/**
 * The capability this refactor unlocks: the reveal queue's concurrency logic —
 * eager cap, dedup, flip-to-front, single-flight, cancellation — exercised
 * directly against a scripted fake engine, no browser/Stockfish needed.
 */

const ref = (gameId: string, analyzed = false): RecapRef => ({
	source: 'chesscom',
	gameId,
	analyzed
});

/** A controllable fake: each `reveal` parks on a promise the test resolves, so
 *  we can observe order and concurrency. Records the keys it was asked to run. */
function scriptedEngine() {
	const started: string[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const gates: Record<string, () => void> = {};

	const engine: RecapEngine = {
		async reveal(recap, { onPatch, cancelled }) {
			const k = keyOf(recap);
			started.push(recap.gameId);
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			onPatch({ phase: 'fetching' });
			try {
				await new Promise<void>((resolve) => {
					gates[k] = resolve;
				});
				if (cancelled()) return;
				onPatch({ phase: 'done' });
			} finally {
				inFlight--;
			}
		}
	};

	return {
		engine,
		started,
		get maxInFlight() {
			return maxInFlight;
		},
		/** Release one parked reveal and let the microtask queue drain. */
		async release(gameId: string) {
			gates[keyOf(ref(gameId))]?.();
			await flush();
		}
	};
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const phase = (q: RecapQueue, gameId: string): GameState['phase'] | undefined =>
	q.get(keyOf(ref(gameId)))?.phase;

describe('createRecapQueue', () => {
	it('eager-enqueues only the newest cap (3) of unanalyzed games', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		q.start([ref('1'), ref('2'), ref('3'), ref('4'), ref('5')]);
		await flush();

		// One in flight; the rest queued behind it. The 4th/5th never enter the
		// eager window at all.
		expect(s.started).toEqual(['1']);
		await s.release('1');
		await s.release('2');
		await s.release('3');
		expect(s.started).toEqual(['1', '2', '3']);
		// 4 and 5 were past the cap — untouched, never revealed.
		expect(phase(q, '4')).toBeUndefined();
		expect(phase(q, '5')).toBeUndefined();
	});

	it('skips already-analyzed games when filling the eager window', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		q.start([ref('1', true), ref('2'), ref('3')]);
		await flush();
		await s.release('2');
		await s.release('3');
		expect(s.started).toEqual(['2', '3']);
	});

	it('runs one reveal at a time (single-flight)', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		q.start([ref('1'), ref('2'), ref('3')]);
		await flush();
		// Only the first has started while it's parked.
		expect(s.started).toEqual(['1']);
		await s.release('1');
		await s.release('2');
		await s.release('3');
		expect(s.maxInFlight).toBe(1);
	});

	it('flipTo jumps an untouched game to the front of the queue', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		// Eager runs 1,2,3; 4 is past the cap. Flip to 4 while 1 is in flight.
		q.start([ref('1'), ref('2'), ref('3'), ref('4')]);
		await flush();
		q.flipTo(keyOf(ref('4')));
		await s.release('1'); // 1 finishes → 4 (unshifted) runs before 2
		expect(s.started).toEqual(['1', '4']);
	});

	it('flipTo does not re-run an in-flight or done game', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		q.start([ref('1'), ref('2')]);
		await flush();
		q.flipTo(keyOf(ref('1'))); // 1 is in flight — must be a no-op
		await s.release('1');
		q.flipTo(keyOf(ref('1'))); // 1 is done — still a no-op
		await s.release('2');
		expect(s.started).toEqual(['1', '2']);
	});

	it('cancel() halts the loop mid-reveal — no further games run', async () => {
		const s = scriptedEngine();
		const q = createRecapQueue({ engine: s.engine });
		q.start([ref('1'), ref('2'), ref('3')]);
		await flush();
		q.cancel();
		await s.release('1'); // 1's reveal returns early; the pump stops
		expect(s.started).toEqual(['1']);
		expect(phase(q, '1')).toBe('fetching'); // never advanced to 'done'
		expect(phase(q, '2')).toBeUndefined();
	});
});
