<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Back link carries a runtime ?user query and the game URL is an external
	 * chess.com link; resolve() doesn't apply cleanly to either. */
	import { untrack } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import type { Square } from '$lib/chess/types';
	import type { ReviewMove } from '$lib/review/types';
	import { analyzeGame } from '$lib/client/reviewAnalysis';
	import { explainMove } from '$lib/client/reviewExplain';
	import { uciSquares, type GameAnalysis, type MoveAnalysis } from '$lib/review/analysis';
	import type { MoveClass } from '$lib/review/classify';
	import { C, CLASS_COLOR } from '$lib/review/charts/palette';
	import BackLink from '$lib/components/BackLink.svelte';
	import Disclosure from '$lib/components/Disclosure.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	const game = $derived(data.game);
	const moves = $derived(game.moves);
	const plyCount = $derived(moves.length);

	// These seed once from `data` (untrack = "capture the initial value on
	// purpose"): the page always mounts fresh per game — every in-app link to it
	// comes from another route (the games list, blunders, winnable), never
	// game→game on this route — so there's no stale state to reset. State changes
	// live in the event handlers below, never in an $effect that copies `data`
	// back into local state (a one-frame-stale antipattern).
	// ply 0 = start position; ply k = the position after move k.
	let ply = $state(untrack(() => data.initialPly));
	let orientation = $state<'white' | 'black'>(untrack(() => data.orientation));

	// Analysis: seeded from the cached server load, recomputed on demand in-browser.
	let analysis = $state<GameAnalysis | null>(untrack(() => data.analysis));
	let analyzing = $state(false);
	let progress = $state<{ done: number; total: number }>({ done: 0, total: 0 });
	let analyzeError = $state<string | null>(null);
	let cacheNote = $state<string | null>(null);

	// Per-ply LLM explanations, seeded from the cache and filled on demand.
	let explanations = $state<Record<number, string>>(untrack(() => data.explanations));
	let explaining = $state(false);
	let explainError = $state<string | null>(null);

	let fen = $derived(ply === 0 ? (moves[0]?.fenBefore ?? START_FEN) : moves[ply - 1].fenAfter);
	let lastMove = $derived.by(() => {
		if (ply === 0) return null;
		const uci = moves[ply - 1].uci;
		return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
	});

	function goTo(n: number) {
		ply = Math.max(0, Math.min(plyCount, n));
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			goTo(ply - 1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			goTo(ply + 1);
		} else if (e.key === 'Home') {
			goTo(0);
		} else if (e.key === 'End') {
			goTo(plyCount);
		}
	}

	function clockAt(color: 'w' | 'b'): string {
		for (let k = ply - 1; k >= 0; k--) {
			if (moves[k].color === color) return fmtClock(moves[k].clockMs);
		}
		return '—';
	}
	function fmtClock(ms?: number): string {
		if (ms == null) return '—';
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	type Pair = { no: number; white?: ReviewMove; black?: ReviewMove };
	const pairs = $derived.by(() => {
		const out: Pair[] = [];
		for (let i = 0; i < plyCount; i += 2) {
			out.push({ no: i / 2 + 1, white: moves[i], black: moves[i + 1] });
		}
		return out;
	});

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
	const resultLabel = $derived(
		game.result === '1-0' ? '1–0' : game.result === '0-1' ? '0–1' : '½–½'
	);

	const topPlayer = $derived(orientation === 'white' ? game.black : game.white);
	const bottomPlayer = $derived(orientation === 'white' ? game.white : game.black);
	const topColor = $derived<'w' | 'b'>(orientation === 'white' ? 'b' : 'w');
	const bottomColor = $derived<'w' | 'b'>(orientation === 'white' ? 'w' : 'b');

	function playerLine(p: { username: string; rating?: number }): string {
		return p.rating ? `${p.username} (${p.rating})` : p.username;
	}

	const analysisByPly = $derived.by(() => {
		const m: Record<number, MoveAnalysis> = {};
		if (analysis) for (const x of analysis.moves) m[x.ply] = x;
		return m;
	});

	// White-POV win% at the current ply, for the eval bar. The per-move win%s are
	// mover-POV, so a black move's winAfter is flipped back to white's perspective.
	const whiteWin = $derived.by(() => {
		if (!analysis) return null;
		if (ply === 0) return analysis.moves[0]?.winBefore ?? 50;
		const m = analysisByPly[ply];
		if (!m) return null;
		return m.color === 'w' ? m.winAfter : 100 - m.winAfter;
	});

	// Engine's best move in the position currently shown (= before the next move).
	const bestArrow = $derived.by(() => {
		const next = analysisByPly[ply + 1];
		if (!next?.bestMoveUci) return null;
		return uciSquares(next.bestMoveUci);
	});

	const CLASS_LABEL: Record<MoveClass, string> = {
		best: 'Best',
		good: 'Good',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
	function dotColor(p: number): string | null {
		const m = analysisByPly[p];
		return m ? CLASS_COLOR[m.classification] : null;
	}
	const currentMove = $derived.by(() => {
		if (ply < 1) return null;
		const m = analysisByPly[ply];
		if (!m) return null;
		return { ...m, san: moves[ply - 1]?.san ?? '' };
	});
	function accuracyFor(color: 'w' | 'b'): number | null {
		if (!analysis) return null;
		return color === 'w' ? analysis.accuracy.white : analysis.accuracy.black;
	}

	async function runAnalysis() {
		analyzing = true;
		analyzeError = null;
		cacheNote = null;
		progress = { done: 0, total: 0 };
		const result = await analyzeGame(game, (done, total) => (progress = { done, total }));
		analyzing = false;
		if (!result.ok) {
			analyzeError = result.error.message;
			return;
		}
		analysis = result.value.analysis;
		const res = await fetch('/api/review/analyze', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: result.value.analysis.source,
				gameId: result.value.analysis.gameId,
				depth: result.value.analysis.depth,
				evals: result.value.evals
			})
		});
		if (!res.ok) cacheNote = 'Analysis computed but could not be cached.';
	}

	async function runExplain() {
		explaining = true;
		explainError = null;
		const result = await explainMove(game, ply);
		explaining = false;
		if (!result.ok) {
			explainError = result.error.message;
			return;
		}
		explanations = { ...explanations, [ply]: result.value.text };
	}
