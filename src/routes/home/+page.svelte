<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; same shape
	 * as /review's game links. */
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { fetchGame } from '$lib/client/reviewStats';
	import {
		drawLine as drawLineReveal,
		initialState,
		revealGame,
		type GameState,
		type Phase
	} from '$lib/client/recapReveal';
	import RecapCard from '$lib/review/RecapCard.svelte';
	import ConnectProfile from '$lib/review/ConnectProfile.svelte';
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
	// them and we never mutate `data`. The phase machine + reveal live in
	// `recapReveal` so the landing teaser runs the same code.
	const states = new SvelteMap<string, GameState>();
	const accountsSet = $derived(new Set((data.accounts ?? []).map((a) => a.toLowerCase())));
	const recapByKey = $derived(new Map(data.recents.map((r) => [keyOf(r), r] as const)));

	const EAGER_ANALYZE_CAP = 3;

	function keyOf(r: { source: string; gameId: string }): string {
		return `${r.source}:${r.gameId}`;
	}

	function patch(k: string, p: Partial<GameState>) {
		const prev: GameState = states.get(k) ?? initialState();
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

	// First load after sign-in may carry `?connect=source:username` from the
	// landing teaser — link that profile once, then drop the param so a reload
	// never retries it.
	async function consumeConnect() {
		if (data.mock) return;
		// One-shot URL parse, not reactive state — a plain URL is right here.
		const url = new URL(window.location.href);
		const raw = url.searchParams.get('connect');
		if (!raw) return;

		url.searchParams.delete('connect');
		history.replaceState(null, '', url.pathname + url.search);

		const i = raw.indexOf(':');
		if (i <= 0) return;
		const source = raw.slice(0, i);
		const username = raw
			.slice(i + 1)
			.trim()
			.toLowerCase();
		if (!username) return;

		try {
			const res = await fetch('/api/review/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source, username })
			});
			if (res.ok) await invalidate('app:recents');
		} catch {
			// Best-effort — the user can still link from /account.
		}
	}

	async function run() {
		await consumeConnect();
		if (cancelRequested) return;
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
			spark: [50, 48, 52, 49, 53, 51, 47, 50, 54, 52, 48, 51, 49, 53, 50, 47, 52, 50, 49, 51, 50],
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

			const revealed = await revealGame(game, {
				accounts: accountsSet,
				onPatch: (p) => patch(k, p),
				cancelled: () => cancelRequested
			});
			if (!revealed.ok || cancelRequested) return;

			// Persist the analysis before the headline endpoint reads it.
			await fetch('/api/review/analyze', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(revealed.analysis)
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

	// Line-draw the sparkline once per game (deduped via `hasAnimated`), on the
	// pending→analyzed reveal only.
	const drawLine = (key: string, animate: boolean) => drawLineReveal(key, animate, hasAnimated);

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
			<!-- Onboarding: same ConnectProfile reveal the landing uses, posting to the
			     account action (which imports, then lands back here on the recap). -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<h2 class="text-lg font-semibold text-text">Bring your games home</h2>
				<p class="mt-1 mb-4 text-base text-text-2">
					Connect chess.com or Lichess and see how you really played.
				</p>
				<ConnectProfile mode="link" action="/account?/addAccount" />
			</section>
		{:else if view}
			<!-- The hook: your latest game as a plain-English recap. It comes alive on
			     its own — auto-synced, auto-analyzed (newest first), with the win graph
			     drawing in and the headline becoming a story. Flip back with ←/→. -->
			<RecapCard
				recap={view}
				href={gameHref(view.source, view.gameId)}
				analyzing={isAnalyzing}
				progress={view.progress}
				lineAttach={drawLine(currentKey ?? '', view.animateGraph)}
			>
				{#snippet pager()}
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
				{/snippet}
			</RecapCard>
		{:else}
			<!-- Account linked, but nothing stored yet. -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<h2 class="text-lg font-semibold text-text">No games yet</h2>
				<p class="mt-1 mb-4 text-base text-text-2">Pull your history and your home fills up.</p>
				<a
					href="/account"
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
			<a href="/account" class="hover:text-text-2">Manage accounts</a>
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
