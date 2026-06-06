<script lang="ts">
	import { C, CLASS_COLOR } from '$lib/review/charts/palette';
	import MoveVerdict from '$lib/review/MoveVerdict.svelte';
	import type { ExploreNode } from '$lib/client/exploreLine.svelte';

	/**
	 * The companion panel for the "play it out from here" branch: a banner that
	 * keeps it honest ("this isn't the real game"), the line you've played as
	 * quality-coloured SAN chips, and a verdict on your last move. The board's
	 * live arrow already shows the engine's preferred move, so the verdict here
	 * deliberately omits a "best was".
	 *
	 * Once at least one move is played the line can be KEPT: starred, or handed to
	 * the coach as a "what if I'd played this" conversation anchored to the branch.
	 */
	let {
		baseLabel,
		nodes,
		evaluating,
		starred,
		onStar,
		onTalk
	}: {
		baseLabel: string;
		nodes: ExploreNode[];
		evaluating: boolean;
		starred: boolean;
		onStar: () => void;
		onTalk: () => void;
	} = $props();

	const last = $derived(nodes.at(-1) ?? null);
</script>

<div class="banner mt-4">
	<span class="text-sm" style="color: {C.body};">
		Exploring from <strong style="color: {C.ink};">{baseLabel}</strong> — your own line, not the game.
	</span>
</div>

{#if nodes.length}
	<div class="mt-3 flex flex-wrap gap-1.5">
		{#each nodes as node, i (i)}
			{@const cc = node.classification ? CLASS_COLOR[node.classification] : null}
			<span
				class="chip"
				style={cc ? `border-color: color-mix(in srgb, ${cc} 45%, transparent);` : ''}
			>
				{#if cc}<span
						class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
						style="background: {cc};"
					></span>{/if}{node.san}
			</span>
		{/each}
	</div>
{:else}
	<p class="mt-3 text-sm" style="color: {C.muted};">
		Make a move for either side — the bar and the arrow update as you go.
	</p>
{/if}

{#if last && last.classification}
	<div class="mt-3">
		<MoveVerdict classification={last.classification} mover={last.color} san={last.san} />
	</div>
{:else if last && evaluating}
	<p class="mt-3 text-xs" style="color: {C.muted};">Weighing your move…</p>
{/if}

<!-- Keep this line: star it, or talk the last move through with the coach. Only
     once a move has been played (an empty branch has nothing to keep). -->
{#if nodes.length}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<button
			class="keep-btn {starred ? 'keep-on' : ''}"
			aria-pressed={starred}
			title={starred ? 'Remove star' : 'Star this line'}
			onclick={onStar}>★ Star line</button
		>
		<button class="keep-btn talk" onclick={onTalk}>Talk through this move ↪</button>
	</div>
{/if}

<style>
	.banner {
		border-radius: 0.85rem;
		border: 1px dashed var(--border-strong);
		background: var(--surface-1);
		padding: 0.7rem 0.95rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.2rem 0.6rem;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.keep-btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.45rem 0.8rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.keep-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.keep-btn.keep-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
	.keep-btn.talk {
		background: var(--brand);
		border-color: transparent;
		color: var(--bg);
	}
	.keep-btn.talk:hover {
		filter: brightness(1.05);
		background: var(--brand);
		color: var(--bg);
	}
	@media (pointer: coarse) {
		.keep-btn {
			min-height: 2.75rem;
		}
	}
</style>
