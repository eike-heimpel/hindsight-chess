import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	requireUserOrRedirect,
	setUserActiveAccount,
	setUserReviewAccounts
} from '$lib/server/auth';
import { sourceFor, IMPORTABLE_SOURCES } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';
import { countGamesForAccount, listStoredGameIds, upsertGames } from '$lib/server/reviewGames';
import { lastSyncedAt } from '$lib/server/reviewSync';
import { linkAccount } from '$lib/server/reviewLink';
import { accountKey, type ReviewAccount, type ReviewSource } from '$lib/review/types';

/**
 * Account management — link / switch / sync / remove the user's platform
 * profiles. Split out from `/review` (now the pure games browser) so managing
 * connections isn't buried under a flood of game cards. Connecting a profile
 * reuses the same `ConnectProfile` reveal the landing and onboarding use.
 */

const SYNC_LIMIT = 50;
/** Full back-fill cap. Generous — only bounds pathological accounts. */
const BACKFILL_LIMIT = 2000;

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

/** Map a platform fetch error to a form `fail` the page can render. */
function pullFailure(account: ReviewAccount, kind: string) {
	const notFound = kind === 'not_found';
	const platform = account.source === 'lichess' ? 'lichess' : 'chess.com';
	return fail(notFound ? 404 : 502, {
		username: account.username,
		source: account.source,
		message: notFound
			? `No ${platform} player "${account.username}".`
			: `Could not reach ${platform}. Try again.`
	});
}

/** Pull from the profile's platform and store. Incremental sync passes
 *  `knownGameIds` to stop at the first stored game; a full back-fill omits it.
 *  Throws the success redirect; returns a `fail` only on error. */
async function pullAndStore(
	account: ReviewAccount,
	opts: { limit: number; knownGameIds?: Set<string> }
) {
	const result = await sourceFor(account.source).listGames(account.username, opts);
	if (!result.ok) return pullFailure(account, result.error.kind);
	await upsertGames(result.value.map(normalize));
	throw redirect(303, `/account?synced=${result.value.length}`);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUserOrRedirect(locals);
	const activeKey = user.activeAccount ? accountKey(user.activeAccount) : null;

	const accounts = await Promise.all(
		user.reviewAccounts.map(async (account) => ({
			account,
			active: accountKey(account) === activeKey,
			gamesCount: await countGamesForAccount(account),
			lastSyncedAt: await lastSyncedAt(accountKey(account))
		}))
	);

	const syncedParam = url.searchParams.get('synced');
	const syncedNum = syncedParam === null ? NaN : Number(syncedParam);
	return { accounts, synced: Number.isFinite(syncedNum) ? syncedNum : null };
};

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

		return pullAndStore(account, { limit: BACKFILL_LIMIT });
	},

	addAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (!account) {
			return fail(400, { username: '', message: 'Pick a platform and enter a username.' });
		}

		const result = await linkAccount(user, account);
		if (!result.ok) return pullFailure(account, result.error.kind);
		// Land on the home recap — the payoff — for both onboarding and add-another.
		throw redirect(303, '/home');
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
		throw redirect(303, '/account');
	},

	selectAccount: async ({ locals, request }) => {
		const user = await requireUserOrRedirect(locals);
		const account = readAccount(await request.formData());
		if (account) await setUserActiveAccount(user.userId, account);
		throw redirect(303, '/account');
	}
};
