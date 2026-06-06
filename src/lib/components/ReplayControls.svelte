<script lang="ts">
	// Transport controls under the review board. A wide Prev/Next rocker is the
	// dominant, hard-to-miss target; the rare jumps (first/last) sit apart as flat
	// end-caps; the counter + flip ride a top line, off the stepping path. The
	// whole bar swaps for branch controls while a line is being explored.
	interface Props {
		ply: number;
		plyCount: number;
		goTo: (n: number) => void;
		onFlip: () => void;
		exploring?: boolean;
		canUndo?: boolean;
		onUndo?: () => void;
		onExitExplore?: () => void;
		/** Coach only: while a move is being discussed, hide the stepper, keep flip. */
		navHidden?: boolean;
	}
	let {
		ply,
		plyCount,
		goTo,
		onFlip,
		exploring = false,
		canUndo = false,
		onUndo,
		onExitExplore,
		navHidden = false
	}: Props = $props();
</script>

{#snippet icon(kind: 'first' | 'prev' | 'next' | 'last' | 'flip')}
	<svg
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if kind === 'first'}
			<path d="M5 4v8" /><path d="M11.5 4 7 8l4.5 4" />
		{:else if kind === 'prev'}
			<path d="M10 4 6 8l4 4" />
		{:else if kind === 'next'}
			<path d="M6 4l4 4-4 4" />
		{:else if kind === 'last'}
			<path d="M11 4v8" /><path d="M4.5 4 9 8l-4.5 4" />
		{:else if kind === 'flip'}
			<path d="M6 3v7M6 3 4.2 5M6 3 7.8 5" /><path d="M10 13V6M10 13 8.2 11M10 13 11.8 11" />
		{/if}
	</svg>
{/snippet}

{#snippet flip()}
	<button class="flip-btn" onclick={onFlip} aria-label="Flip board">{@render icon('flip')}</button>
{/snippet}

<div class="replay">
	{#if exploring}
		<div class="replay-branch">
			<button class="endcap" onclick={onUndo} disabled={!canUndo} aria-label="Take back">
				{@render icon('prev')}
			</button>
			<button class="branch-return" onclick={onExitExplore}>Return to game</button>
			{@render flip()}
		</div>
	{:else if navHidden}
		<div class="replay-top">{@render flip()}</div>
	{:else}
		<div class="replay-top">
			<span class="replay-count tabular-nums">{ply} / {plyCount}</span>
			{@render flip()}
		</div>
		<div class="replay-row">
			<button
				class="endcap"
				onclick={() => goTo(0)}
				disabled={ply === 0}
				aria-label="Jump to first move">{@render icon('first')}</button
			>
			<div class="rocker" role="group" aria-label="Step through moves">
				<button
					class="rocker-half"
					onclick={() => goTo(ply - 1)}
					disabled={ply === 0}
					aria-label="Previous move"
				>
					{@render icon('prev')}<span class="rocker-label">Prev</span>
				</button>
				<span class="rocker-seam" aria-hidden="true"></span>
				<button
					class="rocker-half"
					onclick={() => goTo(ply + 1)}
					disabled={ply === plyCount}
					aria-label="Next move"
				>
					<span class="rocker-label">Next</span>{@render icon('next')}
				</button>
			</div>
			<button
				class="endcap"
				onclick={() => goTo(plyCount)}
				disabled={ply === plyCount}
				aria-label="Jump to last move">{@render icon('last')}</button
			>
		</div>
	{/if}
</div>

<style>
	.replay {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		/* Kill the 300ms double-tap-to-zoom gesture that swallowed rapid taps. */
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
		padding-bottom: env(safe-area-inset-bottom);
	}

	/* Top line: counter centered, flip parked on the right — off the step path. */
	.replay-top {
		display: grid;
		grid-template-columns: 2.75rem 1fr 2.75rem;
		align-items: center;
		min-height: 2rem;
	}
	.replay-count {
		grid-column: 2;
		text-align: center;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--text-muted);
	}
	.flip-btn {
		grid-column: 3;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.4rem;
		width: 2.4rem;
		border-radius: 9999px;
		color: var(--text-muted);
		touch-action: manipulation;
		transition:
			color var(--dur-fast),
			background var(--dur-fast);
	}
	.flip-btn:hover {
		color: var(--text-2);
		background: var(--surface-1);
	}

	/* Step row: flat end-caps held a hard gap away from the dominant rocker, so a
	   thumb aiming at Next can never land on the destructive jump-to-end. */
	.replay-row {
		display: flex;
		align-items: stretch;
		gap: 0.75rem;
	}
	.endcap {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		border-radius: 0.75rem;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		touch-action: manipulation;
		transition:
			color var(--dur-fast),
			background var(--dur-fast),
			border-color var(--dur-fast),
			opacity var(--dur-fast);
	}
	.endcap:hover:not(:disabled) {
		color: var(--text-2);
		background: var(--surface-1);
		border-color: var(--border-strong);
	}
	.endcap:active:not(:disabled) {
		background: var(--surface-2);
	}

	.rocker {
		flex: 1 1 auto;
		display: flex;
		align-items: stretch;
		min-width: 0;
		min-height: 3.25rem;
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		box-shadow: var(--shadow-1);
		overflow: hidden;
	}
	.rocker-half {
		flex: 1 1 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-width: 0;
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		touch-action: manipulation;
		transition:
			background var(--dur-fast),
			color var(--dur-fast),
			opacity var(--dur-fast);
	}
	.rocker-half:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.rocker-half:active:not(:disabled) {
		background: var(--surface-3);
	}
	.rocker-seam {
		flex: 0 0 1px;
		align-self: stretch;
		margin: 0.55rem 0;
		background: var(--border);
	}

	.endcap:disabled,
	.rocker-half:disabled {
		opacity: 0.32;
		cursor: default;
	}

	/* Explore-mode branch row. */
	.replay-branch {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.branch-return {
		border-radius: 9999px;
		padding: 0 1rem;
		height: 2.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-2);
		border: 1px solid var(--border);
		background: var(--surface-1);
		box-shadow: var(--shadow-1);
		touch-action: manipulation;
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}
	.branch-return:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.endcap :global(svg),
	.flip-btn :global(svg) {
		height: 1rem;
		width: 1rem;
	}
	.rocker-half :global(svg) {
		height: 1.1rem;
		width: 1.1rem;
	}

	/* Desktop: keyboard arrows lead, so the bar is calmer, tighter, capped + centered. */
	@media (pointer: fine) {
		.replay {
			max-width: 24rem;
			margin-inline: auto;
		}
		.rocker {
			min-height: 2.5rem;
		}
		.rocker-half {
			font-size: 0.82rem;
		}
		.endcap {
			width: 2.25rem;
		}
		.flip-btn {
			height: 2.1rem;
			width: 2.1rem;
		}
		.branch-return {
			height: 2.1rem;
		}
	}

	/* Touch: clear the 44px target rule with room to spare. */
	@media (pointer: coarse) {
		.endcap {
			width: 2.75rem;
			min-height: 2.75rem;
		}
		.rocker {
			min-height: 3.5rem;
		}
		.flip-btn {
			height: 2.75rem;
			width: 2.75rem;
		}
		.branch-return {
			height: 2.75rem;
		}
	}
</style>
