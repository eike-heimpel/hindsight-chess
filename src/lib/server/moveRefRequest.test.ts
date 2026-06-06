import { describe, it, expect } from 'vitest';
import { parseMoveRef } from './moveRefRequest.ts';

const valid = { source: 'chesscom', gameId: 'g1', ply: 7 };
const parse = (v: unknown) => {
	const errors: string[] = [];
	return { ref: parseMoveRef(v, errors), errors };
};

describe('parseMoveRef', () => {
	it('accepts a well-formed ref', () => {
		const { ref, errors } = parse(valid);
		expect(errors).toEqual([]);
		expect(ref).toEqual(valid);
	});

	it('accepts a colon-bearing gameId (chess.com URL-derived ids)', () => {
		const { ref } = parse({ ...valid, gameId: 'live/12345:foo' });
		expect(ref?.gameId).toBe('live/12345:foo');
	});

	it('rejects a non-object body', () => {
		expect(parse(null).ref).toBeNull();
		expect(parse('x').ref).toBeNull();
	});

	it('rejects an unknown source', () => {
		const { ref, errors } = parse({ ...valid, source: 'fide' });
		expect(ref).toBeNull();
		expect(errors).toContain('source is invalid');
	});

	it('rejects a gameId with an out-of-charset character', () => {
		const { ref, errors } = parse({ ...valid, gameId: 'g 1' });
		expect(ref).toBeNull();
		expect(errors).toContain('gameId is invalid');
	});

	it('rejects an over-long gameId before it reaches a Mongo _id', () => {
		const { ref } = parse({ ...valid, gameId: 'a'.repeat(129) });
		expect(ref).toBeNull();
	});

	it('rejects a non-string gameId (NoSQL operator object)', () => {
		const { ref } = parse({ ...valid, gameId: { $ne: '' } });
		expect(ref).toBeNull();
	});

	it('rejects a non-positive or non-integer ply', () => {
		expect(parse({ ...valid, ply: 0 }).ref).toBeNull();
		expect(parse({ ...valid, ply: 2.5 }).ref).toBeNull();
		expect(parse({ ...valid, ply: '7' }).ref).toBeNull();
	});
});
