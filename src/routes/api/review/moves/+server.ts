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
import { validateThread, type ThreadPayload } from './validateThread';

/**
 * Per-user move-state writes/reads. `mark` and `note` are user opinion — trusted
 * after the ownership gate (which also derives `side`). Mirrors the review API
 * routes: `requireUser` → validate → ownership gate → store.
 *
 * - POST {ref, facet:'mark'|'note'|'thread', value} → setMark / setNote / saveThread
 * - GET ?source&gameId → per-game overlay (ply → MoveState)
 * - DELETE {ref, facet?} → clear one facet (`$unset`, keeps coexisting facets);
 *   without `facet`, removes the whole move record
 *
 * Thread payload validation lives in `./validateThread` so this endpoint exports
 * only HTTP handlers (a SvelteKit `+server.ts` may export nothing else).
 */
type Facet = 'mark' | 'note' | 'thread';
const MARKS: NonNullable<MoveState['mark']>[] = ['star', 'done', 'dismissed'];
/** A user note is their own prose, trusted after the ownership gate — but capped
 *  so a single doc can't be inflated toward the 16MB BSON ceiling. */
const MAX_NOTE_LENGTH = 4096;

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
