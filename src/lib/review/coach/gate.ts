/**
 * Grounding gate: a cheap pass/no-pass check that stops the main coach LLM from
 * BSing — stating a piece, square, move, or who's-winning claim the FACTS don't
 * support. Two layers, run cheapest-first:
 *
 *  1. deterministicGate — CONSERVATIVE, low false-positive. Flags only a clearly
 *     move-shaped SAN token that is neither referenced in any known line NOR
 *     legal from the position. Defers everything else to the LLM (returns null).
 *  2. llmGate — a tiny, strict, FAIL-OPEN model check for factual contradictions.
 *
 * Boundary code: llmGate returns a Result; on any error it fails OPEN (pass:true)
 * so the gate never blocks the feature on its own failure.
 */
import { Chess } from 'chess.js';
import { chatCompletion } from '$lib/llm/openrouterClient';
import { getCoachGateModel, getOpenRouterApiKey } from '$lib/server/env';
import { ok, err, type Result } from '$lib/result';
import type { TurningPointFacts } from './types';

export type GateVerdict = { pass: boolean; reason: string };

/** Move-shaped SAN: castling, a piece move (incl. capture/check/promotion), or a
 *  pawn CAPTURE (exd5). Bare pawn pushes (e4) and file/square words are NOT
 *  matched — too ambiguous to flag without false positives. */
const SAN_TOKEN =
	/\b(O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;

/** Strip decorations so "Nf3+" and "Nf3" compare equal. */
function bareSan(san: string): string {
	return san.replace(/[+#]/g, '');
}

/** Every SAN token the FACTS reference — the known-good set the message may cite. */
function knownSanTokens(facts: TurningPointFacts): Set<string> {
	const tokens = new Set<string>();
	const add = (s: string | null | undefined) => {
		if (!s) return;
		for (const m of s.match(SAN_TOKEN) ?? []) tokens.add(bareSan(m));
	};
	add(facts.playedSan);
	add(facts.bestSan);
	add(facts.bestLineSan);
	for (const alt of facts.altLinesSan) add(alt);
	add(facts.punishLineSan);
	if (facts.setup) add(facts.setup.opponentBlunderSan);
	return tokens;
}

/** Legal SAN moves from the position, decorations stripped. */
function legalSanSet(fenBefore: string): Set<string> {
	try {
		const moves = new Chess(fenBefore).moves();
		return new Set(moves.map(bareSan));
	} catch {
		return new Set();
	}
}

export function deterministicGate(
	message: string,
	facts: TurningPointFacts,
	fenBefore: string
): GateVerdict | null {
	const known = knownSanTokens(facts);
	const legal = legalSanSet(fenBefore);

	for (const raw of message.match(SAN_TOKEN) ?? []) {
		const san = bareSan(raw);
		if (known.has(san) || legal.has(san)) continue;
		return {
			pass: false,
			reason: `mentions move "${raw}" not in any line and not legal here`
		};
	}
	return null;
}

const GATE_RUBRIC = `You are a strict fact-checker for a chess coach's message. Check ONLY whether the coach message states something that CONTRADICTS or is NOT SUPPORTED by the FACTS — specifically: piece names/colors, square names, which move was played vs best, who is winning/losing, whether a capture/check/mate happened. Output a single JSON object {"pass": boolean, "reason": string}. Default pass:true. Do NOT flag tone, style, teaching choices, omissions, or anything that is not a factual contradiction.`;

/** Pull the first JSON object out of a model reply (tolerates ``` fences / prose). */
function extractJson(raw: string): unknown {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1] : raw;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in reply');
	return JSON.parse(body.slice(start, end + 1));
}

function coerceVerdict(value: unknown): GateVerdict {
	if (!value || typeof value !== 'object') throw new Error('verdict is not an object');
	const v = value as Record<string, unknown>;
	const pass = typeof v.pass === 'boolean' ? v.pass : true;
	const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
	return { pass, reason };
}

export async function llmGate(message: string, factsBlock: string): Promise<Result<GateVerdict>> {
	let raw: string;
	try {
		raw = await chatCompletion({
			apiKey: getOpenRouterApiKey(),
			model: getCoachGateModel(),
			title: 'hindsight-coach-gate',
			temperature: 0,
			maxTokens: 200,
			reasoning: { enabled: false },
			timeoutMs: 4000,
			messages: [
				{ role: 'system', content: GATE_RUBRIC },
				{
					role: 'user',
					content: `FACTS\n${factsBlock}\n\nCOACH MESSAGE\n${message}\n\nReply with the JSON verdict now.`
				}
			]
		});
	} catch {
		// Fail OPEN: the gate must never block the feature on its own error.
		return ok({ pass: true, reason: '' });
	}

	try {
		return ok(coerceVerdict(extractJson(raw)));
	} catch (e) {
		return err('coach_invalid_response', e instanceof Error ? e.message : String(e));
	}
}

/**
 * Grade a coach message against the FACTS. Run the deterministic gate first; if
 * it returns a hard fail, use it and skip the LLM call. Otherwise defer to the
 * (fail-open) LLM gate. Never throws — an LLM error inside llmGate fails open.
 */
export async function gradeReply(
	message: string,
	facts: TurningPointFacts,
	fenBefore: string,
	factsBlock: string
): Promise<GateVerdict> {
	const deterministic = deterministicGate(message, facts, fenBefore);
	if (deterministic && !deterministic.pass) return deterministic;

	const llm = await llmGate(message, factsBlock);
	// A parse error from the gate is its own failure → fail open.
	return llm.ok ? llm.value : { pass: true, reason: '' };
}
