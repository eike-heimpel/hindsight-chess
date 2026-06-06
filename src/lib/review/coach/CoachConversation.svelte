<script lang="ts">
	import { C } from '$lib/review/charts/palette';
	import type { Learning } from '$lib/review/coach/types';
	import type { CoachThread } from '$lib/client/coachThread.svelte';

	/**
	 * Variant A — the guided / Socratic-first panel. Conversation-first: the coach
	 * speaks first (via the thread opener), then it's a dialogue. Every turn keeps a
	 * persistent free-text box, surfaces the coach's multiple-choice options as
	 * buttons, offers an on-demand "guide me" hint, and lets the player play out the
	 * engine's lines on the board. A live tray collects the learnings.
	 *
	 * `wrapUp` is advisory ("a good place to stop") — it surfaces a "Done with this
	 * move" prompt but never hides the input; the player can always keep going.
	 *
	 * The panel is a leaf: it reads the thread's reactive state and calls its
	 * methods. All variant behaviour lives in the thread's opener + this markup —
	 * the route wires the same `{ thread }` prop to either variant.
	 */
	let { thread }: { thread: CoachThread } = $props();

	let freeText = $state('');

	function submitFree() {
		const t = freeText.trim();
		if (!t) return;
		freeText = '';
		thread.answer(t);
	}

	const LEVEL_LABEL: Record<Learning['level'], string> = {
		tactical: 'Tactic',
		principle: 'Principle',
		process: 'Process'
	};
	const LEVEL_COLOR: Record<Learning['level'], string> = {
		tactical: 'var(--class-blunder)',
		principle: 'var(--brand)',
		process: 'var(--good)'
	};

	const trayLearnings = $derived(thread.currentLearnings);
</script>

<div class="flex min-h-dvh flex-col gap-3">
	<!-- ============================ CONVERSATION ============================ -->
	<div class="convo" aria-live="polite">
		{#each thread.messages as m, i (i)}
			{#if m.role === 'coach'}
				<div class="bubble coach"><p class="whitespace-pre-line">{m.content}</p></div>
			{:else}
				<div class="bubble player">{m.content}</div>
			{/if}
		{/each}
		{#if thread.thinking}
			<div class="bubble coach"><span class="dots">Thinking…</span></div>
		{/if}
		{#if thread.convError}
			<p class="text-xs" style="color: var(--bad);">{thread.convError}</p>
		{/if}
	</div>

	<!-- ============================ BOARD LINES ============================ -->
	<div class="flex flex-wrap gap-2">
		<button class="chip-btn" onclick={() => thread.resetBoard()}>↺ Position</button>
		<button class="chip-btn" onclick={() => thread.playLine('best')}>▶ Better line</button>
		<button class="chip-btn" onclick={() => thread.playLine('punish')}>▶ What it allowed</button>
	</div>

	<!-- ============================ MC CHOICES ============================= -->
	{#if thread.choices.length && !thread.thinking}
		<div class="grid gap-2">
			{#each thread.choices as c (c)}
				<button class="choice" onclick={() => thread.answer(c)}>{c}</button>
			{/each}
		</div>
	{/if}

	<!-- ====================== PERSISTENT FREE TEXT ======================== -->
	<div class="flex gap-2">
		<input
			class="input flex-1"
			bind:value={freeText}
			placeholder="Tell the coach what you're thinking…"
			disabled={thread.thinking}
			onkeydown={(e) => e.key === 'Enter' && submitFree()}
		/>
		<button class="btn" onclick={submitFree} disabled={thread.thinking}>Send</button>
	</div>

	<!-- ====================== GUIDE + WRAP-UP ============================= -->
	<div class="flex flex-wrap items-center gap-2">
		{#if thread.canGuide}
			<button class="btn" onclick={() => thread.guideMe()} disabled={thread.thinking}>
				Guide me / hint
			</button>
		{/if}
		<button class="link ml-auto" onclick={() => thread.finish()}>Done with this move</button>
	</div>

	{#if thread.wrapUpReady}
		<p class="text-xs" style="color: {C.muted};">
			A good place to stop — or keep going with another read.
		</p>
	{/if}

	<!-- ============================ LEARNINGS TRAY ======================== -->
	{#if trayLearnings.length}
		<div class="tray">
			<div class="eyebrow">Takeaways from this move</div>
			<ul class="mt-1.5 grid gap-1.5">
				{#each trayLearnings as l (l.point)}
					<li class="flex gap-2">
						<span
							class="badge"
							style="background: color-mix(in srgb, {LEVEL_COLOR[
								l.level
							]} 16%, transparent); color: {LEVEL_COLOR[l.level]};"
						>
							{LEVEL_LABEL[l.level]}
						</span>
						<span class="text-sm" style="color: {C.body};">{l.point}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.input {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
		color: var(--text);
	}
	.input:disabled {
		opacity: 0.6;
	}
	.btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		transition: background var(--dur);
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.link {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.link:hover {
		color: var(--text);
	}

	.badge {
		display: inline-block;
		border-radius: 9999px;
		padding: 0.1rem 0.55rem;
		font-size: 0.68rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.convo {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		max-height: 48svh;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.bubble {
		border-radius: 0.85rem;
		padding: 0.6rem 0.8rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.bubble.coach {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
	}
	.bubble.player {
		background: var(--brand);
		color: var(--bg);
		align-self: flex-end;
		font-weight: 600;
		max-width: 85%;
	}
	.dots {
		color: var(--text-muted);
	}

	.choice {
		text-align: left;
		border-radius: 0.7rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.55rem 0.8rem;
		font-size: 0.88rem;
		color: var(--text);
		transition: background var(--dur-fast);
	}
	.choice:hover {
		background: var(--surface-2);
	}

	.chip-btn {
		border-radius: 9999px;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-2);
		transition: background var(--dur-fast);
	}
	.chip-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	/* 44px touch targets on coarse pointers (CLAUDE.md mobile rule). */
	@media (pointer: coarse) {
		.btn,
		.choice,
		.chip-btn,
		.input,
		.link {
			min-height: 44px;
		}
	}
</style>
