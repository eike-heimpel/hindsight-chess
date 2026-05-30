// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthUser, AuthSession } from '$lib/server/betterAuth';
import type { User } from '$lib/server/auth';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthUser | null;
			session: AuthSession | null;
			/** Per-request memo of the resolved app `User` (see server/auth
			 *  `getUser`) so the layout + page loaders share one Mongo lookup. */
			userPromise?: Promise<User | null>;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
