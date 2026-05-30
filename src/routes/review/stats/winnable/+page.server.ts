import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getActiveProfile } from '$lib/server/profileSession';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { computeReviewStats } from '$lib/review/stats/compute';

/**
 * Winnable-losses deep dive — same data path as `/review/stats` (pure stats over
 * stored games + cached analyses), but this page only consumes `stats[*].winnable`
 * and tiers it client-side with the live levers. No engine/LLM here; the
 * "Explain what went wrong" action runs in the browser on demand.
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

	const analyzed = analyses.size;
	return {
		accounts,
		stats,
		coverage: { analyzed, total: games.length }
	};
};
