<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; same shape
	 * as /review's game links. */
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

	// Time-of-day greeting resolves client-side (the server's clock isn't the
	// player's). Starts neutral so SSR and hydration agree.
	let greeting = $state('Welcome back');
	onMount(() => {
		const h = new Date().getHours();
		greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
	});

	const displayName = $derived(
		data.name ? data.name.charAt(0).toUpperCase() + data.name.slice(1) : null
	);

	function relativeDay(d: Date): string {
		const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
		if (days === 0) return 'today';
		if (days === -1) return 'yesterday';
		if (days > -7) return rtf.format(days, 'day');
		return `on ${dateFmt.format(d)}`;
	}

	type Outcome = 'win' | 'loss' | 'draw';
	const outcomeLabel: Record<Outcome, string> = { win: 'Won', loss: 'Lost', draw: 'Drew' };
	const outcomeToken: Record<Outcome, string> = { win: 'good', loss: 'bad', draw: 'draw' };

	const latest = $derived(data.latest);

	// Sparkline: my-POV win-% (0..100) → a polyline in a 100×30 viewBox, win up top.
	const sparkPoints = $derived.by(() => {
		const s = latest?.spark;
		if (!s || s.length < 2) return null;
		const n = s.length;
		return s.map((v, i) => `${(i / (n - 1)) * 100},${((100 - v) / 100) * 30}`).join(' ');
	});

	function gameHref(source: string, gameId: string): string {
		return `/review/${source}/${gameId}?me=${encodeURIComponent(data.account ?? '')}`;
	}

	const form = $derived(data.summary.recentForm);
	const hasForm = $derived(form.win + form.draw + form.loss > 0);

	const doors = $derived([
		{
			href: '/review/blunders',
			title: 'Blunders to learn from',
			blurb: 'Your sharpest mistakes, worst first — the ones worth a second look.',
			count: data.depth.blunders
		},
		{
			href: '/review/stats/winnable',
			title: 'Games you should have won',
			blurb: 'Positions you were clearly winning, then let slip away.',
			count: data.depth.winnable
		},
		{
			href: '/review',
			title: 'All your games',
			blurb: 'Browse and replay everything you’ve played.',
			count: data.totalGames
		},
		{
			href: '/review/stats',
			title: 'Your stats',
			blurb: 'Accuracy, openings, where your time goes — dig in.',
			count: null as number | null
		}
	]);
</script>

<svelte:head><title>Hindsight</title></svelte:head>

