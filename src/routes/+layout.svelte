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

	// The one piece of always-on chrome: a quiet, labeled "Menu" pill pinned to
	// the bottom-center, in easy thumb reach from either hand. Fixed/overlay so it
	// costs zero layout height — pages keep their full viewport and nothing new
	// scrolls. It reads as "tap me for the map," not as decoration (the old bare
	// "H" monogram hid the nav behind a logo). Tapping it raises the sheet.
	// Suppressed on the sign-in screen and the public landing (which carries its
	// own wordmark; a logged-out stranger has no app nav to show).
	const showChrome = $derived(page.url.pathname !== '/login' && page.url.pathname !== '/');

	let navOpen = $state(false);

	// A quiet reward for reaching the end: a thin eval-line hairline draws out
	// from both flanks of the pill (echoes the win% line that runs the app).
	// Only on pages long enough to actually scroll — so it reads as "you made it
	// to the bottom," not as permanent chrome.
	let atBottom = $state(false);

	function checkBottom() {
		const scrollable = document.documentElement.scrollHeight - window.innerHeight;
		atBottom = scrollable > 8 && window.scrollY >= scrollable - 8;
	}

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
		atBottom = false;
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
	onscroll={checkBottom}
	onresize={checkBottom}
/>

{#if showChrome}
	<!-- The launcher: a labeled "Menu" pill, bottom-center, thumb-reachable from
	     either hand. Hidden while the menu is open, since the sheet rises into its
	     place. -->
	{#if !navOpen}
		<nav
			class="fixed bottom-0 left-1/2 z-50 flex -translate-x-1/2 items-center"
			class:at-bottom={atBottom}
			style="bottom: max(1rem, env(safe-area-inset-bottom));"
		>
			<span class="menu-line menu-line-left" aria-hidden="true"></span>
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={navOpen}
				onclick={() => (navOpen = true)}
				transition:fade={{ duration: 120 }}
				class="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-1/80 py-2.5 pr-4 pl-3 text-text-2 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:text-text active:bg-surface-2"
			>
				<svg
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
				</svg>
				<span class="font-display text-sm font-semibold tracking-tight">Menu</span>
			</button>
			<span class="menu-line menu-line-right" aria-hidden="true"></span>
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
				class="mx-auto mb-1 flex size-11 items-center justify-center rounded-full border border-border bg-surface-1 font-display text-lg font-semibold tracking-tight text-text"
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

<!-- Reserve clearance for the fixed Menu pill once, here, so no page has to
     remember to pad its own bottom (and they drifted: pb-16 vs py-8). Only when
     the pill is actually shown. -->
<div class={showChrome ? 'pb-10' : undefined}>
	{@render children()}
</div>

<style>
	/* Hairlines flanking the Menu pill: hidden until the page bottom is reached,
	   then they draw outward and settle — a calm echo of the win% eval line. */
	.menu-line {
		height: 1px;
		width: clamp(2rem, 22vw, 8rem);
		pointer-events: none;
		opacity: 0;
		transform: scaleX(0);
		transition:
			opacity 0.5s ease,
			transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.menu-line-left {
		margin-right: 0.6rem;
		transform-origin: right center;
		background: linear-gradient(
			to left,
			color-mix(in srgb, var(--brand) 55%, transparent),
			transparent
		);
	}
	.menu-line-right {
		margin-left: 0.6rem;
		transform-origin: left center;
		background: linear-gradient(
			to right,
			color-mix(in srgb, var(--brand) 55%, transparent),
			transparent
		);
	}
	.at-bottom .menu-line {
		opacity: 1;
		transform: scaleX(1);
	}

	@media (prefers-reduced-motion: reduce) {
		.menu-line {
			transform: none;
			transition: opacity 0.3s ease;
		}
		.at-bottom .menu-line {
			transform: none;
		}
	}
</style>
