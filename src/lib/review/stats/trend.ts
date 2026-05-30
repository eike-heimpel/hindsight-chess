/**
 * Pure trend helpers for the "Am I improving?" cards. Operate on a chronological
 * (oldest→newest) value series. Tiny + dependency-free so they unit-test without
 * a chart or DOM.
 *
 * The cards answer a *trend* question, so we never compare two single games
 * (endpoint noise). Instead we compare a recent window against an earlier one,
 * and report a noisy stat's "current level" as a recent average rather than the
 * last (noisy) game.
 */

function mean(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Recent-window mean minus earlier-window mean — a noise-robust "which way is
 *  it going?". Splits the series into thirds (clamped to `minWindow`) and
 *  compares the most-recent third against the first. Returns null when there
 *  aren't enough games to split into two non-overlapping windows. */
export function windowTrend(
	values: number[],
	minWindow = 3
): { delta: number; recent: number; earlier: number } | null {
	const n = values.length;
	if (n < minWindow * 2) return null;
	const k = Math.max(minWindow, Math.floor(n / 3));
	const earlier = mean(values.slice(0, k));
	const recent = mean(values.slice(n - k));
	return { delta: recent - earlier, recent, earlier };
}

/** Mean of the last `window` games (fewer if the series is short). The honest
 *  "current level" for a noisy per-game stat — one game is mostly noise. */
export function recentMean(values: number[], window = 5): number | null {
	if (values.length === 0) return null;
	return mean(values.slice(Math.max(0, values.length - window)));
}
