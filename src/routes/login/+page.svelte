<script lang="ts">
	import { dev } from '$app/environment';
	import { authClient } from '$lib/client/authClient';
	import { withConnect } from '$lib/review/connectIntent';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let email = $state('');
	let status = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');
	let message = $state('');

	const platformLabel = (s: string) => (s === 'lichess' ? 'Lichess' : 'Chess.com');

	// Carry the username typed on the landing page through the magic link, so the
	// account auto-links after sign-in (works cross-device — Better Auth stores
	// the callbackURL with the verification token).
	const callbackURL = $derived(withConnect('/home', data.connect));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (status === 'sending') return;
		status = 'sending';
		const { error } = await authClient.signIn.magicLink({
			email: email.trim(),
			callbackURL
		});
		if (error) {
			status = 'error';
			message = error.message ?? 'Could not send the sign-in link. Try again.';
		} else {
			status = 'sent';
		}
	}
</script>

<svelte:head><title>Sign in · Hindsight</title></svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
	<h1 class="mb-1 font-display text-2xl font-semibold tracking-tight text-text">
		Sign in to Hindsight
	</h1>
	<p class="mb-6 text-sm text-text-muted">We’ll email you a magic link — no password needed.</p>

	{#if data.connect}
		<p
			class="mb-6 rounded-lg px-3 py-2 text-sm text-text-2"
			style="background: color-mix(in srgb, var(--brand) 10%, transparent);"
		>
			We’ll connect <span class="font-medium text-text">{data.connect.username}</span> on
			{platformLabel(data.connect.source)} once you sign in.
		</p>
	{/if}

	{#if !data.authConfigured}
		<p
			class="rounded-lg px-3 py-2 text-sm text-bad"
			style="background: color-mix(in srgb, var(--bad) 12%, transparent);"
		>
			Sign-in isn’t configured. Set <code>BETTER_AUTH_SECRET</code>, <code>BETTER_AUTH_URL</code>,
			and the Mongo variables in <code>.env</code>, then restart the dev server.
		</p>
	{:else if status === 'sent'}
		<p
			class="rounded-lg px-3 py-2 text-sm text-good"
			style="background: color-mix(in srgb, var(--good) 12%, transparent);"
		>
			Check your email for a sign-in link.
			{#if dev}<br />Dev: the link is printed in the server console (<code>[magic-link]</code
				>).{/if}
		</p>
	{:else}
		<form onsubmit={submit} class="flex flex-col gap-3">
			<input
				type="email"
				name="email"
				bind:value={email}
				required
				placeholder="you@example.com"
				autocomplete="email"
				class="rounded-lg border border-border bg-surface-1 px-3 py-2 text-text focus:border-border-strong focus:outline-none"
			/>
			<button
				type="submit"
				disabled={status === 'sending'}
				class="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover disabled:opacity-60"
			>
				{status === 'sending' ? 'Sending…' : 'Send magic link'}
			</button>
			{#if status === 'error'}
				<p class="text-sm text-bad">{message}</p>
			{/if}
		</form>
	{/if}
</main>
