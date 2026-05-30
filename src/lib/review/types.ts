/**
 * Core domain types for the game-review tool. Platform-blind: once a game is
 * normalised into `ReviewGame`, nothing downstream knows or cares whether it
 * came from chess.com, lichess, or a pasted PGN. See `docs/review.md`.
 */
import type { Side } from '$lib/chess/types';

/** Where a game came from. chess.com and lichess have adapters; upload follows. */
export type ReviewSource = 'chesscom' | 'lichess' | 'upload';

/** A linked profile: a username on one platform. The unit a user owns, swaps
 *  between, and scopes the whole app to. Source-qualified because the same
 *  username on chess.com and lichess are different people, and ratings don't
 *  translate across platforms — see `docs/review.md`. */
export type ReviewAccount = {
	source: ReviewSource;
	/** Lowercased; platform usernames are case-insensitive for our purposes. */
	username: string;
};

/** Stable string key for a profile — used in URLs, form fields, dedup, and the
 *  persisted "active profile" pointer. */
export const accountKey = (a: ReviewAccount): string => `${a.source}:${a.username}`;

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export type PlayerRef = {
	username: string;
	rating?: number;
};

/** One half-move with the board state on both sides of it. */
export type ReviewMove = {
	/** 1-based half-move index. */
	ply: number;
	color: Side;
	san: string;
	uci: string;
	fenBefore: string;
	fenAfter: string;
	/** Remaining clock after the move, ms — from the PGN's %clk comment when present. */
	clockMs?: number;
};

/** A finished game, normalised from PGN. The unit we persist and review. */
export type ReviewGame = {
	source: ReviewSource;
	gameId: string;
	url?: string;
	playedAt: Date;
	timeClass: string;
	timeControl: string;
	/** Optional: PGN can't express it, so it's only set when the source supplies it. */
	rated?: boolean;
	eco?: string;
	opening?: string;
	white: PlayerRef;
	black: PlayerRef;
	result: GameResult;
	termination: string;
	moves: ReviewMove[];
};

/** Boundary error for review ingestion. */
export type ReviewError = {
	kind: 'fetch_failed' | 'not_found' | 'parse_failed';
	message: string;
};

export const reviewErr = (kind: ReviewError['kind'], message: string): ReviewError => ({
	kind,
	message
});
