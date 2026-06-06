import { applyMove } from '../chess/rules';
import {
	EngineNoMoveError,
	EngineTimeoutError,
	type Engine,
	type EngineEval,
	type EvaluateOptions
} from './engine';
import { parseDepth, parseScore, parseMultipv, buildPvAndLines } from './uci-parse';

/**
 * Browser-side Stockfish engine. Runs in a Web Worker (off the main thread)
 * so the chess search doesn't jank the UI.
 *
 * One worker per tab is fine — the only concurrency we need to handle is
 * within a single tab, which we do with a tiny promise chain so calls
 * serialize cleanly. (Two parallel evaluate() calls would otherwise scramble
 * the engine's UCI state machine.)
 *
 * The Worker script and its .wasm sibling are served from /stockfish/, copied
 * out of node_modules by `npm run sync:engine`.
 */
/** Per-evaluate deadline. Must beat Vercel's 10s budget for the explain route
 *  by enough margin that an LLM call can still follow. Also long enough for
 *  depth-14 search on weak hardware. */
const EVALUATE_TIMEOUT_MS = 7000;
/** After we send `stop`, give a healthy worker this long to flush a `bestmove`
 *  before we treat the worker as wedged and terminate it. */
const STOP_GRACE_MS = 250;
/** Deadline for the one-time `uci`/`isready` handshake. Generous enough for a
 *  WASM compile on weak hardware, but bounded so a worker that never loads
 *  surfaces an `EngineTimeoutError` instead of leaving every later evaluate()
 *  awaiting a worker that will never be ready. */
const HANDSHAKE_TIMEOUT_MS = 15000;

export class BrowserStockfishEngine implements Engine {
	private workerPromise: Promise<Worker> | null = null;
	private chain: Promise<unknown> = Promise.resolve();
	private currentListener: ((line: string) => void) | null = null;
	private readonly defaultDepth: number;
	private readonly url: string;
	private readonly evaluateTimeoutMs: number;

	constructor(opts: { defaultDepth?: number; url?: string; evaluateTimeoutMs?: number } = {}) {
		this.defaultDepth = opts.defaultDepth ?? 14;
		this.url = opts.url ?? '/stockfish/stockfish-18-lite-single.js';
		this.evaluateTimeoutMs = opts.evaluateTimeoutMs ?? EVALUATE_TIMEOUT_MS;
	}

	evaluate(fen: string, opts?: EvaluateOptions): Promise<EngineEval> {
		const next = this.chain.then(() => this.doEvaluate(fen, opts));
		// Don't poison the chain on error — subsequent calls can still proceed.
		this.chain = next.catch(() => undefined);
		return next;
	}

	async close(): Promise<void> {
		if (!this.workerPromise) return;
		const worker = await this.workerPromise;
		worker.postMessage('quit');
		worker.terminate();
		this.workerPromise = null;
		this.currentListener = null;
	}

	private ensureWorker(): Promise<Worker> {
		if (!this.workerPromise) {
			// On a failed handshake, drop the cached promise so the next call can
			// retry a fresh worker rather than re-awaiting a permanently-rejected one.
			this.workerPromise = this.initWorker().catch((e) => {
				this.workerPromise = null;
				throw e;
			});
		}
		return this.workerPromise;
	}

	private async initWorker(): Promise<Worker> {
		const worker = new Worker(this.url);
		worker.onmessage = (ev: MessageEvent) => {
			const data = ev.data;
			if (typeof data === 'string') this.currentListener?.(data);
		};
		worker.onerror = (e) => {
			// Surface unexpected errors to the console; the handshake/evaluate
			// promises reject via their own timeouts if the engine never replies.
			console.error('Stockfish worker error:', e);
		};
		try {
			await this.sendAndWait(worker, 'uci', (l) => l === 'uciok');
			await this.sendAndWait(worker, 'isready', (l) => l === 'readyok');
		} catch (e) {
			worker.terminate();
			throw e;
		}
		return worker;
	}

	private sendAndWait(worker: Worker, cmd: string, pred: (line: string) => boolean): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.currentListener = null;
				reject(new EngineTimeoutError(`Stockfish handshake "${cmd}" timed out`));
			}, HANDSHAKE_TIMEOUT_MS);
			this.currentListener = (line: string) => {
				if (pred(line)) {
					clearTimeout(timer);
					this.currentListener = null;
					resolve();
				}
			};
			worker.postMessage(cmd);
		});
	}

	private async doEvaluate(fen: string, opts?: EvaluateOptions): Promise<EngineEval> {
		const worker = await this.ensureWorker();
		const depth = opts?.depth ?? this.defaultDepth;
		const goCommand = opts?.movetimeMs ? `go movetime ${opts.movetimeMs}` : `go depth ${depth}`;

		// Keep the latest scored info line per multipv index; the deepest
		// iteration overwrites shallower ones, so this ends up holding the
		// final lines. Default search (MultiPV 1) only ever fills index 1.
		const infoByMultipv = new Map<number, string>();
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		let stopHandle: ReturnType<typeof setTimeout> | null = null;

		const bestmoveLine = await new Promise<string>((resolve, reject) => {
			this.currentListener = (line: string) => {
				if (line.startsWith('info ') && / score (cp|mate) /.test(line)) {
					infoByMultipv.set(parseMultipv(line), line);
				}
				if (line.startsWith('bestmove ')) {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (stopHandle) clearTimeout(stopHandle);
					this.currentListener = null;
					resolve(line);
				}
			};
			worker.postMessage('ucinewgame');
			// Strength is sticky on the underlying engine — set it explicitly
			// every call so a previous limited-strength search doesn't bleed
			// into a full-strength one (and vice versa).
			if (typeof opts?.uciElo === 'number') {
				worker.postMessage('setoption name UCI_LimitStrength value true');
				worker.postMessage(`setoption name UCI_Elo value ${opts.uciElo}`);
			} else {
				worker.postMessage('setoption name UCI_LimitStrength value false');
			}
			// MultiPV is sticky too — reset it every call.
			worker.postMessage(
				`setoption name MultiPV value ${opts?.multiPv && opts.multiPv > 1 ? opts.multiPv : 1}`
			);
			worker.postMessage(`position fen ${fen}`);
			worker.postMessage(goCommand);

			timeoutHandle = setTimeout(() => {
				// Try a graceful stop first — a healthy worker will reply with
				// `bestmove` and we'll resolve through the listener above.
				worker.postMessage('stop');
				stopHandle = setTimeout(() => {
					// Worker is wedged. Kill it; next evaluate() will re-spawn.
					this.currentListener = null;
					worker.terminate();
					this.workerPromise = null;
					reject(
						new EngineTimeoutError(
							`Stockfish timed out at depth ${depth} after ${this.evaluateTimeoutMs}ms`
						)
					);
				}, STOP_GRACE_MS);
			}, this.evaluateTimeoutMs);
		});

		const primary = infoByMultipv.get(1) ?? '';
		const score = parseScore(primary);
		const reachedDepth = parseDepth(primary) ?? depth;
		const bestUci = bestmoveLine.split(/\s+/)[1];
		if (!bestUci || bestUci === '(none)') {
			throw new EngineNoMoveError(
				fen,
				`Stockfish returned no bestmove for fen "${fen}" — terminal position; callers should pre-check.`
			);
		}
		const { move } = applyMove(fen, bestUci);
		return {
			cp: score,
			bestMoveSan: move.san,
			bestMoveUci: bestUci,
			depth: reachedDepth,
			...buildPvAndLines(opts, infoByMultipv)
		};
	}
}
