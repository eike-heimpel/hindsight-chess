import { describe, it, expect, vi } from 'vitest';
import { chatCompletion } from './openrouterClient.ts';

function ok(content: string): typeof fetch {
	return vi.fn(
		async () =>
			new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
	) as unknown as typeof fetch;
}

describe('chatCompletion', () => {
	it('sends Bearer auth, model, messages, and the caller-supplied X-Title', async () => {
		const fetchFn = ok('hi');
		await chatCompletion({
			apiKey: 'sk-test',
			model: 'foo/bar',
			messages: [{ role: 'user', content: 'ping' }],
			title: 'unit-test',
			fetchFn
		});
		const call = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
		const url = call[0] as string;
		const init = call[1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(headers.Authorization).toBe('Bearer sk-test');
		expect(headers['X-Title']).toBe('unit-test');
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe('foo/bar');
		expect(body.messages).toEqual([{ role: 'user', content: 'ping' }]);
	});

	it('trims whitespace from the returned content', async () => {
		const out = await chatCompletion({
			apiKey: 'k',
			model: 'm',
			messages: [{ role: 'user', content: 'x' }],
			title: 't',
			fetchFn: ok('   hello   ')
		});
		expect(out).toBe('hello');
	});

	it('throws with status code on non-2xx', async () => {
		const fetchFn = vi.fn(
			async () => new Response('rate limited', { status: 429 })
		) as unknown as typeof fetch;
		await expect(
			chatCompletion({
				apiKey: 'k',
				model: 'm',
				messages: [{ role: 'user', content: 'x' }],
				title: 't',
				fetchFn
			})
		).rejects.toThrow(/429/);
	});

	it('throws if response has no message content', async () => {
		const fetchFn = vi.fn(
			async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })
		) as unknown as typeof fetch;
		await expect(
			chatCompletion({
				apiKey: 'k',
				model: 'm',
				messages: [{ role: 'user', content: 'x' }],
				title: 't',
				fetchFn
			})
		).rejects.toThrow(/missing message content/);
	});

	it('aborts and surfaces a timeout error when the fetch exceeds timeoutMs', async () => {
		const fetchFn = ((_url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (signal) {
					signal.addEventListener('abort', () => {
						const err = new Error('aborted');
						err.name = 'AbortError';
						reject(err);
					});
				}
			})) as unknown as typeof fetch;

		await expect(
			chatCompletion({
				apiKey: 'k',
				model: 'm',
				messages: [{ role: 'user', content: 'x' }],
				title: 't',
				timeoutMs: 10,
				fetchFn
			})
		).rejects.toThrow(/timed out after 10ms/);
	});
});
