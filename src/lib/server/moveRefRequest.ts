import { SOURCES, GAME_ID, UCI } from '$lib/review/explainRequest';
import type { MoveRef } from './userMoveState.ts';
import type { ReviewSource } from '$lib/review/types';

/**
 * Validate a bare `MoveRef` ({source, gameId, ply, line?}) off a request body for
 * the move-state routes that don't carry the full engine shape (`moves`, `cursor`).
 * Mirrors the `source`/`gameId`/`ply` checks in `parseEngineRequestBase` (shares
 * the same `GAME_ID`/`UCI` hardening) before they enter a Mongo `_id`. The snapshot
 * route reuses `parseEngineRequestBase` directly, since it needs the engine
 * numbers.
 *
 * `line` (the UCI moves of an explored alternative) is OPTIONAL: present → an
 * alternative branching from the position after `ply` half-moves (so `ply` may be
 * 0, the start); absent → a real move (`ply >= 1`).
 */

/** A line can be at most this many plies — a sanity cap so a malicious body can't
 *  inflate the `_id` or the replay work. Generous for real exploration. */
export const MAX_LINE_PLIES = 40;

export function parseMoveRef(value: unknown, errors: string[]): MoveRef | null {
	if (!value || typeof value !== 'object') {
		errors.push('ref must be an object');
		return null;
	}
	const v = value as Record<string, unknown>;

	if (!SOURCES.includes(v.source as ReviewSource)) errors.push('source is invalid');
	if (typeof v.gameId !== 'string' || !GAME_ID.test(v.gameId)) {
		errors.push('gameId is invalid');
	}

	const hasLine = v.line !== undefined;
	let line: string[] | undefined;
	if (hasLine) {
		if (!Array.isArray(v.line) || v.line.length === 0) {
			errors.push('line, if given, must be a non-empty array');
		} else if (v.line.length > MAX_LINE_PLIES) {
			errors.push(`line must have at most ${MAX_LINE_PLIES} moves`);
		} else if (!v.line.every((m) => typeof m === 'string' && UCI.test(m))) {
			errors.push('line must be an array of UCI moves');
		} else {
			line = v.line as string[];
		}
	}

	// A real move points AT a move (ply >= 1); an alternative branches from the
	// position after `ply` half-moves, so ply 0 (the start) is valid there.
	const minPly = hasLine ? 0 : 1;
	if (typeof v.ply !== 'number' || !Number.isInteger(v.ply) || v.ply < minPly) {
		errors.push(`ply must be an integer >= ${minPly}`);
	}

	if (errors.length) return null;
	return {
		source: v.source as ReviewSource,
		gameId: v.gameId as string,
		ply: v.ply as number,
		...(line ? { line } : {})
	};
}
