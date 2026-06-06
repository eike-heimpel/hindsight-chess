/**
 * Server-side coach call: prompt → LLM → validated DiscussResponse. Boundary
 * code, so it returns a Result rather than throwing. The route adds `canGuide`
 * to form the CoachTurnResponse.
 */
import { chatCompletion } from '$lib/llm/openrouterClient';
import { getCoachSpikeModel, getOpenRouterApiKey } from '$lib/server/env';
import { ok, err, type Result } from '$lib/result';
import { buildDiscussPrompt } from './prompt';
import { extractJson } from './extractJson';
import type { DiscussRequest, DiscussResponse, Learning } from './types';

const LEVELS = new Set(['tactical', 'principle', 'process']);
const SHOWS = new Set(['best', 'punish', 'none']);

function coerce(value: unknown): DiscussResponse {
	if (!value || typeof value !== 'object') throw new Error('reply is not an object');
	const v = value as Record<string, unknown>;

	const message = typeof v.message === 'string' ? v.message.trim() : '';
	if (!message) throw new Error('missing message');

	const show =
		typeof v.show === 'string' && SHOWS.has(v.show) ? (v.show as DiscussResponse['show']) : 'none';

	const learnings: Learning[] = Array.isArray(v.learnings)
		? v.learnings
				.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
				.filter(
					(l) => typeof l.level === 'string' && LEVELS.has(l.level) && typeof l.point === 'string'
				)
				.map((l) => ({ level: l.level as Learning['level'], point: (l.point as string).trim() }))
		: [];

	const choices: string[] = Array.isArray(v.choices)
		? v.choices
				.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
				.map((c) => c.trim())
		: [];

	// `wrapUp` is the contract field; accept the legacy `done` as an alias. Default
	// advisory-false: a turn only wraps when the model EXPLICITLY says so. (We used
	// to auto-wrap on "no choices returned", which made one terse reply read as the
	// end of the conversation — the opposite of a continuable thread.)
	const rawWrap = typeof v.wrapUp === 'boolean' ? v.wrapUp : v.done;
	const wrapUp = typeof rawWrap === 'boolean' ? rawWrap : false;

	return { message, show, learnings, choices, wrapUp };
}

export async function discuss(req: DiscussRequest): Promise<Result<DiscussResponse>> {
	const { system, user } = buildDiscussPrompt(req);
	let raw: string;
	try {
		raw = await chatCompletion({
			apiKey: getOpenRouterApiKey(),
			model: getCoachSpikeModel(),
			title: 'hindsight-coach',
			temperature: 0.4,
			// Gemini Flash mandates reasoning. Cap effort low and leave token
			// headroom so the chain-of-thought doesn't truncate the JSON. Timeout
			// stays under Vercel's 10s budget — worst case is main + gate + retry.
			maxTokens: 3000,
			reasoning: { effort: 'low' },
			timeoutMs: 9000,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			]
		});
	} catch (e) {
		return err('coach_http', e instanceof Error ? e.message : String(e));
	}

	try {
		return ok(coerce(extractJson(raw)));
	} catch (e) {
		return err(
			'coach_invalid_response',
			`${e instanceof Error ? e.message : String(e)} — raw: ${raw.slice(0, 300)}`
		);
	}
}
