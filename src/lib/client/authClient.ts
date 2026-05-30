import { createAuthClient } from 'better-auth/svelte';
import { magicLinkClient } from 'better-auth/client/plugins';

/**
 * Browser auth client. `baseURL` is inferred from the current origin. Exposes
 * `authClient.signIn.magicLink({ email })`, `signOut()`, `useSession()`, etc.
 * UI lives elsewhere — this is just the wiring.
 */
export const authClient = createAuthClient({
	plugins: [magicLinkClient()]
});
