import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { applyMove } from '$lib/chess/rules';
import type { Side } from '$lib/chess/types';
import type { ReviewGame } from '$lib/review/types';
import type { GameAnalysis } from '$lib/review/analysis';
import { parseEngineRequestBase, UCI } from '$lib/review/explainRequest';
import { MAX_LINE_PLIES } from '$lib/server/moveRefRequest';
import { getReviewGame } from '$lib/server/reviewGames';
import { ownedSide } from '$lib/server/userMoveState';
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
 *
 * EXPLORE moments (a `line` in the body) coach a hypothetical "what if I'd played
 * this" position from the analysis board. The position isn't a stored move, so
 * instead of matching `moves[ply-1]` the server REPLAYS the UCI line from its own
 * stored position at the `ply` branch — every move must be legal, and the replay's
 * last position/move must match the client's `fenBefore`/`playedUci`. That keeps
 * the same posture (the server never trusts a client-asserted position), only the
 * anchor changes. The moment is always `kind:'explore'`: the coach judges the move
 * on its merits and never references the game's result.
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

	const side = ownedSide(game, user.reviewAccounts);
	if (!side) throw error(403, 'not your game');

	await assertCanDiscuss(user.userId, { source: req.source, gameId: req.gameId, ply: req.ply });

	let kind: MomentKind;
	let setup: TurningPointInput['setup'];
	if (req.line) {
		// Explored "what if" line — replay it from our own stored position to derive
		// + validate fenBefore/playedUci (never trust the client's FEN). The moment
		// is always 'explore': the coach judges the move, not the game.
		resolveExploreLine(game, req);
		kind = 'explore';
		setup = null;
	} else {
		const stored = game.moves[req.ply - 1];
		if (!stored) throw error(400, `ply ${req.ply} is out of range for this game`);
		if (stored.fenBefore !== req.fenBefore || stored.uci !== req.playedUci) {
			throw error(400, 'fenBefore/playedUci do not match the stored move');
		}
		const analysis = await getAnalysis(req.source, req.gameId);
		({ kind, setup } = deriveMoment(game, analysis, req.ply, side));
	}

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

/** Re-derive the moment's kind + setup from the cached analysis — never the client.
 *  Whose move this ply is comes from the stored game, not a client field: a move
 *  the OPPONENT made is an 'opponent' moment (described in the third person), even
 *  with a big swing — it is NOT the player's mistake. For the player's own move:
 *  a slip (delta >= 8) is a 'mistake'; an opponent blunder on the prior ply (delta
 *  >= 12) makes this an 'opportunity' to punish; anything else is a quiet move the
 *  player CHOSE to ask about. */
function deriveMoment(
	game: ReviewGame,
	analysis: GameAnalysis | null,
	ply: number,
	side: Side
): { kind: MomentKind; setup: TurningPointInput['setup'] } {
	const moverColor = game.moves[ply - 1]?.color;
	if (moverColor && moverColor !== side) return { kind: 'opponent', setup: null };

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

/** Replay an explored line from the stored game's position at the `ply` branch
 *  (ply 0 = the start position). Asserts every move is legal AND that the replay's
 *  final fenBefore/playedUci match what the client sent — so the engine numbers in
 *  the body describe the exact position we'll coach. Throws 400 on any mismatch;
 *  the server never trusts a client-asserted FEN. */
function resolveExploreLine(game: ReviewGame, req: CoachTurnRequest): void {
	const line = req.line!;
	if (req.ply > game.moves.length) {
		throw error(400, `ply ${req.ply} is out of range for this game`);
	}
	let fen = req.ply === 0 ? game.moves[0]!.fenBefore : game.moves[req.ply - 1]!.fenAfter;
	let fenBeforeLast = fen;
	for (let i = 0; i < line.length; i++) {
		fenBeforeLast = fen;
		try {
			fen = applyMove(fen, line[i]!).fen;
		} catch {
			throw error(400, `explored line has an illegal move at index ${i} (${line[i]})`);
		}
	}
	if (fenBeforeLast !== req.fenBefore || line[line.length - 1] !== req.playedUci) {
		throw error(400, 'fenBefore/playedUci do not match the replayed line');
	}
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
	// An explored line (`line` present) branches from the position after `ply`
	// half-moves, so ply 0 (the start) is valid; a real move points at a move.
	const hasLine = !!value && typeof value === 'object' && 'line' in value;
	const v = parseEngineRequestBase(value, errors, { minPly: hasLine ? 0 : 1 });
	if (!v) return { errors };

	if (!INTENTS.includes(v.intent as CoachIntent)) errors.push('intent is invalid');
	if (v.playerText !== undefined && typeof v.playerText !== 'string') {
		errors.push('playerText must be a string');
	}
	if (v.line !== undefined) {
		if (!Array.isArray(v.line) || v.line.length === 0) {
			errors.push('line, if given, must be a non-empty array');
		} else if (v.line.length > MAX_LINE_PLIES) {
			errors.push(`line must have at most ${MAX_LINE_PLIES} moves`);
		} else if (!v.line.every((m) => typeof m === 'string' && UCI.test(m))) {
			errors.push('line must be an array of UCI moves');
		}
	}
	parseHistory(v.history, errors);

	if (errors.length) return { errors };
	return { value: v as unknown as CoachTurnRequest };
}
