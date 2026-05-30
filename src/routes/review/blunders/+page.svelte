<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static /review links and the runtime-built game href read clearer as plain
	 * hrefs; same convention as the other /review pages. */
	import type { PageData } from './$types';
	import type { ReviewGame } from '$lib/review/types';
	import type { BlunderEntry } from '$lib/review/stats/types';
	import { uciSquares } from '$lib/review/analysis';
	import { explainMove } from '$lib/client/reviewExplain';
	import Board from '$lib/components/Board.svelte';
	import RecencyFilter from '$lib/review/RecencyFilter.svelte';
	import { withinWindow, RECENCY_DEFAULT, type RecencyWindow } from '$lib/review/recency';
	import { C } from '$lib/review/charts/palette';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	const short = (d: Date | string) => dateFmt.format(new Date(d));
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	// --- recency window (coarser axis — drops stale early games; persisted) ---
	let recency = $state<RecencyWindow>(RECENCY_DEFAULT);
	const inWindow = $derived<BlunderEntry[]>(
		data.entries.filter((e) => withinWindow(e.playedAt, recency))
	);

	// --- time-class filter (pooled by default — see BlunderEntry) ---
	const FILTERS = $derived<string[]>([
		'all',
		...[...new Set(inWindow.map((e) => e.timeClass))].sort()
	]);
	let filter = $state('all');
	const countFor = (f: string) =>
		f === 'all' ? inWindow.length : inWindow.filter((e) => e.timeClass === f).length;

	const entries = $derived<BlunderEntry[]>(
		filter === 'all' ? inWindow : inWindow.filter((e) => e.timeClass === filter)
	);

	let index = $state(0);
	const clamped = $derived(Math.min(index, Math.max(0, entries.length - 1)));
	const current = $derived<BlunderEntry | undefined>(entries[clamped]);

	// Re-narrowing the recency window snaps back to the worst blunder and drops a
	// now-empty time-class selection (recency is the coarser axis). Tracks `recency`
	// only, so stepping through with go() doesn't retrigger it.
	$effect(() => {
		recency;
		filter = 'all';
		index = 0;
	});

	// Reset to the worst blunder whenever the filter narrows the queue.
	function setFilter(f: string) {
		filter = f;
		index = 0;
	}

	function go(delta: number) {
		index = Math.min(entries.length - 1, Math.max(0, clamped + delta));
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'ArrowRight') go(1);
	}

	// --- on-demand grounded explanation (reuses the move explainer) ---
	type ExplainState = {
		loading: boolean;
		text?: string;
		error?: string;
		progress?: { done: number; total: number };
	};
	let explains = $state<Record<string, ExplainState>>({});
	// Plain memo, not reactive state — fetched games only feed the explainer.
	const gameCache: Record<string, ReviewGame> = {};

	const explainId = (e: BlunderEntry) => `${e.source}:${e.gameId}:${e.ply}`;

	const currentExplain = $derived.by<ExplainState | undefined>(() => {
		if (!current) return undefined;
		const fetched = explains[explainId(current)];
		if (fetched) return fetched;
		if (current.cachedExplanation) return { loading: false, text: current.cachedExplanation };
		return undefined;
	});

	async function explain(entry: BlunderEntry) {
		const id = explainId(entry);
		if (explains[id]?.loading) return;
		explains = { ...explains, [id]: { loading: true } };
		try {
			const gameKey = `${entry.source}:${entry.gameId}`;
			let game = gameCache[gameKey];
			if (!game) {
				const res = await fetch(`/api/review/game/${entry.source}/${entry.gameId}`);
				if (!res.ok) throw new Error(`couldn't load game (${res.status})`);
				game = (await res.json()) as ReviewGame;
				gameCache[gameKey] = game;
			}
			const result = await explainMove(game, entry.ply, (done, total) => {
				explains = { ...explains, [id]: { loading: true, progress: { done, total } } };
			});
			explains = {
				...explains,
				[id]: result.ok
					? { loading: false, text: result.value.text }
					: { loading: false, error: result.error.message }
			};
		} catch (e) {
			explains = {
				...explains,
				[id]: { loading: false, error: e instanceof Error ? e.message : String(e) }
			};
		}
	}
</script>

<svelte:head><title>Review · Blunder trainer</title></svelte:head>
<svelte:window onkeydown={onKey} />

