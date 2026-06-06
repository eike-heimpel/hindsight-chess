import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { _resetDbCache, _setDbForTests } from './db.ts';
import {
	clearAllMoveState,
	clearMark,
	clearMove,
	clearNote,
	clearThread,
	getGameMoveStates,
	getMoveState,
	getMoveStatesByRefs,
	listShortlist,
	saveThread,
	setMark,
	setNote,
	type MoveRef,
	type MoveState
} from './userMoveState.ts';
import { clearCursors, getReviewState, setCursor } from './userReviewState.ts';

/**
 * Integration tests against a real Mongo (the operator semantics — `$unset`
 * facet isolation, `$setOnInsert` side immutability, cursor set/clear — can't be
 * meaningfully exercised with a fake). Uses a dedicated `_test` database so dev
 * data is never touched. Targets a LOCAL/throwaway Mongo via `MONGODB_TEST_URI`
 * (defaulting to localhost) — deliberately NOT the app's real `MONGODB_URI`, so
 * a test run can never write to a prod/Atlas cluster. Runs locally and in CI (the
 * `mongo` service in ci.yml); fails loudly if no Mongo is reachable rather than
 * skipping — a skipped trust test is false confidence.
 */
const URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = 'chess_review_persistence_test';

let client: MongoClient;
let db: Db;

const ref = (over: Partial<MoveRef> = {}): MoveRef => ({
	source: 'chesscom',
	gameId: 'g1',
	ply: 7,
	...over
});

beforeAll(async () => {
	client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
	try {
		await client.connect();
		await client.db(DB_NAME).command({ ping: 1 });
	} catch (e) {
		throw new Error(
			`No Mongo reachable at ${URI} — start a local Mongo (or set MONGODB_TEST_URI).`,
			{ cause: e }
		);
	}
	db = client.db(DB_NAME);
	_setDbForTests(db);
});

afterAll(async () => {
	if (db) await db.dropDatabase();
	if (client) await client.close();
	_resetDbCache();
});

beforeEach(async () => {
	await Promise.all([
		db.collection('userMoveState').deleteMany({}),
		db.collection('userReviewState').deleteMany({})
	]);
});

describe('userMoveState facets', () => {
	it('clearing the mark leaves a coexisting note intact ($unset isolation)', async () => {
		const u = 'u1';
		await setMark(u, ref(), 'w', 'star');
		await setNote(u, ref(), 'w', 'knight was hanging');

		await clearMark(u, ref());

		const state = await getMoveState(u, ref());
		expect(state?.mark).toBeUndefined();
		expect(state?.note?.text).toBe('knight was hanging');
	});

	it('clearing the note leaves a coexisting mark intact', async () => {
		const u = 'u1';
		await setMark(u, ref(), 'w', 'star');
		await setNote(u, ref(), 'w', 'note text');

		await clearNote(u, ref());

		const state = await getMoveState(u, ref());
		expect(state?.note).toBeUndefined();
		expect(state?.mark).toBe('star');
	});

	it('derives side on insert and never overwrites it on a later write', async () => {
		const u = 'u1';
		await setMark(u, ref(), 'w', 'star');
		// A later write passing a different (wrong) side must not change the stored,
		// server-derived value — it's pinned via $setOnInsert.
		await setNote(u, ref(), 'b', 'note');

		const doc = await db
			.collection<{ _id: string; side: string }>('userMoveState')
			.findOne({ _id: `${u}:chesscom:g1:7` });
		expect(doc?.side).toBe('w');
	});

	const thread = (): NonNullable<MoveState['thread']> => ({
		messages: [
			{ role: 'coach', content: 'What did the knight defend?' },
			{ role: 'player', content: 'The e5 pawn.' }
		],
		learnings: [{ level: 'tactical', point: 'Count defenders before capturing.' }],
		status: 'wrapped',
		updatedAt: new Date()
	});

	it('saves a coach thread and reads it back via getGameMoveStates', async () => {
		const u = 'u1';
		await saveThread(u, ref(), 'w', thread());

		const overlay = await getGameMoveStates(u, 'chesscom', 'g1');
		expect(overlay[7].thread?.status).toBe('wrapped');
		expect(overlay[7].thread?.messages).toHaveLength(2);
		expect(overlay[7].thread?.learnings[0].point).toBe('Count defenders before capturing.');
	});

	it('clearing the thread leaves a coexisting note intact ($unset isolation)', async () => {
		const u = 'u1';
		await saveThread(u, ref(), 'w', thread());
		await setNote(u, ref(), 'w', 'knight was hanging');

		await clearThread(u, ref());

		const state = await getMoveState(u, ref());
		expect(state?.thread).toBeUndefined();
		expect(state?.note?.text).toBe('knight was hanging');
	});

	it('clearMove deletes the whole record', async () => {
		const u = 'u1';
		await setMark(u, ref(), 'w', 'star');
		await clearMove(u, ref());
		expect(await getMoveState(u, ref())).toBeNull();
	});

	it('clearAllMoveState wipes only the calling user', async () => {
		await setMark('alice', ref(), 'w', 'star');
		await setMark('bob', ref(), 'w', 'star');

		await clearAllMoveState('alice');

		expect(await getMoveState('alice', ref())).toBeNull();
		expect(await getMoveState('bob', ref())).not.toBeNull();
	});
});

