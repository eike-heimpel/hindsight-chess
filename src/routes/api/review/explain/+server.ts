import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { isValidFen } from '$lib/chess/rules';
import type { EngineLine } from '$lib/engine/engine';
import { buildExplainFacts, type ReviewExplainRequest } from '$lib/review/explain';
import type { ReviewSource } from '$lib/review/types';
import { getExplanation, saveExplanation } from '$lib/server/reviewExplanations';
import { makeReviewExplainer } from '$lib/server/review-explainer-factory';

/**
 * POST /api/review/explain — grounded LLM annotation for one move. Mongo-gated.
 * The browser sends the engine lines (trusted, per the review trust model in
 * docs/review.md); the server re-derives all chess.js facts
 * canonically via `buildExplainFacts`, then calls the explainer. Cached by
 * {source, gameId, ply} so a repeat ask re-serves without an LLM call.
 */
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SOURCES: ReviewSource[] = ['chesscom', 'lichess', 'upload'];

export const POST: RequestHandler = async ({ locals, request }) => {
	await requireUser(locals);

	const parsed = parseRequest(await request.json().catch(() => null));
	if ('errors' in parsed) throw error(400, `Invalid request: ${parsed.errors.join('; ')}`);
	const req = parsed.value;

	const cached = await getExplanation(req.source, req.gameId, req.ply);
	if (cached) return json({ text: cached, cached: true });

	let facts;
	try {
		facts = buildExplainFacts(req);
	} catch (e) {
		throw error(400, `Could not ground explanation: ${e instanceof Error ? e.message : String(e)}`);
	}

	const { text } = await makeReviewExplainer().explain(facts);
	await saveExplanation({
		source: req.source,
		gameId: req.gameId,
		ply: req.ply,
		text,
		createdAt: new Date().toISOString()
	});
	return json({ text, cached: false });
};

function parseEngineLine(value: unknown, label: string, errors: string[]): EngineLine | null {
	if (!value || typeof value !== 'object') {
		errors.push(`${label} must be an object`);
		return null;
	}
	const v = value as Record<string, unknown>;
	const pvOk = Array.isArray(v.pv) && v.pv.every((m) => typeof m === 'string');
	if (typeof v.cp !== 'number') errors.push(`${label}.cp must be a number`);
	if (!pvOk) errors.push(`${label}.pv must be a string[]`);
	if (typeof v.moveUci !== 'string' || !UCI.test(v.moveUci)) {
		errors.push(`${label}.moveUci must be a UCI string`);
	}
	return errors.length ? null : (v as unknown as EngineLine);
}

function parseRequest(value: unknown): { value: ReviewExplainRequest } | { errors: string[] } {
	const errors: string[] = [];
	if (!value || typeof value !== 'object') return { errors: ['body must be a JSON object'] };
	const v = value as Record<string, unknown>;

	if (!SOURCES.includes(v.source as ReviewSource)) errors.push('source is invalid');
	if (typeof v.gameId !== 'string' || !v.gameId) errors.push('gameId must be a non-empty string');
	if (typeof v.ply !== 'number' || !Number.isInteger(v.ply) || v.ply < 1) {
		errors.push('ply must be a positive integer');
	}
	if (typeof v.fenBefore !== 'string' || !isValidFen(v.fenBefore)) {
		errors.push('fenBefore must be a valid FEN');
	}
	if (typeof v.playedUci !== 'string' || !UCI.test(v.playedUci)) {
		errors.push('playedUci must be a UCI string');
	}
	if (!Array.isArray(v.bestLines) || v.bestLines.length === 0) {
		errors.push('bestLines must be a non-empty array');
	} else {
		v.bestLines.forEach((l, i) => parseEngineLine(l, `bestLines[${i}]`, errors));
	}
	if (v.replyLine !== null) parseEngineLine(v.replyLine, 'replyLine', errors);

	if (errors.length) return { errors };
	return { value: v as unknown as ReviewExplainRequest };
}
