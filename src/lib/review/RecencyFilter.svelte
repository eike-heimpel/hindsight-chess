<script lang="ts">
	/**
	 * Shared recency-window control for the drilling pages. The selection is
	 * persisted in localStorage so it carries across blunders ↔ winnable — one
	 * mental model for "how far back do I care about".
	 */
	import { onMount } from 'svelte';
	import { RECENCY_OPTIONS, type RecencyWindow } from '$lib/review/recency';

	let {
		value = $bindable(),
		onChange
	}: { value: RecencyWindow; onChange?: (value: RecencyWindow) => void } = $props();

	const STORAGE_KEY = 'review:recency';

	// Restore the cross-page selection once (localStorage is browser-only). This is
	// a one-shot mount side effect, not a $effect — a $effect here has no real
	// reactive dependency and would write the bindable back into the parent on
	// every re-run, fighting the parent's own state.
	onMount(() => {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved && RECENCY_OPTIONS.some((o) => o.id === saved) && saved !== value) {
			value = saved as RecencyWindow;
			onChange?.(value);
		}
	});

	function pick(id: RecencyWindow) {
		value = id;
		localStorage.setItem(STORAGE_KEY, id);
		onChange?.(id);
	}
</script>

<div class="recency">
	<span class="eyebrow">Since</span>
	<div class="segmented">
		{#each RECENCY_OPTIONS as o (o.id)}
			<button class="seg {value === o.id ? 'seg-on' : ''}" onclick={() => pick(o.id)}
				>{o.label}</button
			>
		{/each}
	</div>
</div>

<style>
	.recency {
		display: flex;
		max-width: 100%;
		align-items: center;
		gap: 0.6rem;
	}
	.eyebrow {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.segmented {
		display: flex;
		min-width: 0;
		/* Wrap to a second row when the strip can't fit (≤~390px) rather than
		 * clipping the last window behind a hidden scroll — every option stays
		 * visible without a swipe. The pill radius reads as a rounded block when
		 * it wraps. */
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 1.25rem;
		background: var(--surface-2);
	}
	.seg {
		flex-shrink: 0;
		border-radius: 9999px;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.seg-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
</style>
