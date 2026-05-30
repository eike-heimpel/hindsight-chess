import { MATE_SCORE_BASE, type EngineEval, type EngineLine, type EvaluateOptions } from './engine';

/** Parse a `score cp N` or `score mate N` from a Stockfish `info` line. */
export function parseScore(infoLine: string): number {
	const cpMatch = / score cp (-?\d+)/.exec(infoLine);
	if (cpMatch) return parseInt(cpMatch[1]!, 10);
	const mateMatch = / score mate (-?\d+)/.exec(infoLine);
	if (mateMatch) {
		const n = parseInt(mateMatch[1]!, 10);
		const sign = n >= 0 ? 1 : -1;
		return sign * (MATE_SCORE_BASE - Math.abs(n));
	}
	throw new Error(`No score found in info line: "${infoLine}"`);
}

export function parseDepth(infoLine: string): number | null {
	const m = / depth (\d+)/.exec(infoLine);
	return m ? parseInt(m[1]!, 10) : null;
}

/** The `multipv N` index of an info line. Absent → 1 (Stockfish omits it at
 *  default MultiPV=1). */
export function parseMultipv(infoLine: string): number {
	const m = / multipv (\d+)/.exec(infoLine);
	return m ? parseInt(m[1]!, 10) : 1;
}

/** The principal variation (UCI moves) from an info line's ` pv ...` tail,
 *  capped at `maxPlies`. Empty array if the line has no `pv`. */
export function parsePv(infoLine: string, maxPlies = 12): string[] {
	const m = / pv (.+)$/.exec(infoLine);
	if (!m) return [];
	return m[1]!.trim().split(/\s+/).slice(0, maxPlies);
}

/**
 * Turn the per-multipv info lines captured during a search into the optional
 * `pv` / `lines` fields of an `EngineEval`. `pv` is the best line's variation;
 * `lines` is filled (sorted best-first) only when `multiPv > 1` was requested.
 * Shared by the browser and node Stockfish engines.
 */
export function buildPvAndLines(
	opts: EvaluateOptions | undefined,
	infoByMultipv: Map<number, string>
): Pick<EngineEval, 'pv' | 'lines'> {
	const pv = parsePv(infoByMultipv.get(1) ?? '');
	if (!opts?.multiPv || opts.multiPv <= 1) return { pv };

	const lines: EngineLine[] = [];
	for (const idx of [...infoByMultipv.keys()].sort((a, b) => a - b)) {
		const linePv = parsePv(infoByMultipv.get(idx)!);
		if (linePv.length === 0) continue;
		lines.push({ cp: parseScore(infoByMultipv.get(idx)!), pv: linePv, moveUci: linePv[0]! });
	}
	return { pv, lines };
}
