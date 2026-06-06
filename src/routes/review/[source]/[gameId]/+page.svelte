<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Back link carries a runtime ?user query and the game URL is an external
	 * chess.com link; resolve() doesn't apply cleanly to either. */
	import { untrack } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import type { Square } from '$lib/chess/types';
	import { analyzeGame } from '$lib/client/reviewAnalysis';
	import { explainMove } from '$lib/client/reviewExplain';
	import { createExploreLine } from '$lib/client/exploreLine.svelte';
	import { type GameAnalysis } from '$lib/review/analysis';
	import { C } from '$lib/review/charts/palette';
	import {
		indexByPly,
		whiteWinAt,
		bestArrowAt,
		dotColorAt,
		currentMoveAt
	} from '$lib/review/replayView';
	import BackLink from '$lib/components/BackLink.svelte';
	import Disclosure from '$lib/components/Disclosure.svelte';
	import PromotionPicker from '$lib/components/PromotionPicker.svelte';
	import ReplayControls from '$lib/components/ReplayControls.svelte';
	import EvalBar from '$lib/review/EvalBar.svelte';
	import MoveVerdict from '$lib/review/MoveVerdict.svelte';
	import MoveList from '$lib/review/MoveList.svelte';
	import ExplorePanel from '$lib/review/ExplorePanel.svelte';
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
		if (explore.active) explore.exit(); // leaving the branch returns to the game
		ply = Math.max(0, Math.min(plyCount, n));
	}
	function onKey(e: KeyboardEvent) {
		if (explore.active) {
			// In the branch, arrows take back / play the engine's move; no game nav.
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				explore.undo();
			}
			return;
		}
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

	// Per-ply view derivations (shared with the coach board — see replayView.ts).
	// The better move arrow is shown alongside the actual move (highlighted via
	// `lastMove`) so you see both on one screen, matching the verdict below.
	const analysisByPly = $derived(indexByPly(analysis));
	const whiteWin = $derived(whiteWinAt(analysis, analysisByPly, ply));
	const bestArrow = $derived(bestArrowAt(analysisByPly, ply));
	function dotColor(p: number): string | null {
		return dotColorAt(analysisByPly, p);
	}
	const currentMove = $derived(currentMoveAt(analysisByPly, moves, ply));
	function accuracyFor(color: 'w' | 'b'): number | null {
		if (!analysis) return null;
		return color === 'w' ? analysis.accuracy.white : analysis.accuracy.black;
	}

	// "Play it out from here" — a disposable branch with its own live engine
	// readout. While active it drives the board; the game's replay is untouched
	// and one tap on "Return to game" (or any game-nav action) restores it.
	const explore = createExploreLine();

	function moveLabel(p: number): string {
		if (p === 0) return 'the starting position';
		const n = Math.ceil(p / 2);
		return `${n}${p % 2 === 1 ? '.' : '…'} ${moves[p - 1].san}`;
	}

	// The board, eval bar and best-move arrow read from the branch while it's
	// active, otherwise from the replay.
	const boardFen = $derived(explore.active ? explore.currentFen : fen);
	const boardLastMove = $derived(explore.active ? explore.lastMove : lastMove);
	const boardArrow = $derived(explore.active ? explore.bestArrow : bestArrow);
	const boardWhiteWin = $derived(explore.active ? explore.whiteWin : whiteWin);

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
				<div class="mx-auto w-full" style="max-width: min(66svh, 40rem, 100%);">
					{@render playerRow(topPlayer, topColor, clockAt(topColor))}

					<div class="mt-1.5 flex gap-2">
						<EvalBar whiteWin={boardWhiteWin} pulse={explore.evaluating} />
						<div class="relative min-w-0 flex-1">
							<Board
								fen={boardFen}
								interactive={explore.active}
								selected={explore.active ? explore.selected : null}
								legalDestinations={explore.active ? explore.legalDests : []}
								lastMove={boardLastMove}
								opponentArrow={boardArrow}
								onSquareClick={explore.active ? explore.onSquareClick : () => {}}
								{orientation}
							/>
							{#if explore.pendingPromotion}
								<PromotionPicker
									color={explore.promotionColor === 'w' ? 'w' : 'b'}
									onSelect={(piece) => explore.completePromotion(piece)}
									onCancel={() => explore.cancelPromotion()}
								/>
							{/if}
						</div>
					</div>

					<div class="mt-1.5">
						{@render playerRow(bottomPlayer, bottomColor, clockAt(bottomColor))}
					</div>

					<ReplayControls
						{ply}
						{plyCount}
						{goTo}
						onFlip={() => (orientation = orientation === 'white' ? 'black' : 'white')}
						exploring={explore.active}
						canUndo={explore.nodes.length > 0}
						onUndo={() => explore.undo()}
						onExitExplore={() => explore.exit()}
					/>

					{#if !explore.active}
						<div class="mt-2 flex justify-center">
							<button class="branch-enter" onclick={() => explore.enter(fen, moveLabel(ply))}>
								Play it out from here ↪
							</button>
						</div>
					{/if}
				</div>

				<!-- Move verdict + explanation — the branch panel takes over while exploring -->
				{#if explore.active}
					<ExplorePanel
						baseLabel={explore.baseLabel}
						nodes={explore.nodes}
						evaluating={explore.evaluating}
					/>
				{:else if currentMove}
					<div class="mt-4">
						<MoveVerdict
							classification={currentMove.classification}
							mover={currentMove.color}
							san={currentMove.san}
							bestSan={currentMove.bestMoveSan}
						/>
					</div>
				{/if}

				{#if ply >= 1 && !explore.active}
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
					<MoveList {moves} activePly={ply} {dotColor} onSelect={goTo} />
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

	/* Branch affordance — the quiet "play it out" entry below the controls. */
	.branch-enter {
		border-radius: 9999px;
		padding: 0.35rem 0.85rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.branch-enter:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	@media (pointer: coarse) {
		.branch-enter,
		.btn {
			min-height: 2.75rem;
		}
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
</style>
