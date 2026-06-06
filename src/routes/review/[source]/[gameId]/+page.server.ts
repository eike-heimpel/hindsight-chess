import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser } from '$lib/server/auth';
import { getReviewGame } from '$lib/server/reviewGames';
import { getAnalysis } from '$lib/server/reviewAnalysis';
import { listExplanations } from '$lib/server/reviewExplanations';
import { getGameMoveStates, ownedSide } from '$lib/server/userMoveState';
import type { ReviewSource } from '$lib/review/types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(303, '/login');

	const source = params.source as ReviewSource;
	const [game, analysis, moveStates] = await Promise.all([
		getReviewGame(source, params.gameId),
		getAnalysis(source, params.gameId),
		getGameMoveStates(user.userId, source, params.gameId)
	]);
	if (!game) throw error(404, 'game not found');

	// Seed explanations from the viewer's perspective — the cache is split by side,
	// so the wrong slice would surface "you played" on the opponent's moves. Empty
	// when none of the viewer's accounts played this game (a non-owned game).
	const side = ownedSide(game, user.reviewAccounts);
	const explanations = side ? await listExplanations(source, params.gameId, side) : {};

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

	return { game, analysis, orientation, me, explanations, initialPly, moveStates };
};
