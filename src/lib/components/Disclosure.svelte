<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	/**
	 * A quiet show/hide control that remembers the user's choice. The learning
	 * screens (replay, blunder trainer) lead with words and tuck the SAN/number
	 * layer behind this; a power user who opens it once stays in "detail" mode.
	 *
	 * Same persistence shape as RecencyFilter: restore once on mount, write on
	 * change — NOT a $effect (a dependency-less effect would fight the parent's
	 * state on every re-run). See CLAUDE.md Svelte 5 rules.
	 */
	let {
		storageKey,
		showLabel,
		hideLabel = showLabel,
		open = $bindable(false),
		children
	}: {
		/** localStorage key. Share one key to keep "detail mode" consistent across screens. */
		storageKey: string;
		showLabel: string;
		hideLabel?: string;
		open?: boolean;
		children: Snippet;
	} = $props();

	onMount(() => {
		const saved = localStorage.getItem(storageKey);
		if (saved != null) open = saved === '1';
	});

	function toggle() {
		open = !open;
		localStorage.setItem(storageKey, open ? '1' : '0');
	}
</script>

<button type="button" class="toggle" aria-expanded={open} onclick={toggle}>
	<svg
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="chevron {open ? 'open' : ''}"
		aria-hidden="true"
	>
		<path d="M5 6l3 3 3-3" />
	</svg>
	{open ? hideLabel : showLabel}
</button>

{#if open}
	<div class="mt-3">{@render children()}</div>
{/if}

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 0.5rem;
		padding: 0.35rem 0.15rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-muted);
		transition: color var(--dur);
	}
	.toggle:hover {
		color: var(--text-2);
	}
	.chevron {
		height: 0.85rem;
		width: 0.85rem;
		transition: transform var(--dur) var(--ease);
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	@media (pointer: coarse) {
		.toggle {
			min-height: 2.75rem;
		}
	}
</style>
