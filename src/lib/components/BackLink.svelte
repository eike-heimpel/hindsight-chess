<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * `href` is a caller-supplied link (often carrying a runtime query string);
	 * resolve() doesn't apply cleanly and the route files already opt out. */

	/**
	 * The one back-affordance, used identically on every drill-down: a real
	 * thumb-sized target (≥44px on touch) at the top-left, never 13px muted text
	 * tucked in a corner. `label` is where you'd land ("Stats", "Games", "Home").
	 */
	let { href, label }: { href: string; label: string } = $props();
</script>

<a
	{href}
	class="back -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-text-muted transition-colors hover:text-text-2"
>
	<svg
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-3.5 w-3.5"
		aria-hidden="true"
	>
		<path d="M10 4 6 8l4 4" />
	</svg>
	{label}
</a>

<style>
	/* Touch gets the full 44px height; pointer devices keep it compact. */
	@media (pointer: coarse) {
		.back {
			min-height: 2.75rem;
		}
	}
</style>
