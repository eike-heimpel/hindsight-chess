<script lang="ts">
	import type { Snippet } from 'svelte';
	import BackLink from './BackLink.svelte';

	/**
	 * Shared page header for the review/account drill-downs. One serif title (the
	 * brand voice carried down into the depth), the one shared back-affordance
	 * above it, and optional right-aligned actions / a meta line below. Keeps every
	 * screen reading as one place rather than a set of hand-rolled headers.
	 */
	let {
		title,
		back,
		actions,
		children
	}: {
		title: string;
		/** Where "back" lands. Omit on top-of-stack pages. */
		back?: { href: string; label: string };
		/** Right-aligned links/controls on the title row. */
		actions?: Snippet;
		/** A meta/subtitle line rendered under the title row. */
		children?: Snippet;
	} = $props();
</script>

<header class="mb-6">
	{#if back}
		<div class="mb-1">
			<BackLink href={back.href} label={back.label} />
		</div>
	{/if}
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h1 class="font-display text-2xl font-semibold tracking-tight text-text sm:text-3xl">
			{title}
		</h1>
		{#if actions}
			<nav class="flex items-center gap-4 text-sm">{@render actions()}</nav>
		{/if}
	</div>
	{#if children}{@render children()}{/if}
</header>
