<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static marketing links to /login; resolve() adds noise without value here
	 * (same posture as the other route files). */
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	// A faithful, static replica of a real recap card's win-% sparkline: my-POV
	// win-% (0..100) climbing into the winning zone, then given back. Same
	// geometry as the live card on /home — 100×30 viewBox, win up top. No eval
	// numbers on the surface; the *shape* tells the story.
	const spark = [50, 53, 57, 62, 68, 74, 80, 85, 88, 87, 86, 85, 84, 73, 61, 49, 39, 31, 25, 21];
	const n = spark.length;
	const points = spark.map((v, i) => `${(i / (n - 1)) * 100},${((100 - v) / 100) * 30}`).join(' ');

	let peakIndex = 0;
	for (let i = 1; i < n; i++) if (spark[i] > spark[peakIndex]) peakIndex = i;
	const peak = {
		x: (peakIndex / (n - 1)) * 100,
		y: 100 - spark[peakIndex],
		value: spark[peakIndex]
	};
</script>

<svelte:head>
	<title>Hindsight — see how you really played</title>
	<meta
		name="description"
		content="The home you open after every game of chess — relive the turning points and understand what happened, in plain English. Judged against a better you, not a machine."
	/>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col px-6 pb-20">
	<header class="pt-7">
		<span class="text-sm font-semibold tracking-wide text-text-2">Hindsight</span>
	</header>

	<!-- Hero — the sentence has to land, so it stands almost alone. -->
	<section class="flex flex-1 flex-col justify-center py-20">
		<h1
			in:fly={{ y: 8, duration: 600, easing: cubicOut }}
			class="text-3xl font-semibold tracking-tight text-balance text-text sm:text-display"
		>
			See how you really played.
		</h1>
		<p
			in:fly={{ y: 8, duration: 600, delay: 90, easing: cubicOut }}
			class="mt-4 text-lg text-text-2"
		>
			Judged against a better <span class="text-text">you</span> — not a machine.
		</p>

		<div in:fade={{ duration: 600, delay: 220 }} class="mt-9 flex flex-col gap-3">
			<a
				href="/login"
				class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover"
			>
				See your games <span aria-hidden="true">→</span>
			</a>
			<p class="text-sm text-text-muted">
				Connect chess.com or Lichess. We email you a link — no password.
			</p>
		</div>
	</section>

	<!-- Proof, surface layer only: one calm recap card. The win-% rises into the
	     winning zone, holds, then slips — the story the words promise. -->
	<section in:fade={{ duration: 700, delay: 380 }} class="pb-16">
		<div class="rounded-xl border border-border bg-surface-1 p-5">
			<p class="text-md text-text">Clearly winning for 6 moves — then this gave it back.</p>
			<div class="relative mt-5">
				<svg
					class="block h-16 w-full"
					viewBox="0 0 100 30"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<line
						x1="0"
						y1="15"
						x2="100"
						y2="15"
						stroke="var(--border)"
						stroke-width="0.5"
						stroke-dasharray="2 2"
						vector-effect="non-scaling-stroke"
					/>
					<polyline
						{points}
						fill="none"
						stroke="var(--brand)"
						stroke-width="1.5"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
				<span
					class="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-surface-1"
					style="left: {peak.x}%; top: {peak.y}%;"
				></span>
				<span
					class="absolute -translate-x-1/2 text-[11px] font-medium text-text-2"
					style="left: {peak.x}%; top: calc({peak.y}% - 0.45rem); transform: translate(-50%, -100%);"
				>
					Peak <span class="font-semibold text-text tabular-nums">{peak.value}%</span>
				</span>
			</div>
		</div>
	</section>

	<!-- Two quiet beats — moments, not features. -->
	<section class="grid gap-10 sm:grid-cols-2">
		<div>
			<h2 class="text-lg font-semibold text-text">The home you open after every game.</h2>
			<p class="mt-2 text-base text-text-2">
				Win or lose, your games gather in one calm place — a room you come back to, not a tool you
				dig out.
			</p>
		</div>
		<div>
			<h2 class="text-lg font-semibold text-text">Every game becomes a story.</h2>
			<p class="mt-2 text-base text-text-2">
				The turning point, the moment it slipped or you saved it — in plain English, told like
				someone on your side.
			</p>
		</div>
	</section>

	<div class="mt-12">
		<a
			href="/login"
			class="inline-flex w-fit items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover"
		>
			See your games <span aria-hidden="true">→</span>
		</a>
	</div>
</main>
