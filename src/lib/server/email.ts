import { dev } from '$app/environment';

/**
 * Outbound email seam. No transport is wired yet: in dev we log the magic-link
 * URL to the server console (copy it into the browser to sign in); in
 * production we fail fast — there is no way to deliver the link, and silently
 * dropping it would hide a broken login. Wire a real provider (Resend/SMTP)
 * here when going public.
 */
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
	if (dev) {
		console.info(`[magic-link] ${email} -> ${url}`);
		return;
	}
	throw new Error(
		'No email transport configured: cannot deliver the magic link. Wire a provider in src/lib/server/email.ts.'
	);
}
