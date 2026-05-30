import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getActiveProfile } from '$lib/server/profileSession';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { listExplanations } from '$lib/server/reviewExplanations';
import { collectBlunders } from '$lib/review/stats/blunders';
import type { ReviewSource } from '$lib/review/types';

/**
 * Blunder trainer — a flat, most-severe-first queue of the person's own blunders
 * across their stored + analyzed games. Same data path as `/review/stats`
 * (pure collect over stored games + cached analyses), no engine here.
 *
 * Cached explanations are seeded with zero engine cost: one `listExplanations`
 * per game that has blunders, attached by ply, so revisiting a blunder you've
 * already explained renders instantly. The first-time explain runs an on-demand
 * engine pass in the browser (the accepted leaf-action cost).
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
	const entries = collectBlunders({ games, analyses, accounts: new Set(accounts) });

	const byGame = new Map<string, typeof entries>();
	for (const e of entries) {
		const key = `${e.source}:${e.gameId}`;
		const group = byGame.get(key) ?? [];
		group.push(e);
		byGame.set(key, group);
	}
	for (const group of byGame.values()) {
		const { source, gameId } = group[0];
		const cached = await listExplanations(source as ReviewSource, gameId);
		for (const e of group) {
			if (cached[e.ply]) e.cachedExplanation = cached[e.ply];
		}
	}

	return {
		accounts,
		entries,
		coverage: { analyzed: analyses.size, total: games.length }
	};
};
