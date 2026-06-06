import type { MoveState } from '$lib/server/userMoveState';
import type { DiscussTurn, Learning } from '$lib/review/coach/types';

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

export type ThreadPayload = {
	messages: DiscussTurn[];
	learnings: Learning[];
	status: NonNullable<MoveState['thread']>['status'];
};

/** Validate the POSTed thread payload, pushing readable errors (fail fast). The
 *  thread is the user's own conversation, so this only enforces shape + caps.
 *  Lives in its own module (not `+server.ts`) so the endpoint exports only HTTP
 *  handlers — and so the validation unit test can import it without Mongo. */
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
