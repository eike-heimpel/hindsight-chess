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

/**
 * Returns true iff we should use the real OpenRouter coach. False → tests / dev
 * without keys / explicit `USE_STUB_COACH=1`.
 */
export function useRealCoach(): boolean {
	if (env.USE_STUB_COACH === '1') return false;
	return !!env.OPENROUTER_API_KEY;
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
