import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser } from '$lib/server/auth';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { computeReviewStats } from '$lib/review/stats/compute';

/**
 * Cross-game stats for the current user, aggregated over all of their linked
 * accounts. Stats are computed server-side from already-stored games + cached
 * analyses (pure layer — no engine here). Games without an analysis show up as
 * `pending`; the page's batch-analyze loop fills them in the browser.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(303, '/');

	const accounts = user.reviewAccounts;
	const games = await listGamesForAccounts(accounts);
	const analyses = await getAnalysesByIds(
		games.map((g) => ({ source: g.source, gameId: g.gameId }))
	);

	const stats = computeReviewStats({ games, analyses, accounts: new Set(accounts) });

	const pending = games
		.filter((g) => !analyses.has(`${g.source}:${g.gameId}`))
		.map((g) => ({ source: g.source, gameId: g.gameId }));

	return {
		accounts,
		stats,
		pending,
		coverage: { analyzed: games.length - pending.length, total: games.length }
	};
};
