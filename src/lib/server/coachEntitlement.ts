import type { MoveRef } from './userMoveState';

/** The one gate for opening a coach conversation on a move. Today it allows
 *  everything. When monetization lands it will count distinct (userId, UTC-day)
 *  moves and enforce the tier (free ≈ 1/day, premium ≈ N). See
 *  docs/learning-model.md. Throw a SvelteKit `error(402/429, ...)` here to deny. */
export async function assertCanDiscuss(userId: string, ref: MoveRef): Promise<void> {
	// allow-all for now — seam only, no enforcement
	void userId;
	void ref;
}