describe('userMoveState reads', () => {
	it('getGameMoveStates returns a per-game ply→state overlay', async () => {
		const u = 'u1';
		await setMark(u, ref({ ply: 7 }), 'w', 'star');
		await setNote(u, ref({ ply: 12 }), 'w', 'note');
		await setMark(u, ref({ gameId: 'other', ply: 3 }), 'w', 'done');

		const overlay = await getGameMoveStates(u, 'chesscom', 'g1');
		expect(Object.keys(overlay).sort()).toEqual(['12', '7']);
		expect(overlay[7].mark).toBe('star');
		expect(overlay[12].note?.text).toBe('note');
	});

	it('getMoveStatesByRefs short-circuits on an empty list', async () => {
		expect(await getMoveStatesByRefs('u1', [])).toEqual({});
	});

	it('getMoveStatesByRefs maps each ref to its state', async () => {
		const u = 'u1';
		await setMark(u, ref({ ply: 7 }), 'w', 'star');
		await setMark(u, ref({ gameId: 'g2', ply: 4 }), 'b', 'done');

		const states = await getMoveStatesByRefs(u, [ref({ ply: 7 }), ref({ gameId: 'g2', ply: 4 })]);
		expect(states['chesscom:g1:7'].mark).toBe('star');
		expect(states['chesscom:g2:4'].mark).toBe('done');
	});

	it('listShortlist includes starred + noted, excludes a done-only move', async () => {
		const u = 'u1';
		await setMark(u, ref({ ply: 1 }), 'w', 'star');
		await setNote(u, ref({ ply: 2 }), 'w', 'note');
		await setMark(u, ref({ ply: 3 }), 'w', 'done'); // done-only → not on the shortlist

		const shortlist = await listShortlist(u);
		expect(shortlist).toHaveLength(2);
		expect(shortlist.some((s) => s.mark === 'star')).toBe(true);
		expect(shortlist.some((s) => s.note?.text === 'note')).toBe(true);
		expect(shortlist.some((s) => s.mark === 'done')).toBe(false);
	});
});

describe('userReviewState cursors', () => {
	it('defaults to empty cursors when the user has no doc', async () => {
		expect(await getReviewState('nobody')).toEqual({ cursors: {} });
	});

	it('sets and reads a queue cursor', async () => {
		await setCursor('u1', 'blunders', ref());
		const state = await getReviewState('u1');
		expect(state.cursors.blunders).toMatchObject({ source: 'chesscom', gameId: 'g1', ply: 7 });
	});

	it('clearing one queue with null leaves the others intact', async () => {
		await setCursor('u1', 'blunders', ref({ ply: 7 }));
		await setCursor('u1', 'coach', ref({ ply: 9 }));

		await setCursor('u1', 'blunders', null);

		const state = await getReviewState('u1');
		expect(state.cursors.blunders).toBeUndefined();
		expect(state.cursors.coach?.ply).toBe(9);
	});

	it('clearCursors empties every queue', async () => {
		await setCursor('u1', 'blunders', ref());
		await clearCursors('u1');
		expect(await getReviewState('u1')).toEqual({ cursors: {} });
	});
});
