import type { PageServerLoad } from './$types';
import { requireUserOrRedirect } from '$lib/server/auth';
import { listRecentGames } from '$lib/server/reviewGames';
import type { ReviewGame } from '$lib/review/types';

/**
 * Your games — the browser for the active profile's stored games. Connection
 * management (link / switch / sync / remove) lives on `/account`; this page is
 * just the list. English UI — see `docs/review.md`.
 */

const LIST_LIMIT = 20;

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

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await requireUserOrRedirect(locals);
	const account = user.activeAccount;
	// Present only right after a sync redirect from /account; null otherwise.
	const syncedParam = url.searchParams.get('synced');
	const syncedNum = syncedParam === null ? NaN : Number(syncedParam);
	const games = account ? await listRecentGames(account, LIST_LIMIT) : [];
	return {
		account,
		synced: Number.isFinite(syncedNum) ? syncedNum : null,
		games: games.map(toSummary)
	};
};
