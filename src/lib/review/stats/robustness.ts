/**
 * "Did I actually hold this, or was it a one-ply engine spike?" — the shared
 * robustness reasoning both the winnable-loss dive and the blunder trainer lean
 * on, so the concept lives in one place instead of being re-derived per page.
 *
 * The engine's per-move win-% drop is an honest measure of *outcome impact*, but
 * a poor measure of *what you could realistically have done*: a deep forced line
 * (mate-in-12, an only-move tactic) shows up as a one-ply spike to ~100% that you
 * never held. Two complementary lenses strip that out:
 *
 *  - `longestRunAtOrAbove` — duration: how many of my consecutive moves entered
 *    at/above a level. A real advantage persists; a spike doesn't. (Winnable.)
 *  - `sustainedLoss` — magnitude relative to what I *held*: how far below my own
 *    previously-held win-% I ended up, ignoring advantage that merely appeared on
 *    the opponent's move. A spike I failed to exploit scores ~0 here. (Blunders.)
 */

/** Longest run of consecutive values that are >= `floor`. Values are a single
 *  side's per-move series (e.g. my win-% entering each of my moves). */
export function longestRunAtOrAbove(values: number[], floor: number): number {
	let best = 0;
	let run = 0;
	for (const v of values) {
		if (v >= floor) {
			run += 1;
			best = Math.max(best, run);
		} else {
			run = 0;
		}
	}
	return best;
}

/**
 * How much of an advantage I *held entering the move* did this move actually
 * give up. The baseline is my win-% after my previous move (the level I'd reached
 * by my own play); `held` falls back to this move's `winBefore` when there's no
 * prior move. The loss is `max(0, held - winAfter)`.
 *
 * This separates a real thrown-away advantage (held high, dropped) from an engine
 * spike that materialised on the opponent's move and that I merely failed to
 * convert (held ≈ where I end up → ~0 loss).
 */
export function sustainedLoss(args: {
	winBefore: number;
	winAfter: number;
	prevWinAfter?: number;
}): number {
	const held = args.prevWinAfter ?? args.winBefore;
	return Math.max(0, held - args.winAfter);
}
