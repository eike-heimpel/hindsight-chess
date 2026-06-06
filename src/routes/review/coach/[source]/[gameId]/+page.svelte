<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import Board from '$lib/components/Board.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EvalBar from '$lib/review/EvalBar.svelte';
	import MoveList from '$lib/review/MoveList.svelte';
	import MoveVerdict from '$lib/review/MoveVerdict.svelte';
	import ReplayControls from '$lib/components/ReplayControls.svelte';
	import CoachConversation from '$lib/review/coach/CoachConversation.svelte';
	import CoachPanel from '$lib/review/coach/CoachPanel.svelte';
	import { createExploreLine } from '$lib/client/exploreLine.svelte';
	import { createCoachThread } from '$lib/client/coachThread.svelte';
	import { selectTurningPoints } from '$lib/review/coach/moments';
	import { uciSquares, type GameAnalysis, type MoveAnalysis } from '$lib/review/analysis';
	import {
		indexByPly,
		whiteWinAt,
		bestArrowAt,
		dotColorAt,
		currentMoveAt
	} from '$lib/review/replayView';
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
		if ((saved === 'A' || saved === 'B') && saved !== variant) {
			variant = saved;
			thread = makeThread(); // rebuild so the opener matches the restored style
		}
	});
	function toggleVariant() {
		variant = variant === 'A' ? 'B' : 'A';
		localStorage.setItem(VARIANT_KEY, variant);
		// Switching coaching style is a mode change — rebuild the thread so the next
		// "Talk about this move" runs the new style's opener. Reassigning closes any
		// open conversation (currentPly resets to null), which is the intent.
		thread = makeThread();
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
	// captures `variant` for its opener, so switching style rebuilds it — done in
	// the event handler that changes the mode (toggleVariant / the onMount read),
	// never via an $effect/$derived that recreates a stateful rune object.
	const explore = createExploreLine();
	const makeThread = () => createCoachThread({ game, analysis, variant, explore });
	let thread = $state(makeThread());

	const active = $derived(thread.currentPly !== null);

	// --- replay nav (when no move is open for discussion) ---------------------
	let fen = $derived(ply === 0 ? (moves[0]?.fenBefore ?? START_FEN) : moves[ply - 1].fenAfter);
	let lastMove = $derived.by(() => {
		if (ply === 0) return null;
		return uciSquares(moves[ply - 1].uci);
	});

	// Per-ply view derivations (shared with the review board — see replayView.ts).
	const analysisByPly = $derived(indexByPly(analysis));
	const whiteWin = $derived(whiteWinAt(analysis, analysisByPly, ply));
	const bestArrow = $derived(bestArrowAt(analysisByPly, ply));
	function dotColor(p: number): string | null {
		return dotColorAt(analysisByPly, p);
	}
	const currentMove = $derived(currentMoveAt(analysisByPly, moves, ply));

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
				<div class="mx-auto w-full" style="max-width: min(66svh, 40rem, 100%);">
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

					<ReplayControls
						{ply}
						{plyCount}
						{goTo}
						onFlip={() => (orientation = orientation === 'white' ? 'black' : 'white')}
						exploring={explore.active}
						canUndo={explore.nodes.length > 0}
						onUndo={() => explore.undo()}
						onExitExplore={() => explore.exit()}
						navHidden={active}
					/>

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

	/* Roomier tap targets on touch (CLAUDE.md mobile rule). */
	@media (pointer: coarse) {
		.toggle,
		.branch-enter {
			min-height: 2.75rem;
		}
	}
</style>
