/**
 * Wire-shape validation for the engine-grounded review requests. The /explain
 * and /coach/discuss routes accept the SAME base shape ({source, gameId, ply,
 * fenBefore, playedUci, bestLines, replyLine}) — coach just layers intent /
 * playerText / history on top. This is the single place that defines a "valid
 * engine line" and a valid request base, so the two trust-critical routes can't
 * drift on what they accept.
 */
import { isValidFen } from '$lib/chess/rules';
import type { EngineLine } from '$lib/engine/engine';
import type { ReviewExplainRequest } from './explain';
import type { ReviewSource } from './types';

/** UCI move: from-square, to-square, optional promotion piece. */
export const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export const SOURCES: ReviewSource[] = ['chesscom', 'lichess', 'upload'];

/** chess.com ids are the last URL path segment (plain digits); lichess are
 *  alphanumeric. Cap length and restrict to a safe id charset before a gameId
 *  enters a Mongo `_id` or query — the extra `:_/-` chars are defensive
 *  headroom, not required by today's sources. Shared by the engine routes and
 *  the bare move-state routes so neither can drift on what it accepts. */
export const GAME_ID = /^[A-Za-z0-9:_/-]{1,128}$/;

/** Validate one engine line ({cp, pv, moveUci}); pushes any problems to `errors`. */
export function parseEngineLine(
	value: unknown,
	label: string,
	errors: string[]
): EngineLine | null {
	if (!value || typeof value !== 'object') {
		errors.push(`${label} must be an object`);
		return null;
	}
	const v = value as Record<string, unknown>;
	const pvOk = Array.isArray(v.pv) && v.pv.every((m) => typeof m === 'string');
	if (typeof v.cp !== 'number') errors.push(`${label}.cp must be a number`);
	if (!pvOk) errors.push(`${label}.pv must be a string[]`);
	if (typeof v.moveUci !== 'string' || !UCI.test(v.moveUci)) {
		errors.push(`${label}.moveUci must be a UCI string`);
	}
	return errors.length ? null : (v as unknown as EngineLine);
}

/**
 * Validate the engine-grounded request base shared by /explain and
 * /coach/discuss. Pushes problems to `errors` and returns the raw record (so the
 * coach route can layer its extra fields onto the same object), or null when the
 * body isn't a JSON object. `minPly` defaults to 1 (a real move points at a move);
 * the coach passes 0 for an explored line, which branches from the position after
 * `ply` half-moves (ply 0 = the start).
 */
export function parseEngineRequestBase(
	value: unknown,
	errors: string[],
	opts: { minPly?: number } = {}
): Record<string, unknown> | null {
	if (!value || typeof value !== 'object') {
		errors.push('body must be a JSON object');
		return null;
	}
	const v = value as Record<string, unknown>;
	const minPly = opts.minPly ?? 1;

	if (!SOURCES.includes(v.source as ReviewSource)) errors.push('source is invalid');
	if (typeof v.gameId !== 'string' || !GAME_ID.test(v.gameId)) errors.push('gameId is invalid');
	if (typeof v.ply !== 'number' || !Number.isInteger(v.ply) || v.ply < minPly) {
		errors.push(`ply must be an integer >= ${minPly}`);
	}
	if (typeof v.fenBefore !== 'string' || !isValidFen(v.fenBefore)) {
		errors.push('fenBefore must be a valid FEN');
	}
	if (typeof v.playedUci !== 'string' || !UCI.test(v.playedUci)) {
		errors.push('playedUci must be a UCI string');
	}
	if (!Array.isArray(v.bestLines) || v.bestLines.length === 0) {
		errors.push('bestLines must be a non-empty array');
	} else {
		v.bestLines.forEach((l, i) => parseEngineLine(l, `bestLines[${i}]`, errors));
	}
	if (v.replyLine !== null) parseEngineLine(v.replyLine, 'replyLine', errors);

	return v;
}

/** Parse a bare /explain request (the base shape, no coach fields). */
export function parseExplainRequest(
	value: unknown
): { value: ReviewExplainRequest } | { errors: string[] } {
	const errors: string[] = [];
	const v = parseEngineRequestBase(value, errors);
	if (!v || errors.length) return { errors };
	return { value: v as unknown as ReviewExplainRequest };
}
