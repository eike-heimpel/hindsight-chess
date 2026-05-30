import type { ReviewExplainFacts } from './explain.ts';
import type { ReviewExplainer, ReviewExplainerOutput } from './explainer.ts';

/**
 * Deterministic explainer for tests / no-key dev. Stitches the grounded facts
 * into a plain sentence or two — no network, no model. Also doubles as the
 * shape the OpenRouter impl is expected to roughly produce.
 */
export class StubReviewExplainer implements ReviewExplainer {
	async explain(facts: ReviewExplainFacts): Promise<ReviewExplainerOutput> {
		const head = `${facts.mover} played ${facts.moveNumber}. ${facts.playedSan} (${facts.classification}).`;
		const mainLine = facts.lines[0]?.sanLine;

		if (facts.isBest) {
			const tail = mainLine ? ` It matches the engine's choice; the line runs ${mainLine}.` : '';
			return { text: head + tail };
		}

		const better = `The engine prefers ${facts.bestSan} (${facts.lines[0]?.evalText ?? '?'})${
			mainLine ? `: ${mainLine}` : ''
		}.`;
		const reply = facts.replySanLine ? ` After ${facts.playedSan}, ${facts.replySanLine}.` : '';
		return { text: `${head} ${better}${reply}` };
	}
}
