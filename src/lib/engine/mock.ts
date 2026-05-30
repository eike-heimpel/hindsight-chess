import type { Engine, EngineEval, EvaluateOptions } from './engine.ts';

/**
 * Deterministic mock engine. Used in unit tests so we never need to spin up
 * Stockfish to verify wire-up logic.
 *
 * The map is keyed by FEN; missing FENs throw, which is intentional — tests
 * should be explicit about which positions they exercise.
 */
export class MockEngine implements Engine {
	private readonly answers: Map<string, EngineEval>;

	constructor(answers: Record<string, EngineEval>) {
		this.answers = new Map(Object.entries(answers));
	}

	async evaluate(fen: string, _opts?: EvaluateOptions): Promise<EngineEval> {
		const a = this.answers.get(fen);
		if (!a) throw new Error(`MockEngine: no answer registered for FEN "${fen}"`);
		return { ...a };
	}
}