<div class="glow">
	<main class="mx-auto max-w-2xl px-5 pt-10 pb-16">
		<header class="mb-9">
			<p class="mb-6 text-sm font-medium tracking-wide text-text-muted">Hindsight</p>
			<h1 class="text-3xl font-semibold text-text">
				{greeting}{#if displayName}, {displayName}{/if}.
			</h1>
			<p class="mt-2 text-md text-text-2">
				{#if data.needsAccount}
					Let’s bring your games home.
				{:else if latest}
					Your last game was {relativeDay(new Date(latest.playedAt))}. Here’s how it went.
				{:else}
					No games here yet — let’s pull them in.
				{/if}
			</p>
		</header>

		{#if data.needsAccount}
			<!-- Onboarding: the link form lives on /review; post straight to its action. -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<h2 class="text-lg font-semibold text-text">Link your chess.com account</h2>
				<p class="mt-1 mb-4 text-base text-text-2">
					We’ll pull your games and show you how you really played.
				</p>
				<form method="POST" action="/review?/addAccount" class="flex flex-wrap items-center gap-2">
					<input
						name="username"
						placeholder="your chess.com username"
						autocomplete="off"
						class="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-text focus:border-border-strong focus:outline-none"
					/>
					<button
						type="submit"
						class="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover"
					>
						Link account
					</button>
				</form>
			</section>
		{:else if latest}
			<!-- The hook: the latest game as a plain-English recap. -->
			<a
				href={gameHref(latest.source, latest.gameId)}
				class="group block rounded-xl border border-border bg-surface-1 p-6 transition-colors hover:border-border-strong"
				style="box-shadow: var(--shadow-1);"
			>
				<div class="flex items-center gap-3">
					<span
						class="rounded-md px-2.5 py-1 text-xs font-semibold"
						style="background: color-mix(in srgb, var(--{outcomeToken[
							latest.outcome as Outcome
						]}) 16%, transparent); color: var(--{outcomeToken[latest.outcome as Outcome]});"
					>
						{outcomeLabel[latest.outcome as Outcome]}
					</span>
					<span class="min-w-0 flex-1 truncate text-base text-text-2">
						vs {latest.opponent}
						{#if latest.opening}<span class="text-text-muted"> · {latest.opening}</span>{/if}
					</span>
					<span class="shrink-0 text-xs text-text-muted capitalize">{latest.timeClass}</span>
				</div>

				<p class="mt-4 text-xl leading-snug font-medium text-text">{latest.headline}</p>

				{#if sparkPoints}
					<svg
						class="mt-5 h-14 w-full"
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
							points={sparkPoints}
							fill="none"
							stroke="var(--brand)"
							stroke-width="1.5"
							stroke-linejoin="round"
							stroke-linecap="round"
							vector-effect="non-scaling-stroke"
						/>
					</svg>
				{/if}

				<div class="mt-4 flex items-center gap-5 text-sm">
					{#if latest.analyzed}
						{#if latest.accuracy != null}
							<span class="text-text-2"
								>Accuracy <span class="font-semibold text-text tabular-nums"
									>{latest.accuracy.toFixed(0)}%</span
								></span
							>
						{/if}
						{#if latest.peakWin != null}
							<span class="text-text-2"
								>Peak <span class="font-semibold text-text tabular-nums"
									>{latest.peakWin.toFixed(0)}%</span
								></span
							>
						{/if}
					{:else}
						<span class="text-text-muted">Not analyzed yet — open it to run the engine.</span>
					{/if}
					<span class="ml-auto font-medium text-brand">See the full game →</span>
				</div>
			</a>
		{:else}
			<!-- Account linked, but nothing stored yet. -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<h2 class="text-lg font-semibold text-text">No games yet</h2>
				<p class="mt-1 mb-4 text-base text-text-2">
					Pull your history from chess.com and your home fills up.
				</p>
				<a
					href="/review"
					class="inline-block rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover"
					>Sync your games</a
				>
			</section>
		{/if}

		{#if !data.needsAccount && data.totalGames > 0}
			<!-- Identity strip — calm, few numbers. -->
			<section class="mt-4 grid grid-cols-3 gap-3">
				<div class="rounded-lg border border-border bg-surface-1 p-4">
					<div class="text-2xl font-semibold text-text tabular-nums">
						{data.summary.gamesThisWeek}
					</div>
					<div class="mt-1 text-xs text-text-muted">games this week</div>
				</div>
				<div class="rounded-lg border border-border bg-surface-1 p-4">
					<div class="text-2xl font-semibold text-text tabular-nums">
						{#if hasForm}{form.win}<span class="text-text-muted">–</span>{form.draw}<span
								class="text-text-muted">–</span
							>{form.loss}{:else}—{/if}
					</div>
					<div class="mt-1 text-xs text-text-muted">recent form (W–D–L)</div>
				</div>
				{#if data.summary.sharpest}
					<a
						href={gameHref(data.summary.sharpest.source, data.summary.sharpest.gameId)}
						class="rounded-lg border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong"
					>
						<div class="text-2xl font-semibold text-good tabular-nums">
							{data.summary.sharpest.accuracy.toFixed(0)}%
						</div>
						<div class="mt-1 text-xs text-text-muted">sharpest this week</div>
					</a>
				{:else}
					<div class="rounded-lg border border-border bg-surface-1 p-4">
						<div class="text-2xl font-semibold text-text-muted tabular-nums">—</div>
						<div class="mt-1 text-xs text-text-muted">sharpest this week</div>
					</div>
				{/if}
			</section>

			<!-- Doors into the depth. -->
			<section class="mt-8">
				<h2 class="mb-3 text-sm font-medium tracking-wide text-text-muted">Go deeper</h2>
				<div class="space-y-2">
					{#each doors as door (door.href)}
						<a
							href={door.href}
							class="flex items-center gap-4 rounded-xl border border-border bg-surface-1 px-5 py-4 transition-colors hover:border-border-strong hover:bg-surface-2"
						>
							<span class="min-w-0 flex-1">
								<span class="block font-medium text-text">{door.title}</span>
								<span class="block truncate text-sm text-text-muted">{door.blurb}</span>
							</span>
							{#if door.count}
								<span class="shrink-0 text-lg font-semibold text-text-2 tabular-nums"
									>{door.count}</span
								>
							{/if}
							<span class="shrink-0 text-text-muted">→</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<footer class="mt-10 flex items-center justify-between text-xs text-text-muted">
			{#if data.account}
				<span>Signed in as {data.account}</span>
			{:else}
				<span></span>
			{/if}
			<a href="/review" class="hover:text-text-2">Manage accounts</a>
		</footer>
	</main>
</div>

<style>
	/* Local warmth — a soft brand glow up top so the dark surface feels like a
	   room with a light on, not a console. Stays on the surface layer; no global
	   token changes. */
	.glow {
		min-height: 100vh;
		background:
			radial-gradient(
				120% 70% at 50% -10%,
				color-mix(in srgb, var(--brand) 12%, transparent),
				transparent 55%
			),
			var(--bg);
	}
</style>
