<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static marketing link to /login; resolve() adds noise without value here. */
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ConnectProfile, { type ConnectSelection } from '$lib/review/ConnectProfile.svelte';
	import { type RecapView } from '$lib/review/RecapCard.svelte';

	// One of Eike's real rapid losses, shown as the pre-submit hero: a jagged climb
	// to a clearly-winning 94%, a sharp cliff off the peak, then a long slide. It's
	// what a visitor gets a version of once they type their own username.
	const example: RecapView = {
		outcome: 'loss',
		opponent: 'sanjar1hdd',
		opening: "Van 't Kruijs Opening",
		timeClass: 'rapid',
		headline: 'You were winning — up to 94% around move 17 — then it slipped away.',
		spark: [
			50, 54, 49, 56, 52, 60, 55, 64, 59, 69, 63, 73, 68, 78, 74, 84, 80, 90, 94, 91, 56, 61, 53,
			58, 50, 55, 47, 52, 45, 50, 43, 47, 41, 45, 39, 43, 38, 41, 36, 39, 34, 32, 30, 28, 27, 25,
			24, 23, 22, 21, 20, 19, 18
		],
		peakWin: 94,
		accuracy: 66,
		analyzed: true
	};

	let connectSel = $state<ConnectSelection | null>(null);
	const connectHref = $derived(
		connectSel
			? `/login?connect=${encodeURIComponent(`${connectSel.source}:${connectSel.username}`)}`
			: '/login'
	);
</script>

<svelte:head>
	<title>Hindsight — see how you really played</title>
	<meta
		name="description"
		content="The home you open after every game of chess — relive the turning points and understand what happened, in plain English. Judged against a better you, not a machine."
	/>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-16 pb-12">
	<header in:fade={{ duration: 500 }}>
		<span class="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-text-2">
			<span class="h-2.5 w-2.5 rounded-[3px] bg-brand"></span>
			Hindsight
		</span>
	</header>

	<div class="mt-12">
		<h1
			in:fly={{ y: 8, duration: 600, easing: cubicOut }}
			class="text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl"
		>
			See how you really played.
		</h1>
		<p
			in:fly={{ y: 8, duration: 600, delay: 90, easing: cubicOut }}
			class="mt-3 text-lg text-text-2"
		>
			Judged against a better <span class="text-text">you</span> — not a machine.
		</p>
	</div>

	<div class="mt-9" in:fade={{ duration: 700, delay: 260 }}>
		<ConnectProfile mode="teaser" {example} onRevealed={(sel) => (connectSel = sel)} />
	</div>

	{#if connectSel}
		<div class="mt-7" in:fly={{ y: 8, duration: 500, easing: cubicOut }}>
			<a
				href={connectHref}
				class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover"
			>
				Save this — and every game <span aria-hidden="true">→</span>
			</a>
			<p class="mt-3 text-sm text-text-muted">
				We'll email a sign-in link — no password. Every game you play lands here, ready when you
				come back.
			</p>
		</div>
	{:else}
		<p class="mt-4 text-sm text-text-muted" in:fade={{ duration: 600, delay: 360 }}>
			Pick chess.com or Lichess — type your username to see your last game. No sign-up to look.
		</p>
	{/if}
</main>
