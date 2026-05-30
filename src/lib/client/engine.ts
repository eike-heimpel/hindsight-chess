import { BrowserStockfishEngine } from '$lib/engine/stockfish-browser';
import {
	EngineNoMoveError,
	EngineTimeoutError,
	type Engine,
	type EngineEval,
	type EvaluateOptions
} from '$lib/engine/engine';
import { type Result, ok, err } from '$lib/result';

/**
 * One engine instance per browser tab. Lazy-initialized on first use so the
 * 7 MB WASM payload only loads when training begins (not on the landing page).
 */
let cached: Engine | null = null;

export function getBrowserEngine(): Engine {
	if (!cached) cached = new BrowserStockfishEngine();
	return cached;
}

/** Result-returning evaluate. Use this from the UI; reserve the throwing
 *  variant for tests and infra code where a thrown error is the right signal. */
export async function safeEvaluate(
	fen: string,
	opts?: EvaluateOptions
): Promise<Result<EngineEval>> {
	try {
		const value = await getBrowserEngine().evaluate(fen, opts);
		return ok(value);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (e instanceof EngineTimeoutError) return err('engine_timeout', message);
		if (e instanceof EngineNoMoveError) return err('engine_no_move', message);
		return err('engine_failed', message);
	}
}
