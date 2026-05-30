import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getActiveProfile } from '$lib/server/profileSession';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { computeReviewStats } from '$lib/review/stats/compute';

/**
 * Cross-game stats for the active parent profile, aggregated over all of its
 * linked accounts. Stats are computed server-side from already-stored games +
 * cached analyses (pure layer — no engine here). Games without an analysis show
 * up as `pending`; the page's batch-analyze loop fills them in the browser.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const profile = await getActiveProfile(cookies);
	if (!profile) throw redirect(303, '/');
	if (profile.role !== 'parent') throw redirect(303, '/');

	const accounts = profile.reviewAccounts;
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
