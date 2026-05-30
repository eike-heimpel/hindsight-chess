<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page, navigating } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { authClient } from '$lib/client/authClient';

	let { children } = $props();

	// The one piece of always-on chrome: a quiet wordmark that gets you home from
	// anywhere, doubling as the app's nav. Fixed/overlay so it costs zero layout
	// height — pages keep their full viewport and nothing new scrolls. Suppressed
	// on the sign-in screen.
	const showChrome = $derived(page.url.pathname !== '/login');

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

<!-- Navigation feedback. Server loads gate page swaps on a round-trip, so a
     click can sit for a second with no visible change; this bar says "heard
     you, working on it" the instant you click. -->
{#if navigating.to}
	<div class="nav-progress" aria-hidden="true"></div>
{/if}

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
		class="fixed top-3 left-4 z-50 flex flex-col items-start gap-1.5"
		style="top: max(0.75rem, env(safe-area-inset-top)); left: max(1rem, env(safe-area-inset-left));"
	>
		{#if navOpen}
			<!-- Home sits where the trigger was, so clicking again lands here. -->
			<a
				href="/"
				class="rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-semibold tracking-wide text-text-2 backdrop-blur-sm transition-colors hover:text-text"
			>
				Home
			</a>
			<a
				href="/review/stats"
				class="rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-medium text-text-2 backdrop-blur-sm transition-colors hover:text-text"
			>
				Stats
			</a>
			<a
				href="/review"
				class="rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-medium text-text-2 backdrop-blur-sm transition-colors hover:text-text"
			>
				Account
			</a>
			<button
				type="button"
				onclick={logout}
				class="rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-medium text-text-muted backdrop-blur-sm transition-colors hover:text-text"
			>
				Log out
			</button>
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

<style>
	/* Indeterminate top bar — we don't know how long the load takes, so it
	   animates rather than fills to a percentage. Above all chrome (nav is z-50). */
	.nav-progress {
		position: fixed;
		inset: 0 0 auto 0;
		height: 2px;
		z-index: 100;
		overflow: hidden;
		background: color-mix(in srgb, var(--brand) 22%, transparent);
	}
	.nav-progress::before {
		content: '';
		position: absolute;
		inset: 0;
		width: 40%;
		background: var(--brand);
		animation: nav-progress-slide 1.1s ease-in-out infinite;
	}
	@keyframes nav-progress-slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.nav-progress::before {
			animation-duration: 2.2s;
		}
	}
</style>
