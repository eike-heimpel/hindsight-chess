import { describe, it, expect, vi } from 'vitest';
import { OpenRouterHeadlineWriter } from './openrouterHeadline.ts';
import type { HeadlineFacts } from './headlineFacts.ts';

function fakeFetch(content: string): typeof fetch {
	return vi.fn(
		async () =>
			new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
	) as unknown as typeof fetch;
}

const facts: HeadlineFacts = {
	outcome: 'loss',
	opponent: 'rival',
	opening: null,
	accuracy: 71,
	side: 'w',
	trajectory: [
		{ moveNumber: 0, winPct: 50 },
		{ moveNumber: 10, winPct: 85 },
		{ moveNumber: 20, winPct: 20 }
	],
	swings: [{ moveNumber: 20, from: 85, to: 20 }],
	biggestMistake: { moveNumber: 18, san: 'Qd2', classification: 'blunder', drop: 40 }
};

describe('OpenRouterHeadlineWriter', () => {
	it('returns the model text and sends the headline sampling contract', async () => {
		const fetchFn = fakeFetch('You were cruising, then it slipped on move 20');
		const text = await new OpenRouterHeadlineWriter({
			apiKey: 'k',
			model: 'google/gemini-2.5-flash-lite',
			fetchFn
		}).write(facts);

		expect(text).toBe('You were cruising, then it slipped on move 20');
		const init = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock
			.calls[0][1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe('google/gemini-2.5-flash-lite');
		expect(body.temperature).toBe(0.6);
		expect(body.max_tokens).toBe(64);
		expect(body.reasoning).toEqual({ enabled: false });
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe('system');
	});

	it('requires apiKey and model', () => {
		expect(() => new OpenRouterHeadlineWriter({ apiKey: '', model: 'm' })).toThrow(/apiKey/);
		expect(() => new OpenRouterHeadlineWriter({ apiKey: 'k', model: '' })).toThrow(/model/);
	});
});
