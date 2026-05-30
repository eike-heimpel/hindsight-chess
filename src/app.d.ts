// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthUser, AuthSession } from '$lib/server/betterAuth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthUser | null;
			session: AuthSession | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
