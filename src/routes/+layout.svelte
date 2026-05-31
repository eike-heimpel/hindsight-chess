<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static internal nav links; resolve() adds noise without value here (same
	 * posture as the other route files). */
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { authClient } from '$lib/client/authClient';

	let { children } = $props();

	// The one piece of always-on chrome: a quiet wordmark that gets you home from
	// anywhere, doubling as the app's nav. Fixed/overlay so it costs zero layout
	// height — pages keep their full viewport and nothing new scrolls. Suppressed
	// on the sign-in screen and the public landing (which carries its own
	// wordmark; a logged-out stranger has no app nav to show).
	const showChrome = $derived(page.url.pathname !== '/login' && page.url.pathname !== '/');

	// Click the wordmark to open the nav; click it again and you've landed on
	// Home — because Home occupies the exact spot the trigger did, a double-click
	// gets you home without aiming. Stats/Account fan out below.
	let navOpen = $state(false);

	afterNavigate(() => {
		navOpen = false;
	});

	async function logout() {
		navOpen = false;
		await authClient.signOut();
		await goto('/login');
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') navOpen = false;
	}}
/>

{#if showChrome}
	<!-- Backdrop: a click anywhere outside the open menu closes it. -->
	{#if navOpen}
		<button
			type="button"
			aria-label="Close menu"
			class="fixed inset-0 z-40 cursor-default"
			onclick={() => (navOpen = false)}
		></button>
	{/if}

	<nav
		class="fixed top-3 left-4 z-50"
		style="top: max(0.75rem, env(safe-area-inset-top)); left: max(1rem, env(safe-area-inset-left));"
	>
		{#if navOpen}
			<!-- A solid, readable panel. Home is the first row so it sits where the
			     trigger was — click the wordmark twice and you land on it. -->
			<div
				class="min-w-44 overflow-hidden rounded-lg border border-border bg-surface-2 p-1 shadow-xl shadow-black/40"
			>
				<a
					href="/home"
					class="block rounded-md px-3 py-1.5 text-sm font-semibold text-text transition-colors hover:bg-surface-3"
				>
					Home
				</a>
				<a
					href="/review/stats"
					class="block rounded-md px-3 py-1.5 text-sm font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
				>
					Stats
				</a>
				<a
					href="/review"
					class="block rounded-md px-3 py-1.5 text-sm font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
				>
					Account
				</a>
				<div class="my-1 border-t border-border"></div>
				<button
					type="button"
					onclick={logout}
					class="block w-full rounded-md px-3 py-1.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
				>
					Log out
				</button>
			</div>
		{:else}
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={navOpen}
				onclick={() => (navOpen = true)}
				class="rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-semibold tracking-wide text-text-2 backdrop-blur-sm transition-colors hover:text-text"
			>
				Hindsight
			</button>
		{/if}
	</nav>
{/if}

{@render children()}
