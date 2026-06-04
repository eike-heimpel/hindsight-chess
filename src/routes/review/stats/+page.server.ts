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
 * analyses (pure layer — no engine here). `coverage` reports how many games
 * back the accuracy/move-quality numbers; the catch-up analyze control lives on
 * the accounts page.
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

	const analyzed = games.filter((g) => analyses.has(`${g.source}:${g.gameId}`)).length;

	return {
		accounts,
		stats,
		coverage: { analyzed, total: games.length }
	};
};
