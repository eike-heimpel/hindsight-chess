<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EvalBar from '$lib/review/EvalBar.svelte';
	import MoveList from '$lib/review/MoveList.svelte';
	import MoveVerdict from '$lib/review/MoveVerdict.svelte';
	import CoachConversation from '$lib/review/coach/CoachConversation.svelte';
	import CoachPanel from '$lib/review/coach/CoachPanel.svelte';
	import { createExploreLine } from '$lib/client/exploreLine.svelte';
	import { createCoachThread } from '$lib/client/coachThread.svelte';
	import { selectTurningPoints } from '$lib/review/coach/moments';
	import { uciSquares, type GameAnalysis, type MoveAnalysis } from '$lib/review/analysis';
	import { CLASS_COLOR } from '$lib/review/charts/palette';
	import type { Side } from '$lib/chess/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	// The page mounts fresh per game (every link in is cross-route), so these
	// seed once from `data` — no $effect copying data→state. ply 0 = start.
	const game = untrack(() => data.game);
	const moves = game.moves;
	const plyCount = moves.length;
	const analysis: GameAnalysis | null = untrack(() => data.analysis);

	let ply = $state(untrack(() => data.initialPly));
	let orientation = $state<'white' | 'black'>(untrack(() => data.orientation));

	// Guided ⇄ Explore. Seeded to 'A'; the stored preference is read in onMount
	// (a one-shot browser read belongs there, not in a data→state effect).
	let variant = $state<'A' | 'B'>('A');
	const VARIANT_KEY = 'coach:variant';
	onMount(() => {
		const saved = localStorage.getItem(VARIANT_KEY);
		if (saved === 'A' || saved === 'B') variant = saved;
	});
	function toggleVariant() {
		variant = variant === 'A' ? 'B' : 'A';
		localStorage.setItem(VARIANT_KEY, variant);
		// Switching coaching style is a mode change — drop any open conversation so
		// the next "Talk about this move" runs the freshly-built thread's opener.
		if (thread.currentPly !== null) thread.finish();
	}

	// The coached side — derived from the board orientation the loader resolved
	// for `me` (white-on-bottom ⇒ we're White).
	const side = $derived<Side>(orientation === 'white' ? 'w' : 'b');

	// Variant B markers: the auto-flagged turning points over the cached analysis.
	const moments = $derived(analysis ? selectTurningPoints(analysis, game, side) : []);
	const momentPlies = $derived(new Set(moments.map((m) => m.ply)));
	const momentBarPips = $derived(
		moments
			.map((m) => analysis?.moves[m.ply - 1])
			.filter((x): x is MoveAnalysis => !!x)
			.map((x) => ({ at: x.color === 'w' ? x.winAfter : 100 - x.winAfter }))
	);

	// Variant B routes the coach's show-line playback through a disposable explore
	// branch (takeover-able); variant A plays frames inside the thread. The thread
	// captures `variant` for its opener, so it's rebuilt when the style toggles —
	// `toggleVariant` finishes any open conversation first, so nothing is lost.
	const explore = createExploreLine();
	const thread = $derived(createCoachThread({ game, analysis, variant, explore }));

	const active = $derived(thread.currentPly !== null);

	// --- replay nav (when no move is open for discussion) ---------------------
	let fen = $derived(ply === 0 ? (moves[0]?.fenBefore ?? START_FEN) : moves[ply - 1].fenAfter);
	let lastMove = $derived.by(() => {
		if (ply === 0) return null;
		return uciSquares(moves[ply - 1].uci);
	});

	const analysisByPly = $derived.by(() => {
		const m: Record<number, MoveAnalysis> = {};
		if (analysis) for (const x of analysis.moves) m[x.ply] = x;
		return m;
	});
	const whiteWin = $derived.by(() => {
		if (!analysis) return null;
		if (ply === 0) return analysis.moves[0]?.winBefore ?? 50;
		const m = analysisByPly[ply];
		if (!m) return null;
		return m.color === 'w' ? m.winAfter : 100 - m.winAfter;
	});
	const bestArrow = $derived.by(() => {
		const m = analysisByPly[ply];
		return m?.bestMoveUci ? uciSquares(m.bestMoveUci) : null;
	});
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

	function goTo(n: number) {
		if (explore.active) explore.exit();
		if (active) thread.finish();
		ply = Math.max(0, Math.min(plyCount, n));
	}
	function onKey(e: KeyboardEvent) {
		if (active || explore.active) return; // the panel owns input while discussing
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

	// The board, eval bar and arrow read from explore > thread > replay.
	const boardFen = $derived(explore.active ? explore.currentFen : active ? thread.boardFen : fen);
	const boardLast = $derived(
		explore.active ? explore.lastMove : active ? thread.boardLast : lastMove
	);
	const boardArrow = $derived(
		explore.active ? explore.bestArrow : active ? thread.boardArrow : bestArrow
	);
	const boardWhiteWin = $derived(
		explore.active ? explore.whiteWin : active ? thread.whiteWin : whiteWin
	);
</script>

<svelte:head><title>Coach · {game.white.username} vs {game.black.username}</title></svelte:head>
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

<div class="min-h-dvh" style="background: var(--bg); padding-bottom: env(safe-area-inset-bottom);">
	<main class="mx-auto max-w-6xl px-4 py-5">
		<PageHeader
			title="Coach"
			back={{ href: `/review/coach${data.me ? `?user=${data.me}` : ''}`, label: 'Games' }}
		>
			{#snippet actions()}
				<button
					class="toggle"
					onclick={toggleVariant}
					aria-label="Switch coaching style"
					title="Guided talks first; Explore waits for your read"
				>
					<span class:on={variant === 'A'}>Guided</span>
					<span class="sep">⇄</span>
					<span class:on={variant === 'B'}>Explore</span>
				</button>
			{/snippet}
			<p class="mt-0.5 text-sm text-text-muted">
				{game.white.username} vs {game.black.username} · {game.opening ?? 'Unknown opening'}
			</p>
		</PageHeader>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<!-- Board column -->
			<div>
				<div class="mx-auto w-full" style="max-width: min(54svh, 100%);">
					<div class="flex gap-2">
						<EvalBar
							whiteWin={boardWhiteWin}
							pulse={thread.evaluating || explore.evaluating}
							moments={variant === 'B' && !active ? momentBarPips : undefined}
						/>
						<div class="relative min-w-0 flex-1">
							<Board
								fen={boardFen}
								interactive={explore.active}
								selected={explore.active ? explore.selected : null}
								legalDestinations={explore.active ? explore.legalDests : []}
								lastMove={boardLast}
								opponentArrow={boardArrow}
								onSquareClick={explore.active ? explore.onSquareClick : () => {}}
								{orientation}
							/>
						</div>
					</div>

					<!-- Replay controls (hidden while a move is being discussed). -->
					<div class="mt-3 flex items-center justify-center gap-2">
						{#if explore.active}
							<div class="ctrl-group">
								<button
									class="ctrl"
									onclick={() => explore.undo()}
									disabled={explore.nodes.length === 0}
									aria-label="Take back">{@render ctrlIcon('prev')}</button
								>
								<button class="branch-return" onclick={() => explore.exit()}>Return to game</button>
							</div>
						{:else if !active}
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
						{/if}
						<button
							class="ctrl-solo"
							onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')}
							aria-label="Flip board">{@render ctrlIcon('flip')}</button
						>
					</div>

					<!-- "Talk about this move" — opens the thread on the current ply. -->
					{#if !active && !explore.active && ply >= 1}
						<div class="mt-2 flex justify-center">
							<button class="branch-enter" onclick={() => thread.open(ply)}>
								Talk about this move ↪
							</button>
						</div>
					{/if}
				</div>

				{#if currentMove && !active && !explore.active}
					<div class="mt-4">
						<MoveVerdict
							classification={currentMove.classification}
							mover={currentMove.color}
							san={currentMove.san}
							bestSan={currentMove.bestMoveSan}
						/>
					</div>
				{/if}
			</div>

			<!-- Side panel: the coach conversation, or the move list when idle. -->
			<aside class="flex flex-col gap-3 lg:sticky lg:top-4">
				{#if active}
					{#key thread.currentPly}
						{#if variant === 'A'}
							<CoachConversation {thread} />
						{:else}
							<CoachPanel {thread} />
						{/if}
					{/key}
				{:else}
					{#if !analysis}
						<p class="text-sm text-text-muted">
							This game isn't analyzed yet — open it from Review to run the engine first.
						</p>
					{/if}
					<MoveList
						{moves}
						activePly={ply}
						{dotColor}
						onSelect={goTo}
						momentPlies={variant === 'B' ? momentPlies : undefined}
					/>
				{/if}
			</aside>
		</div>
	</main>
</div>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.toggle .on {
		color: var(--text);
	}
	.toggle .sep {
		color: var(--text-muted);
	}

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
	.branch-return {
		border-radius: 9999px;
		padding: 0 0.85rem;
		height: 2rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.branch-return:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	/* Roomier tap targets on touch (CLAUDE.md mobile rule). */
	@media (pointer: coarse) {
		.ctrl {
			height: 2.5rem;
			width: 2.5rem;
		}
		.ctrl-solo {
			height: 2.75rem;
			width: 2.75rem;
		}
		.toggle,
		.branch-enter {
			min-height: 2.75rem;
		}
		.branch-return {
			height: 2.5rem;
		}
	}
</style>
