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

	// The one piece of always-on chrome: a quiet "H" monogram pinned to the
	// bottom-center, in easy thumb reach from either hand. Fixed/overlay so it
	// costs zero layout height — pages keep their full viewport and nothing new
	// scrolls. Tapping it raises the nav, which rises out of the monogram so the
	// gesture teaches itself. Suppressed on the sign-in screen and the public
	// landing (which carries its own wordmark; a logged-out stranger has no app
	// nav to show).
	const showChrome = $derived(page.url.pathname !== '/login' && page.url.pathname !== '/');

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
	<!-- The monogram: bottom-center, thumb-reachable from either hand. Hidden
	     while the menu is open, since the panel rises into its place. -->
	{#if !navOpen}
		<nav
			class="fixed bottom-0 left-1/2 z-50 -translate-x-1/2"
			style="bottom: max(1rem, env(safe-area-inset-bottom));"
		>
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={navOpen}
				aria-label="Open menu"
				onclick={() => (navOpen = true)}
				transition:fade={{ duration: 120 }}
				class="flex size-11 items-center justify-center rounded-full border border-border bg-surface-1/80 text-base font-bold tracking-tight text-text-2 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:text-text active:bg-surface-2"
			>
				H
			</button>
		</nav>
	{/if}

	{#if navOpen}
		<!-- Dim + click-to-close. The menu is modal, so the scrim is visible
		     everywhere. -->
		<button
			type="button"
			aria-label="Close menu"
			onclick={() => (navOpen = false)}
			transition:fade={{ duration: 150 }}
			class="fixed inset-0 z-40 cursor-default bg-black/50 backdrop-blur-sm"
		></button>

		<!-- The nav rises out of the monogram's spot: full-width sheet on mobile, a
		     centered floating card on desktop. -->
		<div
			transition:fly={{ y: 20, duration: 220 }}
			class="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface-2 p-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50 sm:inset-x-0 sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:w-64 sm:rounded-2xl sm:border"
		>
			<div
				class="mx-auto mb-1 flex size-11 items-center justify-center rounded-full border border-border bg-surface-1 text-base font-bold tracking-tight text-text"
				aria-hidden="true"
			>
				H
			</div>

			{#each navItems as item (item.href)}
				<a
					href={item.href}
					aria-current={isActive(item.href) ? 'page' : undefined}
					class="flex min-h-12 items-center justify-center rounded-lg px-4 text-base transition-colors {isActive(
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
				class="flex min-h-12 w-full items-center justify-center rounded-lg px-4 text-base font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
			>
				Log out
			</button>
		</div>
	{/if}
{/if}

{@render children()}
