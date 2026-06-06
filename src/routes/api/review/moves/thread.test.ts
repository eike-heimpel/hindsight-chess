import { describe, it, expect } from 'vitest';
import { validateThread } from './validateThread.ts';

/**
 * Validation-only tests for the `thread` facet payload (the 400 path of the moves
 * route). No Mongo — the shape/cap checks are a pure function. Persistence of a
 * valid thread + $unset isolation is covered by `persistence.db.test.ts`.
 *
 * Wire shape the client must match:
 *   POST /api/review/moves { ref, facet:'thread', value: { messages, learnings, status } }
 */
const valid = () => ({
	messages: [
		{ role: 'coach', content: 'Why is the rook strong here?' },
		{ role: 'player', content: 'Open file.' }
	],
	learnings: [{ level: 'principle', point: 'Rooks belong on open files.' }],
	status: 'open'
});

describe('validateThread', () => {
	it('accepts a well-formed payload and returns it', () => {
		const errors: string[] = [];
		const out = validateThread(valid(), errors);
		expect(errors).toEqual([]);
		expect(out).toEqual(valid());
	});

	it('accepts empty messages/learnings with a valid status', () => {
		const errors: string[] = [];
		expect(
			validateThread({ messages: [], learnings: [], status: 'wrapped' }, errors)
		).not.toBeNull();
		expect(errors).toEqual([]);
	});

	it('rejects a non-array messages', () => {
		const errors: string[] = [];
		expect(validateThread({ messages: 'x', learnings: [], status: 'open' }, errors)).toBeNull();
		expect(errors.some((e) => e.includes('messages must be an array'))).toBe(true);
	});

	it('rejects a bad role and non-string content', () => {
		const errors: string[] = [];
		validateThread(
			{ messages: [{ role: 'bot', content: 1 }], learnings: [], status: 'open' },
			errors
		);
		expect(errors.some((e) => e.includes('role must be'))).toBe(true);
		expect(errors.some((e) => e.includes('content must be a string'))).toBe(true);
	});

	it('rejects too many messages', () => {
		const errors: string[] = [];
		const messages = Array.from({ length: 61 }, () => ({ role: 'coach', content: 'x' }));
		validateThread({ messages, learnings: [], status: 'open' }, errors);
		expect(errors.some((e) => e.includes('at most 60 items'))).toBe(true);
	});

	it('rejects oversized message content', () => {
		const errors: string[] = [];
		const messages = [{ role: 'coach', content: 'x'.repeat(4097) }];
		validateThread({ messages, learnings: [], status: 'open' }, errors);
		expect(errors.some((e) => e.includes('at most 4096 characters'))).toBe(true);
	});

	it('rejects too many learnings', () => {
		const errors: string[] = [];
		const learnings = Array.from({ length: 21 }, () => ({ level: 'tactical', point: 'x' }));
		validateThread({ messages: [], learnings, status: 'open' }, errors);
		expect(errors.some((e) => e.includes('at most 20 items'))).toBe(true);
	});

	it('rejects a bad learning level and oversized point', () => {
		const errors: string[] = [];
		validateThread(
			{ messages: [], learnings: [{ level: 'vibes', point: 'x'.repeat(1025) }], status: 'open' },
			errors
		);
		expect(errors.some((e) => e.includes('level must be'))).toBe(true);
		expect(errors.some((e) => e.includes('at most 1024 characters'))).toBe(true);
	});

	it('rejects an invalid status', () => {
		const errors: string[] = [];
		validateThread({ messages: [], learnings: [], status: 'closed' }, errors);
		expect(errors.some((e) => e.includes('status must be'))).toBe(true);
	});

	it('rejects a null/undefined payload', () => {
		const errors: string[] = [];
		expect(validateThread(null, errors)).toBeNull();
		expect(errors.length).toBeGreaterThan(0);
	});
});
