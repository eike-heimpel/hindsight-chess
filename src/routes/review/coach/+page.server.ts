import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { requireUserOrRedirect } from '$lib/server/auth';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import type { ReviewGame } from '$lib/review/types';

/**
 * Coach game picker — same stored-game list as `/review`, scoped to the active
 * profile. Rows deep-link into the guided-coach surface. English UI.
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

export const load: PageServerLoad = async ({ locals }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await requireUserOrRedirect(locals);
	const account = user.activeAccount;
	const games = account ? await listGamesForAccounts([account], LIST_LIMIT) : [];
	return { account, games: games.map(toSummary) };
};
