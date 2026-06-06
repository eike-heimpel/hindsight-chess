<script lang="ts">
	import { C } from '$lib/review/charts/palette';
	import type { CoachThread } from '$lib/client/coachThread.svelte';
	import type { Learning } from '$lib/review/coach/types';

	/**
	 * Variant B — board-first / voice-first.
	 *
	 * The blank intuition box is the PRIMARY input: the coach stays silent until
	 * the player says their read of the position (or asks to be guided). The
	 * thread's variant-B opener does NOT call the LLM on open(), so there are no
	 * coach bubbles here until the player speaks. Any multiple-choice options the
	 * coach later offers render as OPTIONAL chips below the box ("or pick one") —
	 * never as the main affordance. Show-line playback routes through the thread's
	 * `explore` branch (takeover-able), so the board lives on the route, not here.
	 */
	let { thread }: { thread: CoachThread } = $props();

	let freeText = $state('');

	function submit() {
		const t = freeText.trim();
		if (!t || thread.thinking) return;
		freeText = '';
		thread.answer(t);
	}

	function pick(choice: string) {
		if (thread.thinking) return;
		thread.answer(choice);
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

	// Has the conversation started? Until then we lead with the voice box alone.
	const hasSpoken = $derived(thread.messages.length > 0);

	// The tray is captured per ply; flatten to a single takeaways list.
	const takeaways = $derived(thread.learnings.flatMap((c) => c.learnings));
</script>

<div class="flex min-h-dvh flex-col gap-3 sm:min-h-0">
	<!-- Voice-first input — the primary affordance, always present and on top. -->
	<div class="voice">
		<label class="eyebrow" for="coach-read">Your read of this position</label>
		<textarea
			id="coach-read"
			class="read"
			bind:value={freeText}
			rows="3"
			placeholder="Tell me your read of this position…"
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
			}}
		></textarea>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<button class="btn primary" onclick={submit} disabled={thread.thinking || !freeText.trim()}>
				Talk it through
			</button>
			{#if thread.canGuide}
				<button class="btn" onclick={() => thread.guideMe()} disabled={thread.thinking}>
					Not sure? Guide me
				</button>
			{/if}
		</div>
	</div>

	<!-- Coach replies — silent until the player speaks or asks to be guided. -->
	{#if hasSpoken || thread.thinking}
		<div class="convo">
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
		</div>
	{/if}

	{#if thread.convError}
		<p class="text-xs" style="color: var(--bad);">{thread.convError}</p>
	{/if}

	<!-- Multiple choice as an OPTIONAL aid, below the voice box. -->
	{#if thread.choices.length && !thread.thinking}
		<div class="optional">
			<span class="eyebrow">or pick one</span>
			<div class="mt-1.5 grid gap-2">
				{#each thread.choices as c (c)}
					<button class="choice" onclick={() => pick(c)}>{c}</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Show-line playback — delegated to the explore branch on the route. -->
	<div class="flex flex-wrap gap-2">
		<button class="chip-btn" onclick={() => thread.playLine('best')}>▶ Better line</button>
		<button class="chip-btn" onclick={() => thread.playLine('punish')}>▶ What it allowed</button>
	</div>

	<!-- Live learnings tray — fills as the coach lands takeaways this session. -->
	{#if takeaways.length}
		<div class="tray">
			<span class="eyebrow">What you're taking away</span>
			<ul class="mt-1.5 grid gap-1.5">
				{#each takeaways as l (l.point)}
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

	<!-- wrapUp is ADVISORY — a nudge, never a gate on the input above. -->
	{#if thread.wrapUpReady}
		<p class="text-xs" style="color: {C.muted};">A good place to stop — or keep digging.</p>
	{/if}

	<button class="btn w-full" onclick={() => thread.finish()}>Done with this move</button>
</div>

<style>
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.voice {
		border-radius: 0.85rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.85rem;
	}
	.read {
		margin-top: 0.4rem;
		width: 100%;
		resize: vertical;
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		padding: 0.6rem 0.75rem;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--text);
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
	.btn.primary {
		background: var(--brand);
		color: var(--bg);
		border-color: transparent;
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--brand);
		filter: brightness(1.05);
	}

	.convo {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		max-height: 42svh;
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

	.optional {
		border-radius: 0.85rem;
		border: 1px dashed var(--border);
		background: var(--surface-1);
		padding: 0.7rem 0.85rem;
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

	.tray {
		border-radius: 0.85rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 0.7rem 0.85rem;
	}
	.badge {
		display: inline-block;
		border-radius: 9999px;
		padding: 0.1rem 0.55rem;
		font-size: 0.68rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	/* Touch: clear ~44px on the interactive surfaces. */
	@media (pointer: coarse) {
		.btn,
		.choice {
			min-height: 2.75rem;
		}
		.chip-btn {
			min-height: 2.25rem;
		}
	}
</style>
