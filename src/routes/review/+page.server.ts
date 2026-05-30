import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser, setUserActiveAccount, setUserReviewAccounts, type User } from '$lib/server/auth';
import { sourceFor, IMPORTABLE_SOURCES } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';
import { listRecentGames, listStoredGameIds, upsertGames } from '$lib/server/reviewGames';
import {
	accountKey,
	type ReviewAccount,
	type ReviewGame,
	type ReviewSource
} from '$lib/review/types';

/**
 * Game-review home. Lists stored games for the user's active profile; the
 * `?/sync` action pulls only games newer than what's stored (incremental).
 * `?/addAccount` / `?/removeAccount` / `?/selectAccount` manage and switch the
 * user's linked profiles. Profiles stay separate (chess.com vs lichess); the
 * active one scopes the whole app. English UI — see `docs/review.md`.
 */

const SYNC_LIMIT = 50;
const LIST_LIMIT = 20;
/** Full back-fill cap. Generous — only bounds pathological accounts with
 *  thousands of games. */
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

/** Read a `{source, username}` profile from a submitted form, validating the
 *  source against the adapters we actually have. */
function readAccount(form: FormData): ReviewAccount | null {
	const username = String(form.get('username') ?? '')
		.trim()
		.toLowerCase();
	const source = String(form.get('source') ?? '') as ReviewSource;
	if (!username || !IMPORTABLE_SOURCES.includes(source)) return null;
	return { source, username };
}

async function requireUserOrRedirect(locals: App.Locals): Promise<User> {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(303, '/login');
	return user;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUserOrRedirect(locals);
	const account = user.activeAccount;
	// Present only right after a ?/sync redirect; null otherwise (no banner).
	const syncedParam = url.searchParams.get('synced');
	const syncedNum = syncedParam === null ? NaN : Number(syncedParam);
	const games = account ? await listRecentGames(account, LIST_LIMIT) : [];
	return {
		account,
		reviewAccounts: user.reviewAccounts,
		synced: Number.isFinite(syncedNum) ? syncedNum : null,
		games: games.map(toSummary)
	};
};

/** Pull from the profile's platform and store. Incremental sync passes
 *  `knownGameIds` to stop at the first already-stored game; a full back-fill
 *  omits it (and uses a high limit) to walk the entire history — upserts are
 *  idempotent, so re-pulling stored games is harmless. Throws the success
 *  redirect; returns a `fail` only on error, so callers must `return` this. */
async function pullAndStore(
	account: ReviewAccount,
	opts: { limit: number; knownGameIds?: Set<string> }
) {
	const result = await sourceFor(account.source).listGames(account.username, opts);
	if (!result.ok) {
		const notFound = result.error.kind === 'not_found';
		const platform = account.source === 'lichess' ? 'lichess' : 'chess.com';
		return fail(notFound ? 404 : 502, {
			username: account.username,
			source: account.source,
			message: notFound
				? `No ${platform} player "${account.username}".`
				: `Could not reach ${platform}. Try again.`
		});
	}
	await upsertGames(result.value.map(normalize));
	throw redirect(303, `/review?synced=${result.value.length}`);
}

export const actions: Actions = {
	sync: async ({ locals, request }) => {
		await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (!account) return fail(400, { username: '', message: 'No profile to sync.' });

		const knownGameIds = await listStoredGameIds(account);
		return pullAndStore(account, { limit: SYNC_LIMIT, knownGameIds });
	},

	syncAll: async ({ locals, request }) => {
		await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (!account) return fail(400, { username: '', message: 'No profile to sync.' });

		// No knownGameIds → walk the whole history, back-filling older games that
		// incremental sync can't reach (it stops at the first stored game).
		return pullAndStore(account, { limit: BACKFILL_LIMIT });
	},

	addAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (!account) {
			return fail(400, { username: '', message: 'Pick a platform and enter a username.' });
		}

		await setUserReviewAccounts(user.userId, [...user.reviewAccounts, account]);
		await setUserActiveAccount(user.userId, account);
		throw redirect(303, '/review');
	},

	removeAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (!account) return fail(400, { username: '', message: 'No profile to remove.' });

		const key = accountKey(account);
		const remaining = user.reviewAccounts.filter((a) => accountKey(a) !== key);
		await setUserReviewAccounts(user.userId, remaining);
		// If we just removed the active profile, point at whatever's left.
		if (accountKey(user.activeAccount ?? account) === key && remaining[0]) {
			await setUserActiveAccount(user.userId, remaining[0]);
		}
		throw redirect(303, '/review');
	},

	selectAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (account) await setUserActiveAccount(user.userId, account);
		throw redirect(303, '/review');
	}
};
