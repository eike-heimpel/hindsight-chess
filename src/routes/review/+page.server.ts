import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser, setUserReviewAccounts, type User } from '$lib/server/auth';
import { ChessComSource } from '$lib/review/sources/chesscom';
import { normalize } from '$lib/review/normalize';
import { listRecentGames, listStoredGameIds, upsertGames } from '$lib/server/reviewGames';
import type { ReviewGame } from '$lib/review/types';

/**
 * Game-review home. Lists stored games for one of the user's linked chess.com
 * accounts; the `?/sync` action pulls only games newer than what's stored
 * (incremental). `?/addAccount` / `?/removeAccount` manage the user's linked
 * accounts. English UI — see `docs/review.md`.
 */

const SYNC_LIMIT = 50;
const LIST_LIMIT = 20;
/** Full back-fill cap. Generous — chess.com history is walked oldest archive
 *  forward; this only bounds pathological accounts with thousands of games. */
const BACKFILL_LIMIT = 2000;

function toSummary(g: ReviewGame) {
	return {
		source: g.source,
		gameId: g.gameId,
		url: g.url,
		playedAt: g.playedAt,
		timeClass: g.timeClass,
		timeControl: g.timeControl,
		rated: g.rated,
		opening: g.opening,
		eco: g.eco,
		white: g.white,
		black: g.black,
		result: g.result,
		termination: g.termination,
		plies: g.moves.length
	};
}

const readUsername = (form: FormData) =>
	String(form.get('username') ?? '')
		.trim()
		.toLowerCase();

async function requireUserOrRedirect(locals: App.Locals): Promise<User> {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(303, '/login');
	return user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUserOrRedirect(locals);
	const linked = user.reviewAccounts;
	// A ?user= override lets you peek at any account; otherwise default to the
	// user's first linked account.
	const requested = url.searchParams.get('user')?.trim().toLowerCase();
	const account = requested || linked[0] || '';
	// Present only right after a ?/sync redirect; null otherwise (no banner).
	const syncedParam = url.searchParams.get('synced');
	const syncedNum = syncedParam === null ? NaN : Number(syncedParam);
	const games = account ? await listRecentGames(account, LIST_LIMIT) : [];
	return {
		account,
		reviewAccounts: linked,
		synced: Number.isFinite(syncedNum) ? syncedNum : null,
		games: games.map(toSummary)
	};
};

/** Pull from chess.com and store. Incremental sync passes `knownGameIds` to stop
 *  at the first already-stored game; a full back-fill omits it (and uses a high
 *  limit) to walk the entire history — upserts are idempotent, so re-pulling
 *  stored games is harmless. Throws the success redirect; returns a `fail` only
 *  on error, so callers must `return` this. */
async function pullAndStore(username: string, opts: { limit: number; knownGameIds?: Set<string> }) {
	const result = await new ChessComSource().listGames(username, opts);
	if (!result.ok) {
		const notFound = result.error.kind === 'not_found';
		return fail(notFound ? 404 : 502, {
			username,
			message: notFound
				? `No chess.com player "${username}".`
				: 'Could not reach chess.com. Try again.'
		});
	}
	await upsertGames(result.value.map(normalize));
	throw redirect(303, `/review?user=${encodeURIComponent(username)}&synced=${result.value.length}`);
}

export const actions: Actions = {
	sync: async ({ locals, request }) => {
		await requireUserOrRedirect(locals);
		const username = readUsername(await request.formData());
		if (!username) return fail(400, { username: '', message: 'No account to sync.' });

		const knownGameIds = await listStoredGameIds(username);
		return pullAndStore(username, { limit: SYNC_LIMIT, knownGameIds });
	},

	syncAll: async ({ locals, request }) => {
		await requireUserOrRedirect(locals);
		const username = readUsername(await request.formData());
		if (!username) return fail(400, { username: '', message: 'No account to sync.' });

		// No knownGameIds → walk the whole history, back-filling older games that
		// incremental sync can't reach (it stops at the first stored game).
		return pullAndStore(username, { limit: BACKFILL_LIMIT });
	},

	addAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const username = readUsername(await request.formData());
		if (!username) return fail(400, { username: '', message: 'Enter a chess.com username.' });

		await setUserReviewAccounts(user.userId, [...user.reviewAccounts, username]);
		throw redirect(303, `/review?user=${encodeURIComponent(username)}`);
	},

	removeAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const username = readUsername(await request.formData());
		await setUserReviewAccounts(
			user.userId,
			user.reviewAccounts.filter((a) => a !== username)
		);
		throw redirect(303, '/review');
	}
};
