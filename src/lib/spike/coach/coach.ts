/**
 * Server-side coach call for the spike: prompt → Gemini Flash → validated
 * DiscussResponse. Boundary code, so it returns a Result rather than throwing.
 */
import { chatCompletion } from '$lib/llm/openrouterClient';
import { getCoachSpikeModel, getOpenRouterApiKey } from '$lib/server/env';
import { ok, err, type Result } from '$lib/result';
import { buildDiscussPrompt } from './prompt';
import type { DiscussRequest, DiscussResponse, Learning } from './types';

const LEVELS = new Set(['tactical', 'principle', 'process']);
const SHOWS = new Set(['best', 'punish', 'none']);

/** Pull the first JSON object out of a model reply (tolerates ``` fences / prose). */
function extractJson(raw: string): unknown {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fenced ? fenced[1] : raw;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in reply');
	return JSON.parse(body.slice(start, end + 1));
}

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

	const done = typeof v.done === 'boolean' ? v.done : choices.length === 0;

	return { message, show, learnings, choices, done };
}

export async function discuss(req: DiscussRequest): Promise<Result<DiscussResponse>> {
	const { system, user } = buildDiscussPrompt(req);
	let raw: string;
	try {
		raw = await chatCompletion({
			apiKey: getOpenRouterApiKey(),
			model: getCoachSpikeModel(),
			title: 'hindsight-coach-spike',
			temperature: 0.4,
			// Gemini Flash 3.5 mandates reasoning. Cap effort low and leave plenty
			// of token headroom so the chain-of-thought doesn't truncate the JSON.
			// Longer timeout than the default: this spike route isn't on the 10s
			// Vercel path yet.
			maxTokens: 3000,
			reasoning: { effort: 'low' },
			timeoutMs: 25000,
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
