/**
 * Accuracy %, lichess model. A move's accuracy is an exponential decay of the
 * win-% it conceded; a game's per-side accuracy is lichess' volatility-weighted
 * blend — the mean of a window-weighted mean and the harmonic mean of the move
 * accuracies. The harmonic mean punishes a single bad move hard; the weighting
 * trusts moves in sharp positions more than moves in dead-quiet ones. A plain
 * mean (what we shipped first) systematically *overscores* — see the
 * calibration finding in `docs/review.md`.
 *
 * Ported from lila `AccuracyPercent.gameAccuracy`. Win-% are White-POV.
 */
import type { Side } from '$lib/chess/types';

const ACC_A = 103.1668100711649;
const ACC_B = -0.04354415386753951;
const ACC_C = -3.166924740191411;
/** Bonus for analysis imperfection, so a near-best move still reads as ~100. */
const UNCERTAINTY_BONUS = 1;

/** Per-move accuracy from the win-% it conceded (mover POV, >= 0). */
export function moveAccuracy(winDrop: number): number {
	if (winDrop <= 0) return 100;
	const raw = ACC_A * Math.exp(ACC_B * winDrop) + ACC_C + UNCERTAINTY_BONUS;
	return Math.max(0, Math.min(100, raw));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Population standard deviation. */
function standardDeviation(xs: number[]): number {
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
	return Math.sqrt(variance);
}

/**
 * One weight per move, the volatility of the win-% window around it (lila's
 * sliding-window scheme: `windowSize - 2` leading copies of the first window,
 * then every sliding window). `winPercents` is White-POV, length `moves + 1`;
 * the returned array has length `moves`.
 */
function moveWeights(winPercents: number[], moveCount: number): number[] {
	const windowSize = clamp(Math.floor(moveCount / 10), 2, 8);
	const padded = Math.min(windowSize, winPercents.length) - 2;
	const windows: number[][] = [];
	const firstWindow = winPercents.slice(0, windowSize);
	for (let i = 0; i < padded; i++) windows.push(firstWindow);
	for (let i = 0; i + windowSize <= winPercents.length; i++) {
		windows.push(winPercents.slice(i, i + windowSize));
	}
	return windows.map((w) => clamp(standardDeviation(w), 0.5, 12));
}

function weightedMean(values: number[], weights: number[]): number {
	const wsum = weights.reduce((a, b) => a + b, 0);
	const dot = values.reduce((a, v, i) => a + v * weights[i], 0);
	return dot / wsum;
}

/** `n / Σ(1/a)`; a zero accuracy drives the result to 0 (1/0 → ∞ → 0). */
function harmonicMean(values: number[]): number {
	const recip = values.reduce((a, v) => a + 1 / v, 0);
	return values.length / recip;
}

/**
 * Per-side game accuracy (0..100). `winPercents` is the White-POV win-% of every
 * position (length `colors.length + 1`); `colors`/`deltas` are per move, deltas
 * the mover-POV win-% drop (>= 0).
 */
export function gameAccuracy(args: { winPercents: number[]; colors: Side[]; deltas: number[] }): {
	white: number;
	black: number;
} {
	const { winPercents, colors, deltas } = args;
	const weights = moveWeights(winPercents, colors.length);

	const bySide: Record<Side, { accs: number[]; weights: number[] }> = {
		w: { accs: [], weights: [] },
		b: { accs: [], weights: [] }
	};
	colors.forEach((color, i) => {
		bySide[color].accs.push(moveAccuracy(deltas[i]));
		bySide[color].weights.push(weights[i]);
	});

	const combine = (side: Side) => {
		const { accs, weights: w } = bySide[side];
		if (accs.length === 0) return 100;
		return (weightedMean(accs, w) + harmonicMean(accs)) / 2;
	};

	return { white: combine('w'), black: combine('b') };
}
