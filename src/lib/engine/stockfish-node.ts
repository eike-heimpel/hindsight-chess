// @ts-expect-error — `stockfish` ships its own .d.ts only for browser; we import the Node loader directly.
import initEngine from 'stockfish';
import { applyMove } from '../chess/rules.ts';
import { EngineNoMoveError, type Engine, type EngineEval, type EvaluateOptions } from './engine.ts';
import { parseDepth, parseScore, parseMultipv, buildPvAndLines } from './uci-parse.ts';

/**
 * Node-side Stockfish via the `stockfish` npm package. Each StockfishNodeEngine
 * instance owns one engine process with its own UCI loop. Safe for sequential
 * use; not parallel — call evaluate() sequentially or run multiple instances.
 *
 * For the verifier and unit-test scenarios. The browser implementation will be
 * a separate file (Web Worker), same interface.
 */
type StockfishProcess = {
	sendCommand: (cmd: string) => void;
	/** Stockfish.js calls `listener(line)` for every output line.
	 *  See node_modules/stockfish/bin/stockfish.js: `c.print = (e) => c.listener ? c.listener(e) : console.log(e)`. */
	listener?: (line: string) => void;
};

export class StockfishNodeEngine implements Engine {
	private engine: StockfishProcess | null = null;
	private buffer: string[] = [];
	private listener: ((line: string) => void) | null = null;
	private readonly defaultDepth: number;

	constructor(opts: { defaultDepth?: number; flavor?: 'lite' | 'lite-single' } = {}) {
		this.defaultDepth = opts.defaultDepth ?? 18;
		// Resolved lazily in init() — flavor stored for that call.
		this._flavor = opts.flavor ?? 'lite-single';
	}
	private readonly _flavor: 'lite' | 'lite-single';

	private async init(): Promise<StockfishProcess> {
		if (this.engine) return this.engine;
		// initEngine returns a Promise<engine>; engine has sendCommand + a `print`
		// callback we install to capture stdout-equivalent lines.
		const engine = (await initEngine(this._flavor)) as StockfishProcess;
		engine.listener = (line: string) => {
			this.buffer.push(line);
			this.listener?.(line);
		};
		engine.sendCommand('uci');
		await this.waitFor((line) => line === 'uciok');
		engine.sendCommand('isready');
		await this.waitFor((line) => line === 'readyok');
		this.engine = engine;
		return engine;
	}

	async evaluate(fen: string, opts: EvaluateOptions = {}): Promise<EngineEval> {
		const engine = await this.init();
		const depth = opts.depth ?? this.defaultDepth;
		const goCommand = opts.movetimeMs ? `go movetime ${opts.movetimeMs}` : `go depth ${depth}`;

		// Capture the *last* scored `info` line per multipv index before
		// bestmove; the deepest iteration overwrites shallower ones.
		const infoByMultipv = new Map<number, string>();
		const onLine = (line: string) => {
			if (line.startsWith('info ') && / score (cp|mate) /.test(line)) {
				infoByMultipv.set(parseMultipv(line), line);
			}
		};
		this.listener = onLine;

		engine.sendCommand('ucinewgame');
		// Strength is sticky on the engine — set it every call so previous
		// limited-strength runs don't leak into a full-strength search and
		// vice versa.
		if (typeof opts.uciElo === 'number') {
			engine.sendCommand('setoption name UCI_LimitStrength value true');
			engine.sendCommand(`setoption name UCI_Elo value ${opts.uciElo}`);
		} else {
			engine.sendCommand('setoption name UCI_LimitStrength value false');
		}
		// MultiPV is sticky too — reset it every call.
		engine.sendCommand(
			`setoption name MultiPV value ${opts.multiPv && opts.multiPv > 1 ? opts.multiPv : 1}`
		);
		engine.sendCommand(`position fen ${fen}`);
		engine.sendCommand(goCommand);

		const bestmoveLine = await this.waitFor((line) => line.startsWith('bestmove '));
		this.listener = null;

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

	async close(): Promise<void> {
		if (!this.engine) return;
		this.engine.sendCommand('quit');
		this.engine = null;
		this.buffer = [];
		this.listener = null;
	}

	/** Wait until a line matching `pred` arrives in the print buffer. */
	private waitFor(pred: (line: string) => boolean): Promise<string> {
		// First scan the buffer — we may already have it.
		const idx = this.buffer.findIndex(pred);
		if (idx >= 0) {
			const line = this.buffer[idx];
			this.buffer.splice(0, idx + 1);
			return Promise.resolve(line);
		}

		return new Promise((resolve) => {
			const prev = this.listener;
			this.listener = (line) => {
				prev?.(line);
				if (pred(line)) {
					this.listener = prev ?? null;
					this.buffer = [];
					resolve(line);
				}
			};
		});
	}
}
