import type { ReviewExplainer } from '$lib/review/explainer';
import { OpenRouterReviewExplainer } from '$lib/review/openrouterExplainer';
import { StubReviewExplainer } from '$lib/review/stubExplainer';
import { getOpenRouterApiKey, getOpenRouterModel, useRealCoach } from './env.ts';

/**
 * Decide which ReviewExplainer to use. Same `useRealCoach()` toggle as the
 * coach / reflection / spotlight factories — one switch, all LLM surfaces.
 */
export function makeReviewExplainer(): ReviewExplainer {
	if (!useRealCoach()) return new StubReviewExplainer();
	return new OpenRouterReviewExplainer({
		apiKey: getOpenRouterApiKey(),
		model: getOpenRouterModel()
	});
}
