import { SOURCES } from '$lib/review/explainRequest';
import type { MoveRef } from './userMoveState.ts';
import type { ReviewSource } from '$lib/review/types';

/**
 * Validate a bare `MoveRef` ({source, gameId, ply}) off a request body for the
 * move-state routes that don't carry the full engine shape (`moves`, `cursor`).
 * Mirrors the `source`/`ply` checks in `parseEngineRequestBase` and hardens
 * `gameId` (length + charset) before it enters a Mongo `_id`. The snapshot route
 * reuses `parseEngineRequestBase` directly, since it needs the engine numbers.
 */

/** chess.com ids are the last URL path segment (plain digits); lichess are
 *  alphanumeric. Cap length and restrict to a safe id charset — the extra
 *  `:_/-` chars are defensive headroom, not required by today's sources. */
const GAME_ID = /^[A-Za-z0-9:_/-]{1,128}$/;

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
	if (typeof v.ply !== 'number' || !Number.isInteger(v.ply) || v.ply < 1) {
		errors.push('ply must be a positive integer');
	}

	if (errors.length) return null;
	return { source: v.source as ReviewSource, gameId: v.gameId as string, ply: v.ply as number };
}
