import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { saveAnalysis } from '$lib/server/reviewAnalysis';
import type { GameAnalysis } from '$lib/review/analysis';

/** Persist a browser-computed game analysis. */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireUser(locals);

	const analysis = (await request.json()) as GameAnalysis;
	if (!analysis?.source || !analysis?.gameId || !Array.isArray(analysis.moves)) {
		throw error(400, 'malformed analysis');
	}

	await saveAnalysis(analysis);
	return json({ ok: true });
};
