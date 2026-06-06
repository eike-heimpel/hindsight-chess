<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; same shape
	 * as /review's game links. */
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import type { Phase } from '$lib/client/recapReveal';
	import { createRecapQueue, keyOf, type RecapQueue } from '$lib/client/recapQueue.svelte';
	import { createRealRecapEngine } from '$lib/client/recapEngine';
	import RecapCard from '$lib/review/RecapCard.svelte';
	import ConnectProfile from '$lib/review/ConnectProfile.svelte';
	import { parseConnect } from '$lib/review/connectIntent';
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

	// Swipe the card left/right to flip games (mobile). Fires on release so it
	// never steals vertical page-scroll: only a clearly-horizontal drag counts.
	let touchX = 0;
	let touchY = 0;
	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		touchX = e.touches[0].clientX;
		touchY = e.touches[0].clientY;
	}
	function onTouchEnd(e: TouchEvent) {
		if (recents.length < 2) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchX;
		const dy = t.clientY - touchY;
		if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
		if (dx < 0) older();
		else newer();
	}

	// --- Live overlay -------------------------------------------------------
	// Server props are immutable; the live analysis/headline reveal lives in the
	// queue's `SvelteMap`, keyed `source:gameId`, so a re-sync that reorders
	// `recents` never loses it and we never mutate `data`. The orchestration (work
	// queue, single-flight pump, cancellation, eager cap) lives in `recapQueue`;
	// this component is presentation + wiring.
	let queue = $state.raw<RecapQueue | undefined>();

	// The merged view of the visible game: immutable recap + any live state.
	const view = $derived.by(() => {
		if (!current) return null;
		const s = queue?.get(currentKey!);
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

	// --- Load-time bootstrap ------------------------------------------------
	// Connect-on-first-load + auto-sync stay in the component: they call
	// SvelteKit's `invalidate` (which can't be imported into a module) and touch
	// `window`/`history`. Once data has settled we build the engine + queue and
	// kick off the reveal. `destroyed` guards against finishing after unmount.
	let destroyed = false;

	onMount(() => {
		bootstrap();
		return () => {
			destroyed = true;
			queue?.cancel();
		};
	});

	// First load after sign-in may carry the connect intent from the landing
	// teaser — link that profile once, then drop the params so a reload never
	// retries it.
	async function consumeConnect() {
		if (data.mock) return;
		// One-shot URL parse, not reactive state — a plain URL is right here.
		const url = new URL(window.location.href);
		const intent = parseConnect(url.searchParams);
		if (!intent) return;

		url.searchParams.delete('connect_source');
		url.searchParams.delete('connect_username');
		history.replaceState(null, '', url.pathname + url.search);

		try {
			const res = await fetch('/api/review/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source: intent.source, username: intent.username })
			});
			if (res.ok) await invalidate('app:recents');
		} catch {
			// Best-effort — the user can still link from /account.
		}
	}

	async function bootstrap() {
		await consumeConnect();
		if (destroyed) return;
		// Auto-sync new games, then re-run the loader if any landed. (Skipped in
		// mock mode — there's no real account to sync.)
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
		if (destroyed) return;

		// Mock mode is dev-only — load it as a lazy chunk so it never ships to
		// real users. Build accounts after connect, so a just-linked profile counts.
		const engine = data.mock
			? (await import('$lib/client/recapEngine.mock')).createMockRecapEngine({
					llmHeadlines: data.llmHeadlines
				})
			: createRealRecapEngine({
					accounts: new Set((data.accounts ?? []).map((a) => a.toLowerCase())),
					llmHeadlines: data.llmHeadlines
				});
		if (destroyed) return;

		queue = createRecapQueue({ engine });
		queue.start(data.recents);
	}

	// Flipping to an untouched, unanalyzed game jumps it to the front of the
	// queue. A real side effect (launches async work in response to a state
	// change), so it belongs in an effect — not a `data`→`$state` copy.
	$effect(() => {
		queue?.flipTo(currentKey);
	});

	const drawLine = (key: string, animate: boolean) => queue?.drawLine(key, animate);

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
		},
		{
			href: '/review/coach',
			title: 'Talk it through with the coach',
			blurb: 'Pick a moment, share your read, and work out what you missed.',
			count: null as number | null
		}
	]);
