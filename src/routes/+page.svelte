<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; same shape
	 * as /review's game links. */
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { analyzeGame } from '$lib/client/reviewAnalysis';
	import { fetchGame } from '$lib/client/reviewStats';
	import { recapOverlayFrom, sideFor } from '$lib/review/stats/perspective';
	import type { ReviewSource } from '$lib/review/types';
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

	const recents = $derived(data.recents);
	const latest = $derived(recents[0] ?? null);

	// Flip through recent games inside the card — newest first, arrows or ←/→.
	let index = $state(0);
	const current = $derived(recents[Math.min(index, recents.length - 1)] ?? null);
	const currentKey = $derived(current ? keyOf(current) : null);

	function older() {
		if (index < recents.length - 1) index++;
	}
	function newer() {
		if (index > 0) index--;
	}
	function onKey(e: KeyboardEvent) {
		if (recents.length < 2) return;
		if (e.key === 'ArrowRight') older();
		else if (e.key === 'ArrowLeft') newer();
	}

	// --- Live overlay -------------------------------------------------------
	// Server props are immutable; all live analysis/headline results live here,
	// keyed `source:gameId`, so a re-sync that reorders `recents` never loses
	// them and we never mutate `data`.
	type Phase =
		| 'pending'
		| 'fetching'
		| 'analyzing'
		| 'analyzed'
		| 'headlineLoading'
		| 'done'
		| 'error';
	type GameState = {
		phase: Phase;
		done: number;
		total: number;
		spark: number[] | null;
		accuracy: number | null;
		peakWin: number | null;
		headline: string | null;
		error: string | null;
		animateGraph: boolean;
	};

	const states = new SvelteMap<string, GameState>();
	const accountsSet = $derived(new Set((data.accounts ?? []).map((a) => a.toLowerCase())));
	const recapByKey = $derived(new Map(data.recents.map((r) => [keyOf(r), r] as const)));

	const EAGER_ANALYZE_CAP = 3;

	function keyOf(r: { source: string; gameId: string }): string {
		return `${r.source}:${r.gameId}`;
	}

	function patch(k: string, p: Partial<GameState>) {
		const prev: GameState = states.get(k) ?? {
			phase: 'pending',
			done: 0,
			total: 0,
			spark: null,
			accuracy: null,
			peakWin: null,
			headline: null,
			error: null,
			animateGraph: false
		};
		// Always replace the value object so `states` (a SvelteMap) re-derives.
		states.set(k, { ...prev, ...p });
	}

	function isUntouched(k: string): boolean {
		const s = states.get(k);
		return !s || s.phase === 'pending';
	}

	// The merged view of the visible game: immutable recap + any live state.
	const view = $derived.by(() => {
		if (!current) return null;
		const s = states.get(currentKey!);
		const phase: Phase = s?.phase ?? (current.analyzed ? 'done' : 'pending');
		const analyzed =
			current.analyzed ||
			(s ? s.phase === 'analyzed' || s.phase === 'headlineLoading' || s.phase === 'done' : false);
		return {
			...current,
			phase,
			analyzed,
			accuracy: s?.accuracy ?? current.accuracy,
			peakWin: s?.peakWin ?? current.peakWin,
			spark: s?.spark ?? current.spark,
			headline: s?.headline ?? current.headline,
			progress: { done: s?.done ?? 0, total: s?.total ?? 0 },
			animateGraph: s?.animateGraph ?? false,
			error: s?.error ?? null
		};
	});

	const isAnalyzing = $derived(view?.phase === 'fetching' || view?.phase === 'analyzing');
	const progressPct = $derived(
		view && view.progress.total ? (view.progress.done / view.progress.total) * 100 : 0
	);

	// Sparkline: my-POV win-% (0..100) → a polyline in a 100×30 viewBox, win up top.
	const sparkPoints = $derived.by(() => {
		const s = view?.spark;
		if (!s || s.length < 2) return null;
		const n = s.length;
		return s.map((v, i) => `${(i / (n - 1)) * 100},${((100 - v) / 100) * 30}`).join(' ');
	});

	// The peak win-% point, as percentages over the chart, for an in-graph label.
	// (The SVG is preserveAspectRatio="none", so we overlay HTML instead of <text>.)
	const peakMarker = $derived.by(() => {
		const s = view?.spark;
		if (!s || s.length < 2 || view?.peakWin == null) return null;
		let bi = 0;
		for (let i = 1; i < s.length; i++) if (s[i] > s[bi]) bi = i;
		const x = (bi / (s.length - 1)) * 100; // % across width
		const y = 100 - s[bi]; // % down (spark is 0..100, win up top)
		// Keep the label inside the card: left-align near the start, right-align
		// near the end, centered otherwise.
		const tx = x < 15 ? '0' : x > 85 ? '-100%' : '-50%';
		return { x, y, value: s[bi], tx };
	});

	function gameHref(source: string, gameId: string): string {
		return `/review/${source}/${gameId}?me=${encodeURIComponent(data.account ?? '')}`;
	}

	// --- Orchestration ------------------------------------------------------
	let cancelRequested = false;
	let processing = false;
	const queue: string[] = [];
	// Games whose line-draw has already played — so flipping away and back
	// doesn't replay it.
	const hasAnimated = new SvelteSet<string>();

	onMount(() => {
		run();
		return () => {
			cancelRequested = true;
		};
	});

	async function run() {
		// 1. Auto-sync new games, then re-run the loader if any landed.
		//    (Skipped in mock mode — there's no real account to sync.)
		if (!data.mock) {
			try {
				const res = await fetch('/api/review/sync', { method: 'POST' });
				if (res.ok) {
					const { added } = (await res.json()) as { added: number };
					if (added > 0) await invalidate('app:recents');
				}
			} catch {
				// Offline / 5xx — proceed with what's already stored.
			}
		}
		if (cancelRequested) return;
		// 2. Queue the newest unanalyzed games (cap), then drain.
		enqueueEager();
		pump();
	}

	function enqueueEager() {
		let count = 0;
		for (const r of data.recents) {
			if (count >= EAGER_ANALYZE_CAP) break;
			const k = keyOf(r);
			if (r.analyzed || !isUntouched(k) || queue.includes(k)) continue;
			queue.push(k);
			count++;
		}
	}

	async function pump() {
		if (processing) return;
		processing = true;
		try {
			while (queue.length && !cancelRequested) {
				await processOne(queue.shift()!);
			}
		} finally {
			processing = false;
		}
	}

	// --- Mock mode (/?mock=1) -----------------------------------------------
	// The reveal each unanalyzed mock game animates into: a win-% timeline plus
	// the "story" headline that swaps in after the (fake) engine + LLM run.
	const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
	const MOCK_REVEAL: Record<
		string,
		{ spark: number[]; accuracy: number; peakWin: number; headline: string }
	> = {
		'chesscom:mock-1': {
			spark: [
				50, 53, 51, 55, 58, 56, 60, 57, 54, 50, 46, 48, 43, 40, 42, 38, 35, 33, 36, 30, 27, 24, 22,
				20
			],
			accuracy: 71,
			peakWin: 60,
			headline:
				'Even after the engine ran, the verdict holds — a strong middlegame undone by a couple of late slips.'
		},
		'chesscom:mock-3': {
			spark: [
				50, 48, 52, 49, 53, 51, 47, 50, 54, 52, 48, 51, 49, 53, 50, 47, 52, 50, 49, 51, 50
			],
			accuracy: 80,
			peakWin: 54,
			headline: 'The engine agrees it was balanced throughout — a hard-earned, well-deserved draw.'
		}
	};

	async function simulateOne(k: string) {
		const reveal = MOCK_REVEAL[k];
		if (!reveal) return;
		patch(k, { phase: 'fetching', done: 0, total: 0 });
		await sleep(600);
		if (cancelRequested) return;
		const total = reveal.spark.length;
		patch(k, { phase: 'analyzing', total });
		for (let done = 1; done <= total; done++) {
			await sleep(55);
			if (cancelRequested) return;
			patch(k, { done });
		}
		patch(k, {
			phase: 'analyzed',
			animateGraph: true,
			spark: reveal.spark,
			accuracy: reveal.accuracy,
			peakWin: reveal.peakWin
		});
		await sleep(2800); // let the line finish drawing before the headline swaps
		if (cancelRequested) return;
		if (data.llmHeadlines) {
			patch(k, { phase: 'headlineLoading' });
			await sleep(1300);
			if (cancelRequested) return;
			patch(k, { headline: reveal.headline });
		}
		patch(k, { phase: 'done' });
	}

	async function processOne(k: string) {
		if (!isUntouched(k)) return; // dedupe — already running / done / errored
		const recap = recapByKey.get(k);
		if (!recap) return;

		if (data.mock) {
			await simulateOne(k);
			return;
		}

		patch(k, { phase: 'fetching', done: 0, total: 0 });
		try {
			const game = await fetchGame({ source: recap.source as ReviewSource, gameId: recap.gameId });
			if (cancelRequested) return;

			patch(k, { phase: 'analyzing' });
			const result = await analyzeGame(game, (done, total) => patch(k, { done, total }));
			if (cancelRequested) return;
			if (!result.ok) {
				patch(k, { phase: 'error', error: result.error.message });
				return;
			}

			const side = sideFor(game, accountsSet);
			if (!side) {
				patch(k, { phase: 'error', error: 'not your game' });
				return;
			}

			const overlay = recapOverlayFrom(result.value, side);
			patch(k, {
				phase: 'analyzed',
				animateGraph: true,
				spark: overlay.spark,
				accuracy: overlay.accuracy,
				peakWin: overlay.peakWin
			});

			// Persist the analysis before the headline endpoint reads it.
			await fetch('/api/review/analyze', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(result.value)
			});
			if (cancelRequested) return;

			if (data.llmHeadlines) {
				patch(k, { phase: 'headlineLoading' });
				try {
					const res = await fetch('/api/review/headline', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ source: recap.source, gameId: recap.gameId })
					});
					if (res.ok) {
						const { text } = (await res.json()) as { text: string };
						if (text) patch(k, { headline: text });
					}
				} catch {
					// Headline is non-critical — keep the template line.
				}
			}
			patch(k, { phase: 'done' });
		} catch (e) {
			patch(k, { phase: 'error', error: e instanceof Error ? e.message : String(e) });
		}
	}

	// On-flip lazy analysis: flipping to an untouched, unanalyzed game jumps it to
	// the front of the queue. The engine is sequential (no preempt) — the in-flight
	// game finishes, then this one runs.
	$effect(() => {
		const k = currentKey;
		if (!k) return;
		const recap = recapByKey.get(k);
		if (!recap || recap.analyzed || !isUntouched(k) || queue.includes(k)) return;
		queue.unshift(k);
		pump();
	});

	// Line-draw the sparkline once per game, on the pending→analyzed reveal only.
	function drawLine(key: string, animate: boolean) {
		return (node: SVGPolylineElement) => {
			if (!animate || hasAnimated.has(key)) return;
			hasAnimated.add(key);
			// preserveAspectRatio="none" + non-scaling-stroke means the dash is measured in
			// screen pixels, while getTotalLength() is in viewBox units — the mismatch makes
			// the dash repeat into gaps. Compute the rendered pixel length of the polyline.
			const rect = (node.ownerSVGElement ?? node).getBoundingClientRect();
			const sx = rect.width / 100;
			const sy = rect.height / 30;
			const pts = node.points;
			let len = 0;
			for (let i = 1; i < pts.numberOfItems; i++) {
				const a = pts.getItem(i - 1);
				const b = pts.getItem(i);
				len += Math.hypot((b.x - a.x) * sx, (b.y - a.y) * sy);
			}
			node.style.transition = 'none';
			node.style.strokeDasharray = `${len}`;
			node.style.strokeDashoffset = `${len}`;
			node.getBoundingClientRect(); // force reflow so the offset takes before we animate
			node.style.transition = 'stroke-dashoffset 2.6s ease-out';
			node.style.strokeDashoffset = '0';
		};
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

<svelte:window onkeydown={onKey} />

<div class="glow">
	<main class="mx-auto max-w-2xl px-5 pt-10 pb-16">
		<header class="mb-9">
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
		{:else if view}
			<!-- The hook: your latest game as a plain-English recap. It comes alive on
			     its own — auto-synced, auto-analyzed (newest first), with the win graph
			     drawing in and the headline becoming a story. Flip back with ←/→. -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<div class="flex items-center gap-3">
					<span
						class="rounded-md px-2.5 py-1 text-xs font-semibold"
						style="background: color-mix(in srgb, var(--{outcomeToken[
							view.outcome as Outcome
						]}) 16%, transparent); color: var(--{outcomeToken[view.outcome as Outcome]});"
					>
						{outcomeLabel[view.outcome as Outcome]}
					</span>
					<span class="min-w-0 flex-1 truncate text-base text-text-2">
						vs {view.opponent}
						{#if view.opening}<span class="text-text-muted"> · {view.opening}</span>{/if}
					</span>
					<span class="shrink-0 text-xs text-text-muted capitalize">{view.timeClass}</span>
					{#if recents.length > 1}
						<div class="flex shrink-0 items-center gap-1">
							<button
								type="button"
								onclick={newer}
								disabled={index === 0}
								aria-label="Newer game"
								class="rounded-md px-1 text-lg leading-none text-text-muted transition-colors hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
								>‹</button
							>
							<span class="text-xs text-text-muted tabular-nums">{index + 1}/{recents.length}</span>
							<button
								type="button"
								onclick={older}
								disabled={index === recents.length - 1}
								aria-label="Older game"
								class="rounded-md px-1 text-lg leading-none text-text-muted transition-colors hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
								>›</button
							>
						</div>
					{/if}
				</div>

				<a
					href={gameHref(view.source, view.gameId)}
					class="group block transition-opacity hover:opacity-90"
				>
					<div class="mt-4 grid">
						{#key view.headline}
							<p
								class="col-start-1 row-start-1 text-xl leading-snug font-medium text-text"
								in:fly={{ y: 10, duration: 500, delay: 120, easing: cubicOut }}
								out:fade={{ duration: 200 }}
							>
								{view.headline}
							</p>
						{/key}
					</div>

					{#if isAnalyzing}
						<div class="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
							<div
								class="h-full rounded-full bg-brand transition-[width] duration-150"
								style="width: {progressPct}%"
							></div>
						</div>
					{:else if sparkPoints}
						<div class="relative mt-5">
							<svg
								class="block h-14 w-full"
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
									{@attach drawLine(currentKey ?? '', view.animateGraph)}
									points={sparkPoints}
									fill="none"
									stroke="var(--brand)"
									stroke-width="1.5"
									stroke-linejoin="round"
									stroke-linecap="round"
									vector-effect="non-scaling-stroke"
								/>
							</svg>
							{#if peakMarker}
								<span
									class="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-surface-1"
									style="left: {peakMarker.x}%; top: {peakMarker.y}%;"
								></span>
								<span
									class="absolute whitespace-nowrap text-[11px] font-medium text-text-2"
									style="left: {peakMarker.x}%; top: calc({peakMarker.y}% - 0.45rem); transform: translate({peakMarker.tx}, -100%);"
								>
									Peak <span class="font-semibold text-text tabular-nums"
										>{peakMarker.value.toFixed(0)}%</span
									>
								</span>
							{/if}
						</div>
					{/if}

					<div class="mt-4 flex items-center gap-5 text-sm">
						{#if isAnalyzing}
							<span class="text-text-muted"
								>Analyzing your game… {view.progress.done}/{view.progress.total}</span
							>
						{:else if view.analyzed}
							{#if view.accuracy != null}
								<span class="text-text-2" transition:fade={{ duration: 400 }}
									>Accuracy <span class="font-semibold text-text tabular-nums"
										>{view.accuracy.toFixed(0)}%</span
									></span
								>
							{/if}
						{:else}
							<span class="text-text-muted">Not analyzed yet — open it to run the engine.</span>
						{/if}
						<span class="ml-auto font-medium text-brand">See the full game →</span>
					</div>
				</a>
			</section>
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
