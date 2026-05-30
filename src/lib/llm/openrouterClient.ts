/**
 * Low-level OpenRouter chat-completions client. One place for HTTP details
 * (auth, timeout, error shape) so the live coach (`openrouter.ts`) and the
 * import-time position writer (`positionWriter.ts`) share infrastructure.
 *
 * Returns the trimmed assistant content; parsing is the caller's job.
 *
 * Vercel functions have a 10s budget — `timeoutMs` defaults to 7000 so we fail
 * fast and surface a usable error instead of letting the platform kill the
 * route mid-response.
 */

export type ChatMessage = { role: 'system' | 'user'; content: string };

export type ChatCompletionInput = {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	/** OpenRouter `X-Title` analytics tag. Required so callers stay distinguishable. */
	title: string;
	/** OpenRouter `HTTP-Referer` analytics tag. */
	referer?: string;
	/** Abort the fetch after this many ms. Default 7000 (Vercel 10s budget). */
	timeoutMs?: number;
	/** Sampling temperature. Omit for the model's default. Lower = more
	 *  deterministic / less drift — set this for callers that want fact-pinned
	 *  output (e.g. opening reflection). */
	temperature?: number;
	/** Hard cap on output tokens. Omit for unbounded. Set for callers with a
	 *  word-count contract in the prompt — the prompt asks the model nicely;
	 *  this enforces it. */
	maxTokens?: number;
	/** OpenRouter unified reasoning control. Set `{ enabled: false }` for
	 *  grounded mechanical tasks where chain-of-thought adds latency and, on
	 *  thinking models, can bleed a verification trace into the answer. Omit to
	 *  use the model's default. */
	reasoning?: { enabled?: boolean; exclude?: boolean; effort?: 'low' | 'medium' | 'high' };
	/** Test seam — inject a fake fetch. */
	fetchFn?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_REFERER = 'https://github.com/eheimpel/my-chess';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function chatCompletion(input: ChatCompletionInput): Promise<string> {
	const fetchFn = input.fetchFn ?? fetch;
	const controller = new AbortController();
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let res: Response;
	try {
		res = await fetchFn(ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${input.apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': input.referer ?? DEFAULT_REFERER,
				'X-Title': input.title
			},
			body: JSON.stringify({
				model: input.model,
				messages: input.messages,
				...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
				...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
				...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {})
			}),
			signal: controller.signal
		});
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error(`OpenRouter timed out after ${timeoutMs}ms`, { cause: e });
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok) {
		const body = await res.text().catch(() => '<unreadable>');
		throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
	}

	const json = (await res.json()) as ChatCompletionResponse;
	const content = json.choices?.[0]?.message?.content?.trim();
	if (!content) {
		throw new Error(
			`OpenRouter response missing message content: ${JSON.stringify(json).slice(0, 500)}`
		);
	}
	return content;
}

type ChatCompletionResponse = {
	choices?: Array<{ message?: { content?: string } }>;
};