</script>

<svelte:head><title>Hindsight</title></svelte:head>

<svelte:window onkeydown={onKey} />

<div class="glow">
	<main class="mx-auto max-w-2xl px-5 pt-10 pb-10">
		<header class="mb-9">
			<h1 class="font-display text-3xl font-semibold tracking-tight text-text">
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
				<h2 class="font-display text-lg font-semibold tracking-tight text-text">
					Bring your games home
				</h2>
				<p class="mt-1 mb-4 text-base text-text-2">
					Connect chess.com or Lichess and see how you really played.
				</p>
				<ConnectProfile mode="link" action="/account?/addAccount" />
			</section>
		{:else if view}
			<!-- The hook: your latest game as a plain-English recap. It comes alive on
			     its own — auto-synced, auto-analyzed (newest first), with the win graph
			     drawing in and the headline becoming a story. Flip back with ←/→. -->
			<div
				role="group"
				aria-roledescription="Game pager — swipe left or right to flip games"
				ontouchstart={onTouchStart}
				ontouchend={onTouchEnd}
			>
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
									class="inline-flex items-center justify-center rounded-md px-2 text-lg leading-none text-text-muted transition-colors hover:text-text disabled:opacity-30 disabled:hover:text-text-muted pointer-coarse:size-10"
									>‹</button
								>
								<span class="text-xs text-text-muted tabular-nums"
									>{index + 1}/{recents.length}</span
								>
								<button
									type="button"
									onclick={older}
									disabled={index === recents.length - 1}
									aria-label="Older game"
									class="inline-flex items-center justify-center rounded-md px-2 text-lg leading-none text-text-muted transition-colors hover:text-text disabled:opacity-30 disabled:hover:text-text-muted pointer-coarse:size-10"
									>›</button
								>
							</div>
						{/if}
					{/snippet}
				</RecapCard>
			</div>
		{:else}
			<!-- Account linked, but nothing stored yet. -->
			<section
				class="rounded-xl border border-border bg-surface-1 p-6"
				style="box-shadow: var(--shadow-1);"
			>
				<h2 class="font-display text-lg font-semibold tracking-tight text-text">No games yet</h2>
				<p class="mt-1 mb-4 text-base text-text-2">Pull your history and your home fills up.</p>
				<a
					href="/account"
					class="inline-block rounded-lg bg-brand px-4 py-2.5 font-medium text-white hover:bg-brand-hover"
					>Sync your games</a
				>
			</section>
		{/if}

		{#if !data.needsAccount && data.totalGames > 0}
			<!-- Identity strip — calm, few numbers. -->
			<section class="mt-4 grid grid-cols-2 gap-3">
				<div class="rounded-lg border border-border bg-surface-1 p-4">
					<div class="text-2xl font-semibold text-text tabular-nums">
						{data.summary.gamesThisWeek}
					</div>
					<div class="mt-1 text-xs text-text-muted">games this week</div>
				</div>
				<div class="rounded-lg border border-border bg-surface-1 p-4">
					<div class="truncate text-2xl font-semibold text-text tabular-nums">
						{#if hasForm}{form.win}<span class="mx-1.5 text-text-muted">–</span>{form.draw}<span
								class="mx-1.5 text-text-muted">–</span
							>{form.loss}{:else}—{/if}
					</div>
					<div class="mt-1 text-xs text-text-muted">recent form (W–D–L)</div>
				</div>
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

		<footer class="mt-10 flex items-center justify-between gap-3 text-xs text-text-muted">
			{#if data.account}
				<span class="min-w-0 truncate">Signed in as {data.account}</span>
			{:else}
				<span></span>
			{/if}
			<a href="/account" class="-my-1.5 shrink-0 py-1.5 whitespace-nowrap hover:text-text-2"
				>Manage accounts</a
			>
		</footer>
	</main>
</div>

<style>
	/* Local warmth — a soft brand glow up top so the dark surface feels like a
	   room with a light on, not a console. Stays on the surface layer; no global
	   token changes. */
	.glow {
		min-height: 100dvh;
		background:
			radial-gradient(
				120% 70% at 50% -10%,
				color-mix(in srgb, var(--brand) 12%, transparent),
				transparent 55%
			),
			var(--bg);
	}
</style>
