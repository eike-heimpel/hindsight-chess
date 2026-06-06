<script lang="ts">
	import { C } from '$lib/review/charts/palette';
	import type { ReviewMove } from '$lib/review/types';

	/**
	 * The notation table — moves paired into numbered rows, each move a tap target
	 * that jumps the replay. A coloured dot (via `dotColor`) flags the move's
	 * quality once the game is analyzed. The active ply is highlighted.
	 */
	let {
		moves,
		activePly,
		dotColor,
		onSelect
	}: {
		moves: ReviewMove[];
		activePly: number;
		/** Quality colour for a ply, or null before the game is analyzed. */
		dotColor: (ply: number) => string | null;
		onSelect: (ply: number) => void;
	} = $props();

	type Pair = { no: number; white?: ReviewMove; black?: ReviewMove };
	const pairs = $derived.by(() => {
		const out: Pair[] = [];
		for (let i = 0; i < moves.length; i += 2) {
			out.push({ no: i / 2 + 1, white: moves[i], black: moves[i + 1] });
		}
		return out;
	});
</script>

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
						class="move {activePly === pair.white.ply ? 'move-active' : ''}"
						onclick={() => onSelect(pair.white!.ply)}
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
						class="move {activePly === pair.black.ply ? 'move-active' : ''}"
						onclick={() => onSelect(pair.black!.ply)}
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

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1rem;
		box-shadow: var(--shadow-1);
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
