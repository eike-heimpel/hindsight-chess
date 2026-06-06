import { analyzeGame } from '$lib/client/reviewAnalysis';
import { explainMove } from '$lib/client/reviewExplain';
import type { GameAnalysis } from '$lib/review/analysis';
import type { ReviewGame } from '$lib/review/types';

/**
 * The review page's analyze + explain orchestration, lifted out of the route
 * (CLAUDE.md: the page stays thin; async orchestration belongs in a rune module —
 * same pattern as `createExploreLine` / `createCoachThread`). It owns the cached
 * analysis (recomputable in-browser), the per-ply LLM explanations, and the
 * in-flight/error flags for both.
 *
 * Seed values are captured once at construction (the page mounts fresh per game,
 * so there is no stale state to reset) — pass `untrack`ed `data` fields in. The
 * page's reactive `ply` is handed to `runExplain` per call rather than captured,
 * so the module never reaches back into page state.
 *
 * `onAnalyzed` fires after a fresh analysis lands so the page can rebuild anything
 * that captured the old (null) analysis by value — the coach thread does. This is
 * an explicit callback (an event), never an `$effect` copying state→state.
 */
export function createReviewSession(opts: {
	game: ReviewGame;
	analysis: GameAnalysis | null;
	explanations: Record<number, string>;
	onAnalyzed?: (analysis: GameAnalysis) => void;
}) {
	const { game, onAnalyzed } = opts;

	let analysis = $state<GameAnalysis | null>(opts.analysis);
	let analyzing = $state(false);
	let progress = $state<{ done: number; total: number }>({ done: 0, total: 0 });
	let analyzeError = $state<string | null>(null);
	let cacheNote = $state<string | null>(null);

	let explanations = $state<Record<number, string>>(opts.explanations);
	let explaining = $state(false);
	let explainError = $state<string | null>(null);

	async function runAnalysis() {
		analyzing = true;
		analyzeError = null;
		cacheNote = null;
		progress = { done: 0, total: 0 };
		const result = await analyzeGame(game, (done, total) => (progress = { done, total }));
		analyzing = false;
		if (!result.ok) {
			analyzeError = result.error.message;
			return;
		}
		analysis = result.value.analysis;
		const res = await fetch('/api/review/analyze', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: result.value.analysis.source,
				gameId: result.value.analysis.gameId,
				depth: result.value.analysis.depth,
				evals: result.value.evals
			})
		});
		if (!res.ok) cacheNote = 'Analysis computed but could not be cached.';
		onAnalyzed?.(analysis);
	}

	async function runExplain(ply: number, regenerate = false) {
		explaining = true;
		explainError = null;
		const result = await explainMove(game, ply, undefined, { regenerate });
		explaining = false;
		if (!result.ok) {
			explainError = result.error.message;
			return;
		}
		explanations = { ...explanations, [ply]: result.value.text };
	}

	return {
		get analysis() {
			return analysis;
		},
		get analyzing() {
			return analyzing;
		},
		get progress() {
			return progress;
		},
		get analyzeError() {
			return analyzeError;
		},
		get cacheNote() {
			return cacheNote;
		},
		get explanations() {
			return explanations;
		},
		get explaining() {
			return explaining;
		},
		get explainError() {
			return explainError;
		},
		runAnalysis,
		runExplain
	};
}

export type ReviewSession = ReturnType<typeof createReviewSession>;
