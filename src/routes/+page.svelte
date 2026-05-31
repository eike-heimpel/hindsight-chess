<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static marketing link to /login; resolve() adds noise without value here. */
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ConnectProfile, { type ConnectSelection } from '$lib/review/ConnectProfile.svelte';
	import { type RecapView } from '$lib/review/RecapCard.svelte';
	import { withConnect } from '$lib/review/connectIntent';

	// A genuine rapid loss of the dogfooding account (Timbolt123 vs sanjar1hdd,
	// chess.com game 169233716058), run through the exact teaser pipeline at
	// LIGHT_DEPTH — so this is literally what a visitor gets a version of once they
	// type their own username, not a stylized mock. Regenerate with:
	//   npx tsx scripts/build-landing-example.ts Timbolt123 169233716058
	const example: RecapView = {
		outcome: 'loss',
		opponent: 'sanjar1hdd',
		opening: 'Van t Kruijs Opening 1...g6',
		timeClass: 'rapid',
		headline: 'You were winning — up to 93% around move 17 — then it slipped away.',
		spark: [
			47, 48, 47, 52, 51, 55, 53, 58, 57, 58, 53, 62, 61, 71, 66, 68, 66, 71, 65, 77, 68, 78, 72,
			71, 68, 91, 88, 90, 89, 93, 86, 93, 88, 85, 17, 15, 16, 23, 30, 25, 28, 35, 16, 15, 11, 16, 8,
			18, 17, 18, 12, 13, 14, 19, 19, 18, 15, 17, 13, 14, 11, 12, 7, 7, 4, 3, 0, 0, 0, 0, 0, 0, 0,
			1, 1, 5, 4, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0
		],
		peakWin: 93,
		accuracy: 70,
		analyzed: true
	};

	let connectSel = $state<ConnectSelection | null>(null);
	const connectHref = $derived(withConnect('/login', connectSel));
</script>

<svelte:head>
	<title>Hindsight — see how you really played</title>
	<meta
		name="description"
		content="The home you open after every game of chess — relive the turning points and understand what happened, in plain English. Judged against a better you, not a machine."
	/>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-8 pb-12">
	<header in:fade={{ duration: 500 }} class="flex items-center justify-between">
		<span class="font-display text-base font-medium tracking-tight text-text-2">
			Hindsight<span class="text-brand">.</span>
		</span>
		<a href="/login" class="text-sm font-medium text-text-2 transition-colors hover:text-text">
			Sign in
		</a>
	</header>

	<div class="mt-10">
		<h1
			in:fly={{ y: 8, duration: 600, easing: cubicOut }}
			class="font-display text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl"
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

	<div class="mt-8" in:fade={{ duration: 700, delay: 260 }}>
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
	{/if}
</main>
