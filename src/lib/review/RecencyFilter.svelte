<script lang="ts">
	/**
	 * Shared recency-window control for the drilling pages. The selection is
	 * persisted in localStorage so it carries across blunders ↔ winnable — one
	 * mental model for "how far back do I care about".
	 */
	import { RECENCY_OPTIONS, type RecencyWindow } from '$lib/review/recency';

	let { value = $bindable() }: { value: RecencyWindow } = $props();

	const STORAGE_KEY = 'review:recency';

	// Restore the cross-page selection once, after mount (localStorage is browser-only).
	$effect(() => {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved && RECENCY_OPTIONS.some((o) => o.id === saved)) value = saved as RecencyWindow;
	});

	function pick(id: RecencyWindow) {
		value = id;
		localStorage.setItem(STORAGE_KEY, id);
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
		display: inline-flex;
		max-width: 100%;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 9999px;
		background: var(--surface-2);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.segmented::-webkit-scrollbar {
		display: none;
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
