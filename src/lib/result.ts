/**
 * Tiny Result<T, E> type for boundaries where failures are expected (network,
 * engine, validation) — caller has to handle both branches explicitly, no
 * silent rejection. Lib-internal invariants still throw.
 *
 * Convention: `kind` carries a discriminated machine-readable code so the UI
 * can render an appropriate German message; `message` is the raw underlying
 * detail (kept for debugging, never shown verbatim to a child user).
 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export type AppError = {
	kind: ErrorKind;
	message: string;
};

export type ErrorKind =
	| 'engine_failed'
	| 'engine_timeout'
	| 'engine_no_move'
	| 'coach_network'
	| 'coach_http'
	| 'coach_invalid_response'
	| 'illegal_move';

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = (kind: ErrorKind, message: string): Result<never, AppError> => ({
	ok: false,
	error: { kind, message }
});
