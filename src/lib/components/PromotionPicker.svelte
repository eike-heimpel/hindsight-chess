<script lang="ts">
	/**
	 * Promotion chooser overlaid on the board: the four pieces in the promoting
	 * colour. Tapping a piece resolves the move; tapping the dimmed backdrop
	 * cancels. Fills its `relative` parent (the board wrapper).
	 */
	type Piece = 'q' | 'r' | 'b' | 'n';

	let {
		color,
		onSelect,
		onCancel
	}: {
		color: 'w' | 'b';
		onSelect: (piece: Piece) => void;
		onCancel: () => void;
	} = $props();

	const PIECES: { piece: Piece; code: string }[] = [
		{ piece: 'q', code: 'Q' },
		{ piece: 'r', code: 'R' },
		{ piece: 'b', code: 'B' },
		{ piece: 'n', code: 'N' }
	];
</script>

<div class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl">
	<!-- Dim backdrop as a sibling (not an ancestor) of the piece buttons, so we
	     never nest interactive elements. -->
	<button
		type="button"
		class="absolute inset-0 rounded-2xl"
		style="background: color-mix(in srgb, var(--bg) 70%, transparent);"
		aria-label="Cancel promotion"
		onclick={onCancel}
	></button>
	<div
		class="relative flex gap-1.5 rounded-2xl p-2"
		style="background: var(--surface-1); border: 1px solid var(--border); box-shadow: var(--shadow-1);"
	>
		{#each PIECES as { piece, code } (piece)}
			<button
				type="button"
				class="promo-piece"
				onclick={() => onSelect(piece)}
				aria-label="Promote to {code}"
			>
				<img src="/pieces/{color}{code}.svg" alt={code} draggable="false" />
			</button>
		{/each}
	</div>
</div>

<style>
	.promo-piece {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 3rem;
		width: 3rem;
		border-radius: 0.6rem;
		transition: background var(--dur-fast);
	}
	.promo-piece:hover {
		background: var(--surface-2);
	}
	.promo-piece img {
		height: 84%;
		width: 84%;
	}
</style>