</script>

<svelte:head><title>{game.white.username} vs {game.black.username}</title></svelte:head>
<svelte:window onkeydown={onKey} />

{#snippet ctrlIcon(kind: 'first' | 'prev' | 'next' | 'last' | 'flip')}
	<svg
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-4 w-4"
		aria-hidden="true"
	>
		{#if kind === 'first'}
			<path d="M5 4v8" /><path d="M11.5 4 7 8l4.5 4" />
		{:else if kind === 'prev'}
			<path d="M10 4 6 8l4 4" />
		{:else if kind === 'next'}
			<path d="M6 4l4 4-4 4" />
		{:else if kind === 'last'}
			<path d="M11 4v8" /><path d="M4.5 4 9 8l-4.5 4" />
		{:else if kind === 'flip'}
			<path d="M6 3v7M6 3 4.2 5M6 3 7.8 5" /><path d="M10 13V6M10 13 8.2 11M10 13 11.8 11" />
		{/if}
	</svg>
{/snippet}

<div class="min-h-dvh" style="background: var(--bg);">
	<main class="mx-auto max-w-6xl px-4 py-5">
		<header class="mb-4">
			<div class="mb-1">
				<BackLink href="/review{data.me ? `?user=${data.me}` : ''}" label="Games" />
			</div>
			<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h1 class="font-display text-2xl font-semibold tracking-tight" style="color: {C.ink};">
					{game.white.username}<span class="px-1.5 font-normal" style="color: {C.muted};">vs</span
					>{game.black.username}
					<span class="ml-1.5 text-lg font-semibold tabular-nums" style="color: {C.muted};"
						>{resultLabel}</span
					>
				</h1>
				{#if analysis}
					<span class="chip-meta">Analyzed · depth {analysis.depth}</span>
				{/if}
			</div>
			<p class="mt-0.5 text-sm" style="color: {C.muted};">
				{game.opening ?? 'Unknown opening'} · <span class="capitalize">{game.timeClass}</span>
				{game.timeControl} · {dateFmt.format(new Date(game.playedAt))}
				{#if game.url}
					· <a
						href={game.url}
						target="_blank"
						rel="noreferrer"
						class="underline-offset-2 hover:underline">chess.com ↗</a
					>
				{/if}
			</p>
		</header>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
			<!-- Board column -->
			<div>
				<div class="mx-auto w-full" style="max-width: min(54svh, 100%);">
					{@render playerRow(topPlayer, topColor, clockAt(topColor))}

					<div class="mt-1.5 flex gap-2">
						{#if whiteWin !== null}
							<div
								class="relative w-2.5 shrink-0 overflow-hidden rounded-full"
								style="background: var(--eval-black);"
								aria-hidden="true"
							>
								<div
									class="absolute inset-x-0 bottom-0 transition-[height] duration-200"
									style="height: {whiteWin}%; background: var(--eval-white);"
								></div>
								<div
									class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
									style="background: var(--eval-mid);"
								></div>
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<Board
								{fen}
								interactive={false}
								selected={null}
								legalDestinations={[]}
								{lastMove}
								opponentArrow={bestArrow}
								onSquareClick={() => {}}
								{orientation}
							/>
						</div>
					</div>

					<div class="mt-1.5">
						{@render playerRow(bottomPlayer, bottomColor, clockAt(bottomColor))}
					</div>

					<!-- Replay controls -->
					<div class="mt-3 flex items-center justify-center gap-2">
						<div class="ctrl-group">
							<button class="ctrl" onclick={() => goTo(0)} aria-label="First move"
								>{@render ctrlIcon('first')}</button
							>
							<button class="ctrl" onclick={() => goTo(ply - 1)} aria-label="Previous move"
								>{@render ctrlIcon('prev')}</button
							>
							<span class="ctrl-count tabular-nums">{ply} / {plyCount}</span>
							<button class="ctrl" onclick={() => goTo(ply + 1)} aria-label="Next move"
								>{@render ctrlIcon('next')}</button
							>
							<button class="ctrl" onclick={() => goTo(plyCount)} aria-label="Last move"
								>{@render ctrlIcon('last')}</button
							>
						</div>
						<button
							class="ctrl-solo"
							onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')}
							aria-label="Flip board">{@render ctrlIcon('flip')}</button
						>
					</div>
				</div>

				<!-- Move verdict + explanation -->
				{#if currentMove}
					{@const cc = CLASS_COLOR[currentMove.classification]}
					<div
						class="verdict mt-4"
						style="background: color-mix(in srgb, {cc} 10%, transparent); border-color: color-mix(in srgb, {cc} 22%, transparent);"
					>
						<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background: {cc};"
						></span>
						<span class="font-semibold" style="color: {cc};"
							>{CLASS_LABEL[currentMove.classification]}</span
						>
						<span class="text-sm" style="color: {C.body};">
							{currentMove.color === 'w' ? 'White' : 'Black'} played
							<strong style="color: {C.ink};">{currentMove.san}</strong>, best was
							<strong style="color: {C.ink};">{currentMove.bestMoveSan}</strong>
						</span>
					</div>
				{/if}

				{#if ply >= 1}
					<div class="card mt-3">
						{#if explanations[ply]}
							<div class="eyebrow mb-1.5">What happened</div>
							<p class="leading-relaxed whitespace-pre-line" style="color: {C.body};">
								{explanations[ply]}
							</p>
						{:else}
							<button class="btn w-full" onclick={runExplain} disabled={explaining}>
								{explaining ? 'Thinking…' : 'Explain this move'}
							</button>
							{#if explaining}
								<p class="mt-2 text-xs" style="color: {C.muted};">
									Running the engine on this position…
								</p>
							{/if}
							{#if explainError}
								<p class="mt-2 text-xs" style="color: {C.bad};">{explainError}</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Side panel: analyze CTA + move list -->
			<aside
				class="flex flex-col gap-3 lg:sticky lg:top-4"
				style="max-height: calc(100svh - 2rem);"
			>
				{#if !analysis}
					<div class="card">
						<button class="btn w-full" onclick={runAnalysis} disabled={analyzing}>
							{analyzing ? 'Analyzing…' : 'Analyze game'}
						</button>
						{#if analyzing}
							<div class="mt-3">
								<div
									class="h-1.5 w-full overflow-hidden rounded-full"
									style="background: {C.track};"
								>
									<div
										class="h-full rounded-full transition-[width] duration-150"
										style="width: {progress.total
											? (progress.done / progress.total) * 100
											: 0}%; background: {C.good};"
									></div>
								</div>
								<p class="mt-1.5 text-xs" style="color: {C.muted};">
									{progress.done} / {progress.total} positions
								</p>
							</div>
						{/if}
						{#if analyzeError}
							<p class="mt-2 text-xs" style="color: {C.bad};">{analyzeError}</p>
						{/if}
					</div>
				{:else if cacheNote}
					<div class="card py-2.5">
						<p class="text-xs" style="color: var(--warn);">{cacheNote}</p>
					</div>
				{/if}

				<!-- The notation table is the second layer: the transport controls under
				     the board drive navigation, so this only hides the move *list*, never
				     the ability to step through the game. Remembered across visits. -->
				<Disclosure
					storageKey="review:details"
					showLabel="Show the moves"
					hideLabel="Hide the moves"
				>
					<div class="card movelist max-h-[60svh] overflow-y-auto !p-1.5">
						<ol>
							{#each pairs as pair (pair.no)}
								{@const wColor = pair.white ? dotColor(pair.white.ply) : null}
								{@const bColor = pair.black ? dotColor(pair.black.ply) : null}
								<li class="grid grid-cols-[1.75rem_1fr_1fr] items-center">
									<span class="pr-1 text-right text-xs tabular-nums" style="color: {C.muted};"
										>{pair.no}.</span
									>
									{#if pair.white}
										<button
											class="move {ply === pair.white.ply ? 'move-active' : ''}"
											onclick={() => goTo(pair.white!.ply)}
										>
											{#if wColor}<span
													class="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
													style="background: {wColor};"
												></span>{/if}{pair.white.san}
										</button>
									{:else}
										<span></span>
									{/if}
									{#if pair.black}
										<button
											class="move {ply === pair.black.ply ? 'move-active' : ''}"
											onclick={() => goTo(pair.black!.ply)}
										>
											{#if bColor}<span
													class="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
													style="background: {bColor};"
												></span>{/if}{pair.black.san}
										</button>
									{:else}
										<span></span>
									{/if}
								</li>
							{/each}
						</ol>
					</div>
				</Disclosure>
			</aside>
		</div>
	</main>
</div>

{#snippet playerRow(p: { username: string; rating?: number }, color: 'w' | 'b', clock: string)}
	<div class="flex items-center justify-between gap-2">
		<span class="flex items-center gap-2">
			<span class="chip-color {color === 'w' ? 'chip-w' : 'chip-b'}"></span>
			<span class="text-sm font-semibold" style="color: {C.ink};">{playerLine(p)}</span>
			{#if accuracyFor(color) !== null}
				<span class="acc-badge tabular-nums">{accuracyFor(color)!.toFixed(1)}%</span>
			{/if}
		</span>
		<span class="text-sm tabular-nums" style="color: {C.muted};">{clock}</span>
	</div>
{/snippet}

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1rem;
		box-shadow: var(--shadow-1);
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.chip-meta {
		border-radius: 9999px;
		background: var(--surface-2);
		padding: 0.2rem 0.7rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-2);
	}

	.chip-color {
		display: inline-block;
		height: 0.8rem;
		width: 0.8rem;
		border-radius: 9999px;
		border: 1px solid var(--border-strong);
	}
	.chip-w {
		background: var(--piece-white);
	}
	.chip-b {
		background: var(--piece-black);
		border-color: var(--piece-black);
	}
	.acc-badge {
		border-radius: 9999px;
		background: var(--surface-2);
		padding: 0.05rem 0.45rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-2);
	}

	/* Replay controls — grouped pill + a solo flip button */
	.ctrl-group {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.2rem;
		box-shadow: var(--shadow-1);
	}
	.ctrl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		width: 2rem;
		border-radius: 9999px;
		color: var(--text-2);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.ctrl:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.ctrl:active {
		background: var(--surface-3);
	}
	.ctrl-count {
		min-width: 3.5rem;
		text-align: center;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-2);
	}
	.ctrl-solo {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.4rem;
		width: 2.4rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		color: var(--text-2);
		box-shadow: var(--shadow-1);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.ctrl-solo:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	/* Roomier tap targets on touch devices; desktop keeps the compact pill. */
	@media (pointer: coarse) {
		.ctrl {
			height: 2.5rem;
			width: 2.5rem;
		}
		.ctrl-solo {
			height: 2.75rem;
			width: 2.75rem;
		}
		.btn {
			min-height: 2.75rem;
		}
	}

	.verdict {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		border-radius: 0.85rem;
		border: 1px solid;
		padding: 0.7rem 0.95rem;
	}

	.btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.5rem 0.9rem;
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
		opacity: 0.6;
	}

	.movelist ol {
		font-size: 0.875rem;
	}
	.move {
		display: inline-flex;
		align-items: center;
		width: 100%;
		border-radius: 0.4rem;
		padding: 0.2rem 0.5rem;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		transition: background var(--dur-fast);
	}
	.move:hover {
		background: var(--surface-2);
	}
	/* Roomier move rows on touch — the desktop list is denser by design. */
	@media (pointer: coarse) {
		.move {
			min-height: 2.5rem;
			padding: 0.45rem 0.6rem;
		}
	}
	.move-active {
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}
</style>
