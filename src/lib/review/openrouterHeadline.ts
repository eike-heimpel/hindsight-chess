import { chatCompletion } from '../llm/openrouterClient.ts';
import type { HeadlineFacts } from './headlineFacts.ts';
import { buildHeadlinePrompt } from './headlinePrompt.ts';

/**
 * OpenRouter-backed writer for the home card's "story" headline. One short,
 * grounded sentence — so a small fast model, low `maxTokens`, reasoning off
 * (the task is fact-stitching, not deliberation). Same client/auth as the move
 * explainer; separate concern, prompt and sampling.
 */
export type OpenRouterHeadlineOptions = {
	apiKey: string;
	model: string;
	referer?: string;
	title?: string;
	fetchFn?: typeof fetch;
};

export class OpenRouterHeadlineWriter {
	constructor(private readonly opts: OpenRouterHeadlineOptions) {
		if (!opts.apiKey) throw new Error('OpenRouterHeadlineWriter: apiKey is required');
		if (!opts.model) throw new Error('OpenRouterHeadlineWriter: model is required');
	}

	async write(facts: HeadlineFacts): Promise<string> {
		const { system, user } = buildHeadlinePrompt(facts);
		const text = await chatCompletion({
			apiKey: this.opts.apiKey,
			model: this.opts.model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			],
			temperature: 0.6,
			maxTokens: 64,
			reasoning: { enabled: false },
			title: this.opts.title ?? 'my-chess-review-headline',
			referer: this.opts.referer,
			fetchFn: this.opts.fetchFn
		});
		return text;
	}
}
