<script lang="ts">
	/**
	 * The vertical white-vs-black win% bar beside the board. White fills from the
	 * bottom, the hairline marks the 50% line. `pulse` hints that a live engine
	 * eval is still in flight (used by the explore branch).
	 */
	let { whiteWin, pulse = false }: { whiteWin: number | null; pulse?: boolean } = $props();
</script>

{#if whiteWin !== null}
	<div
		class="relative w-2.5 shrink-0 overflow-hidden rounded-full {pulse ? 'animate-pulse' : ''}"
		style="background: var(--eval-black);"
		aria-hidden="true"
	>
		<div
			class="absolute inset-x-0 bottom-0 transition-[height] duration-300"
			style="height: {whiteWin}%; background: var(--eval-white);"
		></div>
		<div
			class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
			style="background: var(--eval-mid);"
		></div>
	</div>
{/if}
