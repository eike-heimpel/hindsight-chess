import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { buildExplainFacts } from '$lib/review/explain';
import { validateExplanation, buildFallbackExplanation } from '$lib/review/explainGate';
import { applyMove } from '$lib/chess/rules';
import { parseExplainRequest } from '$lib/review/explainRequest';
import { getReviewGame } from '$lib/server/reviewGames';
import { ownedSide } from '$lib/server/userMoveState';
import { getExplanation, saveExplanation } from '$lib/server/reviewExplanations';
import { makeReviewExplainer } from '$lib/server/review-explainer-factory';

/**
 * POST /api/review/explain — grounded LLM annotation for one move. Mongo-gated.
 * Same trust boundary as /api/review/coach/discuss: the browser sends only
 * engine numbers (the lines); the server re-derives every chess.js fact
 * canonically via `buildExplainFacts` and validates `fenBefore`/`playedUci`
 * against its OWN stored move at `ply`, so a write to the global explanation
 * cache can't be poisoned with a position that isn't the real move there.
 * Cached by {source, gameId, ply} so a repeat ask re-serves without an LLM call.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const parsed = parseExplainRequest(raw);
	if ('errors' in parsed) throw error(400, `Invalid request: ${parsed.errors.join('; ')}`);
	const req = parsed.value;

	// The viewer's colour, derived from their linked accounts (never the client) —
	// it sets the explanation's voice and keys the cache, so the same move can read
	// "you played" to one side and "White played" to the other.
	const game = await getReviewGame(req.source, req.gameId);
	if (!game) throw error(404, 'unknown game');
	const side = ownedSide(game, user.reviewAccounts);
	if (!side) throw error(403, 'not your game');

	const stored = game.moves[req.ply - 1];
	if (!stored) throw error(400, `ply ${req.ply} is out of range for this game`);
	if (stored.fenBefore !== req.fenBefore || stored.uci !== req.playedUci) {
		throw error(400, 'fenBefore/playedUci do not match the stored move');
	}

	// `regenerate` skips the cache read so the grounded+gated pipeline reruns and
	// overwrites a stale/wrong cached explanation. The trust checks above are
	// unchanged — only the cache lookup is bypassed.
	const regenerate = raw?.regenerate === true;
	const cached = regenerate ? null : await getExplanation(req.source, req.gameId, req.ply, side);
	if (cached) return json({ text: cached, cached: true });

	let facts;
	try {
		facts = buildExplainFacts(req, side);
	} catch (e) {
		throw error(400, `Could not ground explanation: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Validate against chess.js ground truth, regenerate once with the proven-false
	// claims fed back, then fall back to a facts-only blurb. Only verified text is
	// ever cached or returned — a board claim that contradicts chess.js never ships.
	const explainer = makeReviewExplainer();
	const fenAfter = applyMove(req.fenBefore, req.playedUci).fen;
	const gateCtx = { fenBefore: req.fenBefore, fenAfter, facts };

	let text = (await explainer.explain(facts)).text;
	let verdict = validateExplanation(text, gateCtx);
	if (!verdict.ok) {
		text = (await explainer.explain(facts, verdict.violations.join('\n- '))).text;
		verdict = validateExplanation(text, gateCtx);
		if (!verdict.ok) text = buildFallbackExplanation(facts);
	}

	await saveExplanation({
		source: req.source,
		gameId: req.gameId,
		ply: req.ply,
		perspective: side,
		text,
		createdAt: new Date().toISOString()
	});
	return json({ text, cached: false });
};
