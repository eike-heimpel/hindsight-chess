import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser } from '$lib/server/auth';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { computeReviewStats } from '$lib/review/stats/compute';

/**
 * Winnable-losses deep dive — same data path as `/review/stats` (pure stats over
 * stored games + cached analyses), but this page only consumes `stats[*].winnable`
 * and tiers it client-side with the live levers. No engine/LLM here; the
 * "Explain what went wrong" action runs in the browser on demand.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(303, '/login');

	// Scoped to the active profile — platforms stay separate.
	const active = user.activeAccount;
	const accounts = active ? [active.username] : [];
	const games = active ? await listGamesForAccounts([active]) : [];
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
