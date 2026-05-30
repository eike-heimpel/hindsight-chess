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
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #a8a29e;
	}
	.segmented {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 9999px;
		background: #f0eeec;
	}
	.seg {
		border-radius: 9999px;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #78716c;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.seg-on {
		background: #fff;
		color: #1c1917;
		box-shadow: 0 1px 3px rgb(28 25 23 / 0.12);
	}
</style>
