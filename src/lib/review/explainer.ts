import type { ReviewExplainFacts } from './explain';

/**
 * Review move explainer — turns grounded `ReviewExplainFacts` into an English
 * analytical annotation. Architectural twin of the opening `SpotlightWriter`:
 * one LLM call behind an interface, with an OpenRouter impl and a deterministic
 * stub so tests / no-key dev never hit the network. The prompt is hard-grounded
 * in the facts (see `explainPrompt.ts`).
 */
export type ReviewExplainerOutput = {
	/** A few sentences of plain English. */
	text: string;
};

export interface ReviewExplainer {
	explain(facts: ReviewExplainFacts): Promise<ReviewExplainerOutput>;
}
