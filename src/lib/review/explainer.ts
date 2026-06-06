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
	/** `correction`, when set, is fact-check feedback on a rejected first draft —
	 *  the impl appends it so the model rewrites away from the proven-false claims
	 *  (see the gate loop in `api/review/explain`). */
	explain(facts: ReviewExplainFacts, correction?: string): Promise<ReviewExplainerOutput>;
}
