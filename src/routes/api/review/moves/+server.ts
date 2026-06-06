import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { parseMoveRef } from '$lib/server/moveRefRequest';
import { SOURCES, GAME_ID } from '$lib/review/explainRequest';
import {
	clearMark,
	clearMove,
	clearNote,
	clearThread,
	gateOwnedGame,
	getGameMoveStates,
	saveThread,
	setMark,
	setNote,
	type MoveState
} from '$lib/server/userMoveState';
import type { ReviewSource } from '$lib/review/types';
import type { DiscussTurn, Learning } from '$lib/review/coach/types';

/**
 * Per-user move-state writes/reads. `mark` and `note` are user opinion — trusted
 * after the ownership gate (which also derives `side`). Mirrors the review API
 * routes: `requireUser` → validate → ownership gate → store.
 *
 * - POST {ref, facet:'mark'|'note'|'thread', value} → setMark / setNote / saveThread
 * - GET ?source&gameId → per-game overlay (ply → MoveState)
 * - DELETE {ref, facet?} → clear one facet (`$unset`, keeps coexisting facets);
 *   without `facet`, removes the whole move record
 */
type Facet = 'mark' | 'note' | 'thread';
const MARKS: NonNullable<MoveState['mark']>[] = ['star', 'done', 'dismissed'];
/** A user note is their own prose, trusted after the ownership gate — but capped
 *  so a single doc can't be inflated toward the 16MB BSON ceiling. */
const MAX_NOTE_LENGTH = 4096;

/** A coach thread is the user's own private conversation — trusted after the
 *  ownership gate, exactly like a note. The caps only stop one doc from being
 *  inflated toward the 16MB BSON ceiling. */
const MAX_THREAD_MESSAGES = 60;
const MAX_THREAD_CONTENT_LENGTH = 4096;
const MAX_THREAD_LEARNINGS = 20;
const MAX_LEARNING_POINT_LENGTH = 1024;
const THREAD_ROLES: DiscussTurn['role'][] = ['coach', 'player'];
const LEARNING_LEVELS: Learning['level'][] = ['tactical', 'principle', 'process'];
const THREAD_STATUSES: NonNullable<MoveState['thread']>['status'][] = ['open', 'wrapped'];

type ThreadPayload = {
	messages: DiscussTurn[];
	learnings: Learning[];
	status: NonNullable<MoveState['thread']>['status'];
};

/** Validate the POSTed thread payload, pushing readable errors (fail fast). The
 *  thread is the user's own conversation, so this only enforces shape + caps.
 *  Exported for the validation unit test (no Mongo). */
export function validateThread(value: unknown, errors: string[]): ThreadPayload | null {
	const v = (value ?? {}) as Record<string, unknown>;

	if (!Array.isArray(v.messages)) {
		errors.push('value.messages must be an array');
	} else {
		if (v.messages.length > MAX_THREAD_MESSAGES) {
			errors.push(`value.messages must have at most ${MAX_THREAD_MESSAGES} items`);
		}
		v.messages.forEach((m, i) => {
			const t = (m ?? {}) as Record<string, unknown>;
			if (!THREAD_ROLES.includes(t.role as DiscussTurn['role'])) {
				errors.push(`value.messages[${i}].role must be "coach" or "player"`);
			}
			if (typeof t.content !== 'string') {
				errors.push(`value.messages[${i}].content must be a string`);
			} else if (t.content.length > MAX_THREAD_CONTENT_LENGTH) {
				errors.push(
					`value.messages[${i}].content must be at most ${MAX_THREAD_CONTENT_LENGTH} characters`
				);
			}
		});
	}

	if (!Array.isArray(v.learnings)) {
		errors.push('value.learnings must be an array');
	} else {
		if (v.learnings.length > MAX_THREAD_LEARNINGS) {
			errors.push(`value.learnings must have at most ${MAX_THREAD_LEARNINGS} items`);
		}
		v.learnings.forEach((l, i) => {
			const t = (l ?? {}) as Record<string, unknown>;
			if (!LEARNING_LEVELS.includes(t.level as Learning['level'])) {
				errors.push(`value.learnings[${i}].level must be "tactical", "principle", or "process"`);
			}
			if (typeof t.point !== 'string') {
				errors.push(`value.learnings[${i}].point must be a string`);
			} else if (t.point.length > MAX_LEARNING_POINT_LENGTH) {
				errors.push(
					`value.learnings[${i}].point must be at most ${MAX_LEARNING_POINT_LENGTH} characters`
				);
			}
		});
	}

	if (!THREAD_STATUSES.includes(v.status as ThreadPayload['status'])) {
		errors.push('value.status must be "open" or "wrapped"');
	}

	if (errors.length) return null;
	return {
		messages: v.messages as DiscussTurn[],
		learnings: v.learnings as Learning[],
		status: v.status as ThreadPayload['status']
	};
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const errors: string[] = [];
	const ref = parseMoveRef(body?.ref, errors);
	const facet = body?.facet as Facet;
	if (facet !== 'mark' && facet !== 'note' && facet !== 'thread') {
		errors.push('facet must be "mark", "note", or "thread"');
	}
	let thread: ThreadPayload | null = null;
	if (ref && errors.length === 0) {
		if (facet === 'mark' && !MARKS.includes(body!.value as NonNullable<MoveState['mark']>)) {
			errors.push('value must be "star", "done", or "dismissed"');
		}
		if (facet === 'note') {
			if (typeof body!.value !== 'string') errors.push('value must be a string');
			else if (body!.value.length > MAX_NOTE_LENGTH) {
				errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters`);
			}
		}
		if (facet === 'thread') thread = validateThread(body!.value, errors);
	}
	if (!ref || errors.length) throw error(400, `Invalid request: ${errors.join('; ')}`);

	const { side } = await gateOwnedGame(user.reviewAccounts, ref);
	if (facet === 'mark') {
		await setMark(user.userId, ref, side, body!.value as NonNullable<MoveState['mark']>);
	} else if (facet === 'note') {
		await setNote(user.userId, ref, side, body!.value as string);
	} else {
		await saveThread(user.userId, ref, side, { ...thread!, updatedAt: new Date() });
	}

	return json({ ok: true });
};

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = await requireUser(locals);

	const source = url.searchParams.get('source');
	const gameId = url.searchParams.get('gameId');
	if (!source || !SOURCES.includes(source as ReviewSource) || !gameId || !GAME_ID.test(gameId)) {
		throw error(400, 'source and a valid gameId are required');
	}

	const states = await getGameMoveStates(user.userId, source as ReviewSource, gameId);
	return json({ states });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const errors: string[] = [];
	const ref = parseMoveRef(body?.ref, errors);
	const facet = body?.facet as Facet | undefined;
	if (facet !== undefined && facet !== 'mark' && facet !== 'note' && facet !== 'thread') {
		errors.push('facet, if given, must be "mark", "note", or "thread"');
	}
	if (!ref || errors.length) throw error(400, `Invalid request: ${errors.join('; ')}`);

	await gateOwnedGame(user.reviewAccounts, ref);
	if (facet === 'mark') await clearMark(user.userId, ref);
	else if (facet === 'note') await clearNote(user.userId, ref);
	else if (facet === 'thread') await clearThread(user.userId, ref);
	else await clearMove(user.userId, ref);

	return json({ ok: true });
};