<div class="min-h-screen" style="background: var(--bg);">
	<main class="mx-auto max-w-4xl px-4 py-8">
		<header class="mb-2 flex items-baseline justify-between gap-4">
			<h1 class="text-3xl font-bold tracking-tight" style="color: {C.ink};">Blunder trainer</h1>
			<a href="/review/stats" class="text-sm font-medium" style="color: {C.muted};">← Stats</a>
		</header>
		<p class="mb-6 max-w-2xl text-sm leading-relaxed" style="color: {C.body};">
			Every blunder you played, worst first, on a board. The move you played is highlighted; the
			arrow is the engine's better move. Step through with <kbd>←</kbd> / <kbd>→</kbd>, and
			<strong>Explain</strong> for a grounded breakdown of what went wrong.
		</p>

		{#if data.accounts.length === 0}
			<p style="color: {C.body};">
				No linked accounts. Link a chess.com account on the
				<a href="/review" class="underline">games page</a> first.
			</p>
		{:else if data.coverage.analyzed === 0}
			<p style="color: {C.body};">
				No analyzed games yet. Run <strong>Analyze remaining</strong> on the
				<a href="/review/stats" class="underline">stats page</a> first — blunders need per-move analysis.
			</p>
		{:else}
			<!-- Recency window (coarser scope) -->
			<div class="mb-3">
				<RecencyFilter bind:value={recency} />
			</div>

			<!-- Time-class filter -->
			<div class="segmented mb-4">
				{#each FILTERS as f (f)}
					<button class="seg {filter === f ? 'seg-on' : ''}" onclick={() => setFilter(f)}>
						{f === 'all' ? 'All' : cap(f)}
						<span class="seg-count">{countFor(f)}</span>
					</button>
				{/each}
			</div>

			{#if !current}
				<div class="card">
					<p class="muted">
						No blunders {filter === 'all' ? 'yet' : `in ${cap(filter)}`}. 🎯 Nothing to drill —
						switch the filter or go analyze more games.
					</p>
				</div>
			{:else}
				<section class="card">
					<!-- Header / readout -->
					<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-baseline gap-2">
							<span class="tier">Blunder</span>
							<span class="font-semibold" style="color: {C.ink};"
								>{clamped + 1} / {entries.length}</span
							>
							<span class="text-sm" style="color: {C.muted};"
								>· vs {current.opponent} · {short(current.playedAt)} · {current.phase}</span
							>
						</div>
						<a
							href="/review/{current.source}/{current.gameId}?orient={current.side === 'w'
								? 'white'
								: 'black'}&ply={current.ply}"
							class="text-sm font-medium"
							style="color: {C.rating};">Open in full replay →</a
						>
					</div>

					<div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_18rem]">
						<Board
							fen={current.fenBefore}
							selected={null}
							legalDestinations={[]}
							onSquareClick={() => {}}
							orientation={current.side === 'w' ? 'white' : 'black'}
							lastMove={uciSquares(current.uci)}
							opponentArrow={uciSquares(current.bestMoveUci)}
						/>

						<div class="flex flex-col gap-4">
							<div>
								<div class="eyebrow mb-1">Move {current.moveNumber}</div>
								<div class="text-2xl font-bold tabular-nums" style="color: {C.bad};">
									{current.san}
								</div>
							</div>

							<div>
								<div class="eyebrow mb-1">Win % swing (your POV)</div>
								<div class="text-lg font-semibold tabular-nums" style="color: {C.ink};">
									{Math.round(current.winBefore)}% →
									<span style="color: {C.bad};">{Math.round(current.winAfter)}%</span>
									<span class="text-sm" style="color: {C.muted};"
										>(−{Math.round(current.winBefore - current.winAfter)})</span
									>
								</div>
							</div>

							<div>
								<div class="eyebrow mb-1">Better</div>
								<div class="text-lg font-semibold tabular-nums" style="color: {C.good};">
									{current.bestMoveSan}
								</div>
							</div>

							{#if current.opening}
								<div>
									<div class="eyebrow mb-1">Opening</div>
									<div class="text-sm" style="color: {C.body};">{current.opening}</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Explain -->
					<div class="mt-4">
						{#if currentExplain?.text}
							<div class="explain">{currentExplain.text}</div>
						{:else if currentExplain?.loading}
							<button class="btn" disabled>
								Analyzing the position…{#if currentExplain.progress}
									({currentExplain.progress.done}/{currentExplain.progress.total}){/if}
							</button>
						{:else}
							<button class="btn" onclick={() => explain(current)}>Explain what went wrong</button>
							{#if currentExplain?.error}<span class="ml-2 text-xs" style="color: {C.bad};"
									>{currentExplain.error}</span
								>{/if}
						{/if}
					</div>

					<!-- Navigation -->
					<div class="mt-5 flex items-center justify-between">
						<button class="btn" disabled={clamped === 0} onclick={() => go(-1)}>◀ Prev</button>
						<span class="text-sm tabular-nums" style="color: {C.muted};"
							>{clamped + 1} / {entries.length}</span
						>
						<button class="btn" disabled={clamped >= entries.length - 1} onclick={() => go(1)}
							>Next ▶</button
						>
					</div>
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1.25rem;
		box-shadow: var(--shadow-1);
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted {
		font-size: 0.875rem;
		color: var(--text-muted);
	}
	kbd {
		border-radius: 0.3rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.05rem 0.35rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-2);
	}

	.segmented {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 9999px;
		background: var(--surface-2);
	}
	.seg {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9999px;
		padding: 0.4rem 0.95rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.seg-count {
		font-size: 0.7rem;
		font-weight: 500;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	.seg-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}

	.tier {
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: color-mix(in srgb, var(--bad) 16%, transparent);
		color: var(--bad);
	}

	.btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		transition: background var(--dur);
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.btn:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.explain {
		border-left: 3px solid var(--border-strong);
		padding: 0.25rem 0 0.25rem 0.85rem;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--text-2);
	}
</style>
