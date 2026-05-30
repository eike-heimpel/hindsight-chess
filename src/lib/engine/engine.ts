/**
 * Engine abstraction. The rest of the app talks to *this* interface, not to
 * Stockfish. The two implementations we care about:
 *
 *   - `mock.ts`         deterministic, in-memory, used for unit tests
 *   - `stockfish-node.ts` real Stockfish via the stockfish npm package (Node)
 *
 * Browser-side Stockfish (Web Worker) will be a third impl when the UI lands
 * — same interface, swap at the call site.
 */

/** One engine line (multipv entry). `cp` is from the side-to-move's POV,
 *  `pv` is the line in UCI starting with `moveUci`. */
export type EngineLine = {
	cp: number;
	pv: string[];
	moveUci: string;
};

export type EngineEval = {
	/** Centipawn evaluation from the side-to-move's POV.
	 *  Mate is encoded as ±MATE_SCORE_BASE (see constant below). */
	cp: number;
	/** Engine's preferred move, SAN. */
	bestMoveSan: string;
	/** Engine's preferred move, UCI (e.g. "e2e4", "e7e8q"). */
	bestMoveUci: string;
	/** Search depth actually reached. */
	depth: number;
	/** Principal variation of the best line, UCI. Populated by the Stockfish
	 *  engines; the review explainer is the only consumer so far. */
	pv?: string[];
	/** Top-N lines, best first. Only populated when `EvaluateOptions.multiPv`
	 *  is set (> 1); `lines[0]` then mirrors `cp`/`bestMoveUci`/`pv`. */
	lines?: EngineLine[];
};

export interface Engine {
	/** Evaluate a position. Returns best move and centipawn score. */
	evaluate(fen: string, opts?: EvaluateOptions): Promise<EngineEval>;
	/** Release any underlying resources. Idempotent. */
	close?(): Promise<void>;
}

export type EvaluateOptions = {
	/** Search depth. Higher = stronger + slower. Default per impl.
	 *  Ignored when `movetimeMs` is set. */
	depth?: number;
	/** When set, instructs the engine to search for this many milliseconds
	 *  via `go movetime` instead of `go depth`. Use for opponents that should
	 *  feel responsive but not thinking forever. */
	movetimeMs?: number;
	/** When set, caps engine strength via UCI_LimitStrength + UCI_Elo so the
	 *  engine plays roughly at this Elo. Used by the Eröffnungspartie opponent
	 *  so the kid faces principled-but-not-crushing play. Stockfish accepts
	 *  values roughly in [1320, 3190]; out-of-range values are clamped by
	 *  Stockfish itself. */
	uciElo?: number;
	/** When > 1, search the top-N lines (UCI `MultiPV`) and return them in
	 *  `EngineEval.lines`. Used by the game-review explainer to ground an LLM
	 *  in the engine's top alternatives. Sticky on the engine, so the impls
	 *  reset it to 1 on every call where it's unset. */
	multiPv?: number;
};

/** Mate scores are encoded as `MATE_SCORE_BASE - distance`, sign for side. */
export const MATE_SCORE_BASE = 100_000;

export function isMateScore(cp: number): boolean {
	return Math.abs(cp) >= MATE_SCORE_BASE - 500;
}

/** Engine exceeded the per-evaluate deadline. Surface to the user as
 *  "took too long, retry" rather than the generic "engine isn't responding". */
export class EngineTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EngineTimeoutError';
	}
}

/** Engine had no move to return — the FEN is terminal (mate / stalemate).
 *  Callers are expected to pre-check; if this throws it indicates a missed
 *  pre-check, not an engine failure. */
export class EngineNoMoveError extends Error {
	constructor(
		public readonly fen: string,
		message: string
	) {
		super(message);
		this.name = 'EngineNoMoveError';
	}
}
