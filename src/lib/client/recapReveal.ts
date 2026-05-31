import type { Side } from '$lib/chess/types';
import type { GameAnalysis } from '$lib/review/analysis';
import { recapOverlayFrom, sideFor } from '$lib/review/stats/perspective';
import type { ReviewGame } from '$lib/review/types';
import { analyzeGame } from './reviewAnalysis';

/**
 * The shared "a game comes alive" reveal: run the browser engine over a fetched
 * game and emit the recap fields the card animates in (win-% spark, accuracy,
 * peak). Extracted from the home loader so the home dashboard and the anonymous
 * landing teaser run one implementation, not two. Callers own everything around
 * it — fetching the game, persistence, the LLM headline — because those differ
 * (home persists + asks the LLM; the teaser stores nothing and builds a template
 * headline client-side).
 */

export type Phase =
	| 'pending'
	| 'fetching'
	| 'analyzing'
	| 'analyzed'
	| 'headlineLoading'
	| 'done'
	| 'error';

export type GameState = {
	phase: Phase;
	done: number;
	total: number;
	spark: number[] | null;
	accuracy: number | null;
	peakWin: number | null;
	headline: string | null;
	error: string | null;
	animateGraph: boolean;
};

/**
 * Floor for the "analyzing" beat — OPT-IN, via `revealGame`'s `beatMs`. A
 * shallow-depth pass over a short game can finish in well under a second, too
 * fast to register as a moment, so the reveal feels abrupt. Holding to this
 * floor gives a first-time visitor a beat to settle before the spark draws.
 *
 * Used ONLY by the anonymous landing teaser. In-app reveals (the home, add-
 * account) deliberately pass no beat: there we never want to make analysis feel
 * longer than it is. When the real analysis already exceeds the floor, there's
 * no artificial wait regardless.
 */
export const REVEAL_BEAT_MS = 4000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function initialState(): GameState {
	return {
		phase: 'pending',
		done: 0,
		total: 0,
		spark: null,
		accuracy: null,
		peakWin: null,
		headline: null,
		error: null,
		animateGraph: false
	};
}

export type RevealResult = { ok: true; analysis: GameAnalysis; side: Side } | { ok: false };

/**
 * Analyze a fetched game and emit the reveal patches. Starts at `analyzing`
 * (the caller owns the `fetching` step that produced `game`). On success patches
 * `analyzed` with the overlay and returns the analysis + side so the caller can
 * persist it or derive a headline.
 */
export async function revealGame(
	game: ReviewGame,
	opts: {
		accounts: Set<string>;
		depth?: number;
		/** Minimum wall-clock for the "analyzing" beat (see REVEAL_BEAT_MS).
		 *  Teaser-only; omit in-app so the reveal never feels padded. */
		beatMs?: number;
		onPatch: (p: Partial<GameState>) => void;
		cancelled?: () => boolean;
	}
): Promise<RevealResult> {
	const { accounts, depth, beatMs = 0, onPatch, cancelled } = opts;

	const startedAt = performance.now();
	onPatch({ phase: 'analyzing', done: 0, total: 0 });
	const result = await analyzeGame(game, (done, total) => onPatch({ done, total }), depth);
	if (cancelled?.()) return { ok: false };
	if (!result.ok) {
		onPatch({ phase: 'error', error: result.error.message });
		return { ok: false };
	}

	const side = sideFor(game, accounts);
	if (!side) {
		onPatch({ phase: 'error', error: 'not your game' });
		return { ok: false };
	}

	// Hold the beat to its floor (teaser only) — a no-op when analysis already
	// took longer, so in-app reveals are never slowed.
	const remaining = beatMs - (performance.now() - startedAt);
	if (remaining > 0) await sleep(remaining);
	if (cancelled?.()) return { ok: false };

	const overlay = recapOverlayFrom(result.value, side);
	onPatch({
		phase: 'analyzed',
		animateGraph: true,
		spark: overlay.spark,
		accuracy: overlay.accuracy,
		peakWin: overlay.peakWin
	});
	return { ok: true, analysis: result.value, side };
}

/**
 * Line-draw the sparkline polyline once, on the pending→analyzed reveal only.
 * `seen` dedupes per game-key so flipping away and back doesn't replay it; pass a
 * fresh set for a one-shot context like the landing teaser.
 *
 * preserveAspectRatio="none" + non-scaling-stroke means the dash is measured in
 * screen pixels, while getTotalLength() is in viewBox units — the mismatch makes
 * the dash repeat into gaps. So we compute the rendered pixel length ourselves.
 */
export function drawLine(key: string, animate: boolean, seen: Set<string>) {
	return (node: SVGPolylineElement) => {
		if (!animate || seen.has(key)) return;
		seen.add(key);
		const rect = (node.ownerSVGElement ?? node).getBoundingClientRect();
		const sx = rect.width / 100;
		const sy = rect.height / 30;
		const pts = node.points;
		let len = 0;
		for (let i = 1; i < pts.numberOfItems; i++) {
			const a = pts.getItem(i - 1);
			const b = pts.getItem(i);
			len += Math.hypot((b.x - a.x) * sx, (b.y - a.y) * sy);
		}
		node.style.transition = 'none';
		node.style.strokeDasharray = `${len}`;
		node.style.strokeDashoffset = `${len}`;
		node.getBoundingClientRect(); // force reflow so the offset takes before we animate
		node.style.transition = 'stroke-dashoffset 2.6s ease-out';
		node.style.strokeDashoffset = '0';
	};
}
