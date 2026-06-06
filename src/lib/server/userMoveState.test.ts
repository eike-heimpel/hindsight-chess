import { describe, it, expect } from 'vitest';
import { moveStateId, ownedSide, type MoveRef } from './userMoveState.ts';
import type { ReviewAccount, ReviewGame } from '$lib/review/types';

const ref = (over: Partial<MoveRef> = {}): MoveRef => ({
	source: 'chesscom',
	gameId: 'g1',
	ply: 7,
	...over
});

describe('moveStateId', () => {
	it('appends the fields in the load-bearing order, ply last', () => {
		expect(moveStateId('user1', ref())).toBe('user1:chesscom:g1:7');
	});

	it('keeps the ply boundary stable when gameId contains a colon', () => {
		const id = moveStateId('user1', ref({ gameId: 'a:b:c', ply: 12 }));
		expect(id.endsWith(':12')).toBe(true);
		expect(id).toBe('user1:chesscom:a:b:c:12');
	});

	it('does not collide across users for the same move', () => {
		expect(moveStateId('alice', ref())).not.toBe(moveStateId('bob', ref()));
	});
});

const game = (over: Partial<ReviewGame> = {}): ReviewGame =>
	({
		source: 'chesscom',
		gameId: 'g1',
		playedAt: new Date(),
		timeClass: 'blitz',
		timeControl: '300',
		white: { username: 'AliceCaps' },
		black: { username: 'BobLower' },
		result: '1-0',
		termination: 'normal',
		moves: [],
		...over
	}) as ReviewGame;

const acct = (username: string, source: ReviewAccount['source'] = 'chesscom'): ReviewAccount => ({
	source,
	username
});

describe('ownedSide', () => {
	it('matches white case-insensitively', () => {
		expect(ownedSide(game(), [acct('alicecaps')])).toBe('w');
	});

	it('matches black case-insensitively', () => {
		expect(ownedSide(game(), [acct('boblower')])).toBe('b');
	});

	it('returns null when no owned account played', () => {
		expect(ownedSide(game(), [acct('stranger')])).toBeNull();
	});

	it('returns null on an empty account list', () => {
		expect(ownedSide(game(), [])).toBeNull();
	});

	it('does not match a same-username account on a different source', () => {
		expect(ownedSide(game(), [acct('alicecaps', 'lichess')])).toBeNull();
	});

	it('finds the first matching account among several', () => {
		expect(ownedSide(game(), [acct('stranger'), acct('boblower')])).toBe('b');
	});
});
