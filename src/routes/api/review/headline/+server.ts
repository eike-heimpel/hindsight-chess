import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { getReviewGame } from '$lib/server/reviewGames';
import { getAnalysis } from '$lib/server/reviewAnalysis';
import { getUserSettings } from '$lib/server/userSettings';
import { getHeadline, saveHeadline } from '$lib/server/reviewHeadlines';
import { makeHeadlineWriter } from '$lib/server/review-headline-factory';
import { sideFor, toPerspective } from '$lib/review/stats/perspective';
import { templateHeadline } from '$lib/review/headlineTemplate';
import { buildHeadlineFacts } from '$lib/review/headlineFacts';
import type { ReviewSource } from '$lib/review/types';

/**
 * POST /api/review/headline — the home card's "story" headline for one game.
 * `{ source, gameId }`. The LLM narrates the win-% arc from the player's side;
 * it's non-critical, so anything that goes wrong (not analyzed, setting off, LLM
 * off, writer throws) falls back to the deterministic `templateHeadline` rather
 * than 500ing. Cached by `{source, gameId, side}` so a repeat ask is free.
 */
const SOURCES: ReviewSource[] = ['chesscom', 'lichess', 'upload'];

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const source = body?.source as ReviewSource;
	const gameId = body?.gameId;
	if (!SOURCES.includes(source) || typeof gameId !== 'string' || !gameId) {
		throw error(400, 'source and gameId are required');
	}

	const game = await getReviewGame(source, gameId);
	if (!game) throw error(404, 'game not found');

	const accountsSet = new Set(user.reviewAccounts.map((a) => a.username.toLowerCase()));
	const analysis = await getAnalysis(source, gameId);
	const perspective = toPerspective(game, analysis, accountsSet);
	if (!perspective) throw error(404, 'game not found for this user');

	// No analysis yet → no curve to narrate; serve the template, no LLM.
	if (!analysis) return json({ text: templateHeadline(perspective), llm: false });

	const settings = await getUserSettings(user.userId);
	if (!settings.llmHeadlines) return json({ text: templateHeadline(perspective), llm: false });

	const side = sideFor(game, accountsSet)!;
	const cached = await getHeadline(source, gameId, side);
	if (cached) return json({ text: cached, llm: true });

	const writer = makeHeadlineWriter();
	if (!writer) return json({ text: templateHeadline(perspective), llm: false });

	try {
		const text = await writer.write(buildHeadlineFacts(perspective));
		await saveHeadline({ source, gameId, side, text, createdAt: new Date().toISOString() });
		return json({ text, llm: true });
	} catch {
		// Headline is non-critical — never fail the card over it.
		return json({ text: templateHeadline(perspective), llm: false });
	}
};
