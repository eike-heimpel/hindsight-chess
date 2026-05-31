<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static internal nav links; resolve() adds noise without value here (same
	 * posture as the other route files). */
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { authClient } from '$lib/client/authClient';
	import { fade, fly } from 'svelte/transition';

	let { children } = $props();

	// The one piece of always-on chrome: a quiet wordmark that gets you home from
	// anywhere, doubling as the app's nav. Fixed/overlay so it costs zero layout
	// height — pages keep their full viewport and nothing new scrolls. Suppressed
	// on the sign-in screen and the public landing (which carries its own
	// wordmark; a logged-out stranger has no app nav to show).
	const showChrome = $derived(page.url.pathname !== '/login' && page.url.pathname !== '/');

	// Tap the wordmark to open the nav. On desktop the panel drops where the
	// trigger sat, so Home (first row) lands under the cursor — tap twice and
	// you're home without aiming. On mobile it rises as a thumb-reachable sheet,
	// since the top-left corner is the worst place to ask a thumb to land.
	let navOpen = $state(false);

	const navItems = [
		{ href: '/home', label: 'Home', primary: true },
		{ href: '/review', label: 'Your games' },
		{ href: '/review/stats', label: 'Stats' },
		{ href: '/account', label: 'Account' }
	];

	// Mark the row for wherever you currently are, so the menu doubles as a
	// "you are here." Stats lives under /review, so it has to claim that prefix
	// before "Your games" does.
	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/review') return path.startsWith('/review') && !path.startsWith('/review/stats');
		return path === href || path.startsWith(href + '/');
	}

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
	<nav
		class="fixed top-3 left-4 z-50"
		style="top: max(0.75rem, env(safe-area-inset-top)); left: max(1rem, env(safe-area-inset-left));"
	>
		{#if !navOpen}
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={navOpen}
				onclick={() => (navOpen = true)}
				transition:fade={{ duration: 100 }}
				class="flex items-center gap-1.5 rounded-md bg-surface-1/70 px-2.5 py-1.5 font-display text-base font-medium tracking-tight text-text-2 backdrop-blur-sm transition-colors hover:text-text active:bg-surface-2"
			>
				<span>Hindsight<span class="text-brand">.</span></span>
				<svg viewBox="0 0 16 16" fill="none" class="size-3 text-text-muted" aria-hidden="true">
					<path
						d="M4 6l4 4 4-4"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		{/if}
	</nav>

	{#if navOpen}
		<!-- Dim + click-to-close. The scrim is solid on mobile (the sheet is modal);
		     on desktop the dropdown is small, so the scrim stays invisible. -->
		<button
			type="button"
			aria-label="Close menu"
			onclick={() => (navOpen = false)}
			transition:fade={{ duration: 150 }}
			class="fixed inset-0 z-40 cursor-default bg-black/50 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
		></button>

		<!-- Mobile: a bottom sheet with thumb-sized rows. Desktop (sm+): the compact
		     dropdown anchored where the wordmark was, so tap-twice-to-Home survives. -->
		<div
			transition:fly={{ y: 16, duration: 200 }}
			class="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface-2 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl shadow-black/40 sm:inset-x-auto sm:top-3 sm:bottom-auto sm:left-4 sm:w-48 sm:rounded-lg sm:border sm:p-1 sm:pb-1"
		>
			<div
				class="mx-auto mb-2 h-1 w-9 rounded-full bg-text-muted/40 sm:hidden"
				aria-hidden="true"
			></div>

			{#each navItems as item (item.href)}
				<a
					href={item.href}
					aria-current={isActive(item.href) ? 'page' : undefined}
					class="flex min-h-12 items-center rounded-lg px-4 text-base transition-colors sm:min-h-0 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm {isActive(
						item.href
					)
						? 'bg-surface-3 font-semibold text-text'
						: item.primary
							? 'font-semibold text-text hover:bg-surface-3'
							: 'font-medium text-text-2 hover:bg-surface-3 hover:text-text'}"
				>
					{item.label}
				</a>
			{/each}

			<div class="my-1 border-t border-border"></div>

			<button
				type="button"
				onclick={logout}
				class="flex min-h-12 w-full items-center rounded-lg px-4 text-left text-base font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text sm:min-h-0 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm"
			>
				Log out
			</button>
		</div>
	{/if}
{/if}

{@render children()}
