<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	// The one piece of always-on chrome: a quiet wordmark that gets you home from
	// anywhere. Fixed/overlay so it costs zero layout height — pages keep their
	// full viewport and nothing new scrolls. Suppressed on the sign-in screen.
	const showChrome = $derived(page.url.pathname !== '/login');
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if showChrome}
	<a
		href="/"
		class="fixed top-3 left-4 z-50 rounded-md bg-surface-1/70 px-2.5 py-1 text-sm font-semibold tracking-wide text-text-2 backdrop-blur-sm transition-colors hover:text-text"
		style="top: max(0.75rem, env(safe-area-inset-top)); left: max(1rem, env(safe-area-inset-left));"
	>
		Hindsight
	</a>
{/if}

{@render children()}
