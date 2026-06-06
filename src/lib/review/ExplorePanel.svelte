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
	 */
	let {
		baseLabel,
		nodes,
		evaluating
	}: {
		baseLabel: string;
		nodes: ExploreNode[];
		evaluating: boolean;
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
</style>
