import { env } from '$env/dynamic/private';

/**
 * Centralized server-side env access. Single source of truth, single error
 * site. If you add a new env var, add a typed getter here — don't pluck from
 * `process.env` ad-hoc in routes.
 */

export function getOpenRouterApiKey(): string {
	const key = env.OPENROUTER_API_KEY;
	if (!key) {
		throw new Error('OPENROUTER_API_KEY is not set. Add it to .env (the user manages this file).');
	}
	return key;
}

export function getOpenRouterModel(): string {
	return env.OPENROUTER_MODEL || '~google/gemini-flash-latest';
}

/** Model for the home card's "story" headline — a small, cheap, fast model is
 *  enough for one grounded sentence. Plain id (no `~` auto-router prefix). */
export function getOpenRouterHeadlineModel(): string {
	return env.OPENROUTER_HEADLINE_MODEL || 'google/gemini-2.5-flash-lite';
}

/** Model for the coach discussion (POST /api/review/coach/discuss, surfaced on the
 *  review page). The discussion needs more reasoning headroom than a one-liner —
 *  Gemini Flash 3.5. Override with `COACH_SPIKE_MODEL`. */
export function getCoachSpikeModel(): string {
	return env.COACH_SPIKE_MODEL || 'google/gemini-3.5-flash';
}

/** Model for the coach's grounding gate — a cheap, fast pass/no-pass check that
 *  the coach reply doesn't contradict the FACTS (piece/square names, hallucinated
 *  moves, who's winning). Cheapest flash-lite tier is enough. Override with
 *  `COACH_GATE_MODEL`. */
export function getCoachGateModel(): string {
	return env.COACH_GATE_MODEL || 'google/gemini-2.5-flash-lite';
}

/**
 * Returns true iff we should use the real OpenRouter coach. False → tests / dev
 * without keys / explicit `USE_STUB_COACH=1`.
 */
export function useRealCoach(): boolean {
	if (env.USE_STUB_COACH === '1') return false;
	return !!env.OPENROUTER_API_KEY;
}

/** Optional lichess API token. lichess game-export works anonymously; a token
 *  only raises rate limits. Empty string when unset (anonymous). */
export function getLichessToken(): string {
	return env.LICHESS_TOKEN || '';
}

export function getMongoUri(): string {
	const uri = env.MONGODB_URI;
	if (!uri) {
		throw new Error('MONGODB_URI is not set. Add it to .env (the user manages this file).');
	}
	return uri;
}

export function getMongoDbName(): string {
	const name = env.MONGODB_DB_NAME;
	if (!name) {
		throw new Error('MONGODB_DB_NAME is not set. Add it to .env (the user manages this file).');
	}
	return name;
}

/**
 * Whether Mongo-backed features (picker, history, cache) are configured.
 * Routes that touch Mongo should no-op cleanly when this is false so that
 * `npm run dev` and unit tests work without a live database.
 */
export function useMongo(): boolean {
	return !!env.MONGODB_URI && !!env.MONGODB_DB_NAME;
}

export function getBetterAuthSecret(): string {
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error('BETTER_AUTH_SECRET is not set. Add it to .env (the user manages this file).');
	}
	return secret;
}

export function getBetterAuthUrl(): string {
	const url = env.BETTER_AUTH_URL;
	if (!url) {
		throw new Error('BETTER_AUTH_URL is not set. Add it to .env (the user manages this file).');
	}
	return url;
}

/**
 * Whether Better Auth is configured. Requires Mongo (its store) plus a secret
 * and base URL. When false the auth seam resolves no user and `hooks.server.ts`
 * skips wiring the handler — so dev/tests run without auth configured.
 */
export function useBetterAuth(): boolean {
	return useMongo() && !!env.BETTER_AUTH_SECRET && !!env.BETTER_AUTH_URL;
}

export function getPostmarkApiToken(): string {
	const token = env.POSTMARK_API_TOKEN;
	if (!token) {
		throw new Error('POSTMARK_API_TOKEN is not set. Add it to .env (the user manages this file).');
	}
	return token;
}

export function getEmailFrom(): string {
	const from = env.EMAIL_FROM;
	if (!from) {
		throw new Error('EMAIL_FROM is not set. Add it to .env (the user manages this file).');
	}
	return from;
}

/** Postmark message stream to send on. Defaults to the built-in transactional
 *  `outbound` stream; set `POSTMARK_MESSAGE_STREAM` to use a custom stream. */
export function getPostmarkMessageStream(): string {
	return env.POSTMARK_MESSAGE_STREAM || 'outbound';
}

/** Whether outbound email can be sent (Postmark token + a verified From). When
 *  false, the email seam logs in dev and fails fast in production. */
export function useEmail(): boolean {
	return !!env.POSTMARK_API_TOKEN && !!env.EMAIL_FROM;
}
