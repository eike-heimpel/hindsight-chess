import { dev } from '$app/environment';
import { getEmailFrom, getPostmarkApiToken, getPostmarkMessageStream, useEmail } from './env.ts';

/**
 * Outbound email seam. Sends via Postmark's REST API when configured
 * (`POSTMARK_API_TOKEN` + a verified `EMAIL_FROM`). When not configured we log
 * the magic-link URL to the console in dev (copy it into the browser to sign
 * in) and fail fast in production — silently dropping a login link would hide a
 * broken flow.
 */
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
	if (!useEmail()) {
		if (dev) {
			console.info(`[magic-link] ${email} -> ${url}`);
			return;
		}
		throw new Error(
			'Email transport not configured: set POSTMARK_API_TOKEN and EMAIL_FROM to deliver magic links.'
		);
	}

	const res = await fetch('https://api.postmarkapp.com/email', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-Postmark-Server-Token': getPostmarkApiToken()
		},
		body: JSON.stringify({
			From: getEmailFrom(),
			To: email,
			Subject: 'Your Hindsight sign-in link',
			TextBody: `Sign in to Hindsight:\n\n${url}\n\nThis link expires shortly. If you didn't request it, you can ignore this email.`,
			MessageStream: getPostmarkMessageStream()
		})
	});

	if (!res.ok) {
		throw new Error(`Postmark send failed (${res.status}): ${await res.text()}`);
	}
}
