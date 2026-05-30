import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getActiveProfile } from '$lib/server/profileSession';
import { getReviewGame } from '$lib/server/reviewGames';
import { getAnalysis } from '$lib/server/reviewAnalysis';
import { listExplanations } from '$lib/server/reviewExplanations';
import type { ReviewSource } from '$lib/review/types';

export const load: PageServerLoad = async ({ cookies, params, url }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const profile = await getActiveProfile(cookies);
	if (!profile) throw redirect(303, '/');
	if (profile.role !== 'parent') throw redirect(303, '/');

	const source = params.source as ReviewSource;
	const [game, analysis, explanations] = await Promise.all([
		getReviewGame(source, params.gameId),
		getAnalysis(source, params.gameId),
		listExplanations(source, params.gameId)
	]);
	if (!game) throw error(404, 'game not found');

	// Orient the board to the viewer's side. An explicit `?orient` wins (used when
	// deep-linking from the stats screens, which know the side); otherwise infer
	// from the `?me` username.
	const me = url.searchParams.get('me')?.trim().toLowerCase() ?? '';
	const orientParam = url.searchParams.get('orient');
	const orientation: 'white' | 'black' =
		orientParam === 'white' || orientParam === 'black'
			? orientParam
			: me && game.black.username.toLowerCase() === me
				? 'black'
				: 'white';

	// Deep-link straight to a move (e.g. the give-back move of a winnable loss).
	const plyParam = parseInt(url.searchParams.get('ply') ?? '', 10);
	const initialPly = Number.isFinite(plyParam)
		? Math.max(0, Math.min(game.moves.length, plyParam))
		: 0;

	return { game, analysis, orientation, me, explanations, initialPly };
};
