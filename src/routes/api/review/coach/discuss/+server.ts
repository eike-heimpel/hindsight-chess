import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import type { Side } from '$lib/chess/types';
import type { ReviewGame } from '$lib/review/types';
import type { GameAnalysis } from '$lib/review/analysis';
import { parseEngineRequestBase } from '$lib/review/explainRequest';
import { getReviewGame } from '$lib/server/reviewGames';
import { getAnalysis } from '$lib/server/reviewAnalysis';
import { buildTurningPointFacts, type TurningPointInput } from '$lib/review/coach/facts';
import { factsBlock } from '$lib/review/coach/prompt';
import { discuss } from '$lib/review/coach/coach';
import { gradeReply } from '$lib/review/coach/gate';
import { assertCanDiscuss } from '$lib/server/coachEntitlement';
import type {
	CoachIntent,
	CoachTurnRequest,
	DiscussTurn,
	MomentKind,
	TurningPointFacts
} from '$lib/review/coach/types';

/**
 * POST /api/review/coach/discuss — one turn of the guided coaching conversation.
 *
 * Same trust boundary as /api/review/explain: the browser sends only engine
 * numbers (the lines), and the server re-derives every chess.js + game fact from
 * its OWN stored game. The client's `fenBefore`/`playedUci` are validated against
 * `moves[ply-1]`, the coached side comes from the active account (never a client
 * field), and `kind`/`setup` are re-derived from the cached analysis — a client
 * may not assert this is a "mistake" or "opportunity". After the LLM speaks, a
 * cheap grounding gate (one capped, un-re-gated retry) catches hallucinated
 * pieces/moves/evals before the reply leaves the server.
 */
const INTENTS: CoachIntent[] = ['open', 'answer', 'guide'];

/** Win-% drop at/above which a move is a coachable slip / blunder, per the brief. */
const PLAYER_MISTAKE_DELTA = 8;
const OPPONENT_BLUNDER_DELTA = 12;

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireUser(locals);

	const parsed = parseRequest(await request.json().catch(() => null));
	if ('errors' in parsed) throw error(400, `Invalid request: ${parsed.errors.join('; ')}`);
	const req = parsed.value;

	const game = await getReviewGame(req.source, req.gameId);
	if (!game) throw error(404, 'unknown game');

	const stored = game.moves[req.ply - 1];
	if (!stored) throw error(400, `ply ${req.ply} is out of range for this game`);
	if (stored.fenBefore !== req.fenBefore || stored.uci !== req.playedUci) {
		throw error(400, 'fenBefore/playedUci do not match the stored move');
	}

	const side = coachedSide(game, user.activeAccount?.username);
	if (!side) throw error(400, 'active account is not a player in this game');

	await assertCanDiscuss(user.userId, { source: req.source, gameId: req.gameId, ply: req.ply });

	const analysis = await getAnalysis(req.source, req.gameId);
	const { kind, setup } = deriveMoment(game, analysis, req.ply);

	const tp: TurningPointInput = {
		ply: req.ply,
		fenBefore: req.fenBefore,
		playedUci: req.playedUci,
		kind,
		setup,
		bestLines: req.bestLines,
		replyLine: req.replyLine
	};

	let facts: TurningPointFacts;
	try {
		facts = buildTurningPointFacts(game, side, tp);
	} catch (e) {
		throw error(
			400,
			`Could not ground the coach turn: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	const first = await discuss({
		facts,
		history: req.history,
		intent: req.intent,
		playerText: req.playerText
	});
	if (!first.ok) throw error(502, `${first.error.kind}: ${first.error.message}`);

	// Grounding gate, with a single capped retry. If the reply fails the gate, ask
	// the coach to rewrite it once with the verdict's reason as a correction — then
	// return that retry as-is (no second gate, to stay well under the Vercel limit).
	const verdict = await gradeReply(first.value.message, facts, req.fenBefore, factsBlock(facts));
	let resp = first.value;
	if (!verdict.pass) {
		const retry = await discuss({
			facts,
			history: req.history,
			intent: req.intent,
			playerText: req.playerText,
			correction: verdict.reason
		});
		if (!retry.ok) throw error(502, `${retry.error.kind}: ${retry.error.message}`);
		resp = retry.value;
	}

	// `canGuide` is a route-level affordance hint, not an LLM field: a "guide me"
	// nudge makes sense whenever the moment isn't being wrapped up.
	return json({ ...resp, canGuide: !resp.wrapUp });
};

/** The coached side: which colour the active account played in this game. */
function coachedSide(game: ReviewGame, username: string | undefined): Side | null {
	if (!username) return null;
	const u = username.toLowerCase();
	if (game.white.username.toLowerCase() === u) return 'w';
	if (game.black.username.toLowerCase() === u) return 'b';
	return null;
}

/** Re-derive the moment's kind + setup from the cached analysis — never the client.
 *  The player's own slip (delta >= 8) is a 'mistake'; an opponent blunder on the
 *  prior ply (delta >= 12) makes this an 'opportunity' to punish; anything else is
 *  a quiet move the user CHOSE to ask about. */
function deriveMoment(
	game: ReviewGame,
	analysis: GameAnalysis | null,
	ply: number
): { kind: MomentKind; setup: TurningPointInput['setup'] } {
	if (!analysis) return { kind: 'chosen', setup: null };

	const own = analysis.moves.find((m) => m.ply === ply);
	if (own && own.delta >= PLAYER_MISTAKE_DELTA) return { kind: 'mistake', setup: null };

	const prior = analysis.moves.find((m) => m.ply === ply - 1);
	const priorMove = game.moves[ply - 2];
	if (prior && priorMove && prior.delta >= OPPONENT_BLUNDER_DELTA) {
		return {
			kind: 'opportunity',
			setup: { opponentBlunderSan: priorMove.san, opponentDropPct: prior.delta }
		};
	}

	return { kind: 'chosen', setup: null };
}

function parseHistory(value: unknown, errors: string[]): DiscussTurn[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		errors.push('history must be an array');
		return [];
	}
	return value.map((t, i) => {
		const v = (t ?? {}) as Record<string, unknown>;
		if (v.role !== 'coach' && v.role !== 'player') errors.push(`history[${i}].role is invalid`);
		if (typeof v.content !== 'string') errors.push(`history[${i}].content must be a string`);
		return v as unknown as DiscussTurn;
	});
}

function parseRequest(value: unknown): { value: CoachTurnRequest } | { errors: string[] } {
	const errors: string[] = [];
	const v = parseEngineRequestBase(value, errors);
	if (!v) return { errors };

	if (!INTENTS.includes(v.intent as CoachIntent)) errors.push('intent is invalid');
	if (v.playerText !== undefined && typeof v.playerText !== 'string') {
		errors.push('playerText must be a string');
	}
	parseHistory(v.history, errors);

	if (errors.length) return { errors };
	return { value: v as unknown as CoachTurnRequest };
}
