import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { buildAnalysis, type AnalyzeRequest } from '$lib/review/analysis';
import type { EngineEval } from '$lib/engine/engine';
import type { ReviewSource } from '$lib/review/types';
import { getAnalysis, saveAnalysis } from '$lib/server/reviewAnalysis';
import { getReviewGame } from '$lib/server/reviewGames';

/**
 * POST /api/review/analyze — persist a browser-computed game analysis.
 *
 * The browser sends raw engine evals (trusted, per the review trust model), NOT
 * the derived analysis: the server re-runs `buildAnalysis` against its OWN stored
 * game moves, so the classification/accuracy layer is authenticated and the cache
 * (global, keyed `source:gameId`) can't be poisoned with an analysis that doesn't
 * match the real game. A shallow pass can't clobber a deeper stored one.
 */
const SOURCES: ReviewSource[] = ['chesscom', 'lichess', 'upload'];

export const POST: RequestHandler = async ({ locals, request }) => {
	await requireUser(locals);

	const parsed = parseRequest(await request.json().catch(() => null));
	if ('errors' in parsed) throw error(400, `Invalid request: ${parsed.errors.join('; ')}`);
	const { source, gameId, depth, evals } = parsed.value;

	const game = await getReviewGame(source, gameId);
	if (!game) throw error(404, 'unknown game');

	// Don't let a shallow (teaser) pass overwrite a deeper persisted analysis.
	const existing = await getAnalysis(source, gameId);
	if (existing && existing.depth > depth) return json({ ok: true, kept: true });

	let analysis;
	try {
		analysis = buildAnalysis({ source, gameId, depth, moves: game.moves, evals });
	} catch (e) {
		throw error(400, `evals do not match game: ${e instanceof Error ? e.message : String(e)}`);
	}

	await saveAnalysis(analysis);
	return json({ ok: true });
};

function parseEval(value: unknown, label: string, errors: string[]): EngineEval | null {
	if (!value || typeof value !== 'object') {
		errors.push(`${label} must be an object`);
		return null;
	}
	const v = value as Record<string, unknown>;
	if (typeof v.cp !== 'number' || !Number.isFinite(v.cp))
		errors.push(`${label}.cp must be a number`);
	if (typeof v.bestMoveUci !== 'string') errors.push(`${label}.bestMoveUci must be a string`);
	if (typeof v.bestMoveSan !== 'string') errors.push(`${label}.bestMoveSan must be a string`);
	return errors.length ? null : (v as unknown as EngineEval);
}

function parseRequest(value: unknown): { value: AnalyzeRequest } | { errors: string[] } {
	const errors: string[] = [];
	if (!value || typeof value !== 'object') return { errors: ['body must be a JSON object'] };
	const v = value as Record<string, unknown>;

	if (!SOURCES.includes(v.source as ReviewSource)) errors.push('source is invalid');
	if (typeof v.gameId !== 'string' || !v.gameId) errors.push('gameId must be a non-empty string');
	if (typeof v.depth !== 'number' || !Number.isInteger(v.depth) || v.depth < 1) {
		errors.push('depth must be a positive integer');
	}
	if (!Array.isArray(v.evals) || v.evals.length === 0) {
		errors.push('evals must be a non-empty array');
	} else {
		v.evals.forEach((e, i) => parseEval(e, `evals[${i}]`, errors));
	}

	if (errors.length) return { errors };
	return { value: v as unknown as AnalyzeRequest };
}
