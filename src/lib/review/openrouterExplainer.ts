import { chatCompletion } from '../llm/openrouterClient.ts';
import type { ReviewExplainFacts } from './explain.ts';
import type { ReviewExplainer, ReviewExplainerOutput } from './explainer.ts';
import { buildExplainPrompt } from './explainPrompt.ts';

/**
 * OpenRouter-backed review explainer. Same client / model / auth as the coach
 * and spotlight; separate concern (adult analytical annotation), separate
 * prompt + sampling. A touch warmer than the spotlight (0.3 vs 0.2) since the
 * audience is an adult and the prose is longer, but still grounding-first.
 *
 * Reasoning is disabled: the task is grounded fact-stitching, and on the default
 * thinking model (`~google/gemini-flash-latest`) chain-of-thought both added
 * latency and bled a fact-verification trace ("... -> True") into the answer.
 * With it off, `maxTokens` is just generous headroom so the prose is never cut.
 */
export type OpenRouterExplainerOptions = {
	apiKey: string;
	model: string;
	referer?: string;
	title?: string;
	fetchFn?: typeof fetch;
};

export class OpenRouterReviewExplainer implements ReviewExplainer {
	constructor(private readonly opts: OpenRouterExplainerOptions) {
		if (!opts.apiKey) throw new Error('OpenRouterReviewExplainer: apiKey is required');
		if (!opts.model) throw new Error('OpenRouterReviewExplainer: model is required');
	}

	async explain(facts: ReviewExplainFacts, correction?: string): Promise<ReviewExplainerOutput> {
		const { system, user } = buildExplainPrompt(facts);
		const userMessage = correction
			? `${user}\n\nA fact-check rejected your previous draft for these PROVEN-FALSE claims. Rewrite the annotation so none of them appear, staying strictly within the facts above:\n- ${correction}`
			: user;
		const text = await chatCompletion({
			apiKey: this.opts.apiKey,
			model: this.opts.model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userMessage }
			],
			temperature: 0.3,
			maxTokens: 2000,
			reasoning: { enabled: false },
			title: this.opts.title ?? 'my-chess-review-explain',
			referer: this.opts.referer,
			fetchFn: this.opts.fetchFn
		});
		return { text };
	}
}
