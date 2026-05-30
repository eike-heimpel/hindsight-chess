import { OpenRouterHeadlineWriter } from '$lib/review/openrouterHeadline';
import { getOpenRouterApiKey, getOpenRouterHeadlineModel, useRealCoach } from './env.ts';

/**
 * Build the "story" headline writer, or `null` when the LLM is off (tests / no
 * key / `USE_STUB_COACH=1`). Same `useRealCoach()` switch as the other LLM
 * surfaces — but unlike them this returns `null` rather than a stub, because the
 * headline's fallback is the deterministic `templateHeadline`, so callers just
 * use that when the writer is absent.
 */
export function makeHeadlineWriter(): OpenRouterHeadlineWriter | null {
	if (!useRealCoach()) return null;
	return new OpenRouterHeadlineWriter({
		apiKey: getOpenRouterApiKey(),
		model: getOpenRouterHeadlineModel()
	});
}
