/**
 * Ingestion seam. Every platform adapter hands back raw PGN plus the few bits
 * of metadata that can't be recovered from PGN alone (a stable id, a canonical
 * url). `normalize()` turns a `RawGame` into a `ReviewGame`.
 */
import type { Result } from '$lib/result';
import type { ReviewSource, ReviewError } from './types';

export type RawGame = {
	source: ReviewSource;
	gameId: string;
	url?: string;
	pgn: string;
	/** Source-authoritative bits PGN can't express. Carried through verbatim. */
	rated?: boolean;
};

export interface GameSource {
	/** Recent games for an account, newest first. */
	listGames(account: string, opts?: { limit?: number }): Promise<Result<RawGame[], ReviewError>>;
}
