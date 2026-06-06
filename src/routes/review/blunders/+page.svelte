<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static /review links and the runtime-built game href read clearer as plain
	 * hrefs; same convention as the other /review pages. */
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { ReviewGame } from '$lib/review/types';
	import type { BlunderEntry } from '$lib/review/stats/types';
	import { uciSquares } from '$lib/review/analysis';
	import { explainMove, buildExplainRequest } from '$lib/client/reviewExplain';
	import Board from '$lib/components/Board.svelte';
	import RecencyFilter from '$lib/review/RecencyFilter.svelte';
	import { withinWindow, RECENCY_DEFAULT, type RecencyWindow } from '$lib/review/recency';
	import { C } from '$lib/review/charts/palette';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Disclosure from '$lib/components/Disclosure.svelte';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	const short = (d: Date | string) => dateFmt.format(new Date(d));
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	// --- recency window (coarser axis — drops stale early games; persisted) ---
	let recency = $state<RecencyWindow>(RECENCY_DEFAULT);
	const inWindow = $derived<BlunderEntry[]>(
		data.entries.filter((e) => withinWindow(e.playedAt, recency))
	);

	// --- time-class filter (pooled by default — see BlunderEntry); 'starred' is a
	// cross-time-class facet filter that joins the same segmented control. ---
	const FILTERS = $derived<string[]>([
		'all',
		'starred',
		...[...new Set(inWindow.map((e) => e.timeClass))].sort()
	]);
	let filter = $state('all');
	const matchesFilter = (e: BlunderEntry, f: string) =>
		f === 'all' ? true : f === 'starred' ? e.mark === 'star' : e.timeClass === f;
	const countFor = (f: string) => inWindow.filter((e) => matchesFilter(e, f)).length;

	const entries = $derived<BlunderEntry[]>(inWindow.filter((e) => matchesFilter(e, filter)));

	let index = $state(0);
	const clamped = $derived(Math.min(index, Math.max(0, entries.length - 1)));
	const current = $derived<BlunderEntry | undefined>(entries[clamped]);

	// Re-narrowing the recency window snaps back to the worst blunder and drops a
	// now-empty time-class selection (recency is the coarser axis). Driven by the
	// RecencyFilter's onChange, not an $effect — the state change belongs in the
	// event that causes it.
	function onRecencyChange() {
		filter = 'all';
		index = 0;
	}

	// Reset to the worst blunder whenever the filter narrows the queue.
	function setFilter(f: string) {
		filter = f;
		index = 0;
	}

	// Resume: persist the cursor fire-and-forget, debounced so arrow-key spamming
	// doesn't hammer the route. Driven from go(), not an $effect.
	let cursorTimer: ReturnType<typeof setTimeout> | undefined;
	function persistCursor(entry: BlunderEntry | undefined) {
		if (!entry) return;
		clearTimeout(cursorTimer);
		const ref = { source: entry.source, gameId: entry.gameId, ply: entry.ply };
		cursorTimer = setTimeout(() => {
			void fetch('/api/review/cursor', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ queue: 'blunders', ref })
			});
		}, 400);
	}

	function go(delta: number) {
		index = Math.min(entries.length - 1, Math.max(0, clamped + delta));
		persistCursor(entries[index]);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'ArrowRight') go(1);
	}

	// Star / done write straight from the event handler (never an $effect). Both
	// optimistically patch the seeded entry so the segmented "Starred" count and
	// the muted-card treatment update without a reload, then POST to the route.
	async function writeMark(entry: BlunderEntry, mark: NonNullable<BlunderEntry['mark']>) {
		const ref = { source: entry.source, gameId: entry.gameId, ply: entry.ply };
		await fetch('/api/review/moves', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ref, facet: 'mark', value: mark })
		});
	}

	function toggleStar(entry: BlunderEntry) {
		const next = entry.mark === 'star' ? undefined : 'star';
		// A toggle-off has no 'unstar' mark; clear just the mark facet (DELETE with
		// facet:'mark') so a coexisting note/snapshot on the move survives.
		entry.mark = next;
		if (next) void writeMark(entry, 'star');
		else
			void fetch('/api/review/moves', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					ref: { source: entry.source, gameId: entry.gameId, ply: entry.ply },
					facet: 'mark'
				})
			});
	}

	// Done mutes the card and advances to the next entry that isn't already done.
	function markDone(entry: BlunderEntry) {
		entry.mark = 'done';
		void writeMark(entry, 'done');
		const from = clamped;
		const nextIdx = entries.findIndex((e, i) => i > from && e.mark !== 'done');
		index = nextIdx === -1 ? from : nextIdx;
		persistCursor(entries[index]);
	}

	// Note writes from the blur/change handler (never an $effect). The textarea is
	// uncontrolled — seeded from entry.note on mount via {#key} — so we read the
	// element's value and only POST when it actually changed, patching the entry so
	// the seeded value and the "Starred"-style overlay stay in sync.
	function writeNote(entry: BlunderEntry, text: string) {
		const trimmed = text.trim();
		if (trimmed === (entry.note ?? '')) return;
		entry.note = trimmed || undefined;
		const ref = { source: entry.source, gameId: entry.gameId, ply: entry.ply };
		// Emptying the note unsets the facet (DELETE) rather than storing "".
		if (trimmed)
			void fetch('/api/review/moves', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ref, facet: 'note', value: trimmed })
			});
		else
			void fetch('/api/review/moves', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ref, facet: 'note' })
			});
	}

	// "Save this explanation" — freeze the cached LLM prose + the engine facts. The
	// snapshot route takes the SAME engine-number body the explain flow builds, so
	// we re-run the two engine passes (cheap, bounded) and forward the body; the
	// server re-reads the prose and rebuilds the facts. Optimistically reflects
	// saved state from entry.snapshot.
	let saving = $state<Record<string, boolean>>({});
	let saveError = $state<Record<string, string>>({});
	async function saveSnapshot(entry: BlunderEntry) {
		const id = explainId(entry);
		if (saving[id] || entry.snapshot) return;
		saving = { ...saving, [id]: true };
		saveError = { ...saveError, [id]: '' };
		try {
			const gameKey = `${entry.source}:${entry.gameId}`;
			let game = gameCache[gameKey];
			if (!game) {
				const res = await fetch(`/api/review/game/${entry.source}/${entry.gameId}`);
				if (!res.ok) throw new Error(`couldn't load game (${res.status})`);
				game = (await res.json()) as ReviewGame;
				gameCache[gameKey] = game;
			}
			const built = await buildExplainRequest(game, entry.ply);
			if (!built.ok) throw new Error(built.error.message);
			const res = await fetch('/api/review/snapshot', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(built.value)
			});
			if (!res.ok) throw new Error(`save failed (${res.status})`);
			// Read the saved prose off the entry being saved, not the `current`-bound
			// derived — they coincide today but the entry is the right source.
			entry.snapshot = explains[id]?.text ?? entry.cachedExplanation;
		} catch (e) {
			saveError = { ...saveError, [id]: e instanceof Error ? e.message : String(e) };
		} finally {
			saving = { ...saving, [id]: false };
		}
	}

	// Resume where the user left off: match the saved cursor against the *current*
	// filtered view at mount. A one-shot non-reactive read → onMount, not $effect.
	// Fail-soft to the worst blunder (index 0) only when the move isn't in view —
	// an expected state under the recency window / time-class filter.
	onMount(() => {
		const c = data.cursor;
		if (c) {
			const found = entries.findIndex(
				(e) => e.source === c.source && e.gameId === c.gameId && e.ply === c.ply
			);
			if (found !== -1) index = found;
		}
		// Drop a pending fire-and-forget cursor POST if we navigate away mid-debounce.
		return () => clearTimeout(cursorTimer);
	});

	// --- on-demand grounded explanation (reuses the move explainer) ---
	type ExplainState = {
		loading: boolean;
		text?: string;
		error?: string;
		progress?: { done: number; total: number };
	};
	let explains = $state<Record<string, ExplainState>>({});
	// Plain memo, not reactive state — fetched games only feed the explainer.
	const gameCache: Record<string, ReviewGame> = {};

	const explainId = (e: BlunderEntry) => `${e.source}:${e.gameId}:${e.ply}`;

	const currentExplain = $derived.by<ExplainState | undefined>(() => {
		if (!current) return undefined;
		const fetched = explains[explainId(current)];
		if (fetched) return fetched;
		if (current.cachedExplanation) return { loading: false, text: current.cachedExplanation };
		return undefined;
	});

	async function explain(entry: BlunderEntry) {
		const id = explainId(entry);
		if (explains[id]?.loading) return;
		explains = { ...explains, [id]: { loading: true } };
		try {
			const gameKey = `${entry.source}:${entry.gameId}`;
			let game = gameCache[gameKey];
			if (!game) {
				const res = await fetch(`/api/review/game/${entry.source}/${entry.gameId}`);
				if (!res.ok) throw new Error(`couldn't load game (${res.status})`);
				game = (await res.json()) as ReviewGame;
				gameCache[gameKey] = game;
			}
			const result = await explainMove(game, entry.ply, (done, total) => {
				explains = { ...explains, [id]: { loading: true, progress: { done, total } } };
			});
			explains = {
				...explains,
				[id]: result.ok
					? { loading: false, text: result.value.text }
					: { loading: false, error: result.error.message }
			};
		} catch (e) {
			explains = {
				...explains,
				[id]: { loading: false, error: e instanceof Error ? e.message : String(e) }
			};
		}
	}
</script>

<svelte:head><title>Review · Blunder trainer</title></svelte:head>
<svelte:window onkeydown={onKey} />

<div class="min-h-dvh" style="background: var(--bg);">
	<main class="mx-auto max-w-4xl px-4 py-8">
		<PageHeader title="Blunder trainer" back={{ href: '/review/stats', label: 'Stats' }} />
		<p class="mb-6 max-w-2xl text-sm leading-relaxed" style="color: {C.body};">
			Your blunders, worst first — what you played, the better move, and why.
		</p>

		{#if data.accounts.length === 0}
			<p style="color: {C.body};">
				No linked accounts. Link a chess.com account on the
				<a href="/review" class="underline">games page</a> first.
			</p>
		{:else if data.coverage.analyzed === 0}
			<p style="color: {C.body};">
				No analyzed games yet. Run <strong>Analyze remaining</strong> on the
				<a href="/review/stats" class="underline">stats page</a> first — blunders need per-move analysis.
			</p>
		{:else}
			<!-- Recency window (coarser scope) -->
			<div class="mb-3">
				<RecencyFilter bind:value={recency} onChange={onRecencyChange} />
			</div>

			<!-- Time-class filter -->
			<div class="segmented mb-4">
				{#each FILTERS as f (f)}
					<button class="seg {filter === f ? 'seg-on' : ''}" onclick={() => setFilter(f)}>
						{f === 'all' ? 'All' : cap(f)}
						<span class="seg-count">{countFor(f)}</span>
					</button>
				{/each}
			</div>

			{#if !current}
				<div class="card">
					<p class="muted">
						No blunders {filter === 'all' ? 'yet' : `in ${cap(filter)}`}. 🎯 Nothing to drill —
						switch the filter or go analyze more games.
					</p>
				</div>
			{:else}
				<section class="card" class:done={current.mark === 'done'}>
					<!-- Header / readout -->
					<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-baseline gap-2">
							<span class="tier">Blunder</span>
							<span class="font-semibold" style="color: {C.ink};"
								>{clamped + 1} / {entries.length}</span
							>
							<span class="text-sm" style="color: {C.muted};"
								>· vs {current.opponent} · {short(current.playedAt)} · {current.phase}</span
							>
						</div>
						<a
							href="/review/{current.source}/{current.gameId}?orient={current.side === 'w'
								? 'white'
								: 'black'}&ply={current.ply}"
							class="-my-1.5 py-1.5 text-sm font-medium"
							style="color: {C.rating};">Open in full replay →</a
						>
					</div>

					<div class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_18rem]">
						<Board
							fen={current.fenBefore}
							interactive={false}
							selected={null}
							legalDestinations={[]}
							onSquareClick={() => {}}
							orientation={current.side === 'w' ? 'white' : 'black'}
							lastMove={uciSquares(current.uci)}
							opponentArrow={uciSquares(current.bestMoveUci)}
						/>

						<!-- Words first: the plain verdict + the explain pathway lead; the
						     raw numbers are a deliberate second layer (remembered choice). -->
						<div class="flex flex-col gap-4">
							<p class="text-base leading-relaxed" style="color: {C.body};">
								You played <strong style="color: {C.bad};">{current.san}</strong>. The engine
								preferred <strong style="color: {C.good};">{current.bestMoveSan}</strong>.
							</p>
							<p class="-mt-2 text-sm" style="color: {C.muted};">
								Cost you about {Math.round(current.winBefore - current.winAfter)}% of your winning
								chances.
							</p>

							<div>
								{#if currentExplain?.text}
									<div class="explain">{currentExplain.text}</div>
									<div class="mt-2">
										{#if current.snapshot}
											<span class="saved-chip">✓ Saved to your shortlist</span>
										{:else}
											<button
												class="btn"
												disabled={saving[explainId(current)]}
												onclick={() => saveSnapshot(current)}
											>
												{saving[explainId(current)] ? 'Saving…' : 'Save this explanation'}
											</button>
											{#if saveError[explainId(current)]}<span
													class="ml-2 text-xs"
													style="color: {C.bad};">{saveError[explainId(current)]}</span
												>{/if}
										{/if}
									</div>
								{:else if currentExplain?.loading}
									<button class="btn" disabled>
										Analyzing the position…{#if currentExplain.progress}
											({currentExplain.progress.done}/{currentExplain.progress.total}){/if}
									</button>
								{:else}
									<button class="btn" onclick={() => explain(current)}
										>Explain what went wrong</button
									>
									{#if currentExplain?.error}<span class="ml-2 text-xs" style="color: {C.bad};"
											>{currentExplain.error}</span
										>{/if}
								{/if}
							</div>

							<Disclosure
								storageKey="review:details"
								showLabel="Show the numbers"
								hideLabel="Hide the numbers"
							>
								<div class="flex flex-col gap-3">
									<div>
										<div class="eyebrow mb-1">Move</div>
										<div class="text-lg font-semibold tabular-nums" style="color: {C.ink};">
											{current.moveNumber}. {current.san}
										</div>
									</div>
									<div>
										<div class="eyebrow mb-1">Win % (your POV)</div>
										<div class="text-lg font-semibold tabular-nums" style="color: {C.ink};">
											{Math.round(current.winBefore)}% →
											<span style="color: {C.bad};">{Math.round(current.winAfter)}%</span>
										</div>
									</div>
									{#if current.opening}
										<div>
											<div class="eyebrow mb-1">Opening</div>
											<div class="text-sm" style="color: {C.body};">{current.opening}</div>
										</div>
									{/if}
								</div>
							</Disclosure>
						</div>
					</div>

					<!-- Mark controls -->
					<div class="mt-5 flex items-center gap-2">
						<button
							class="icon-btn {current.mark === 'star' ? 'icon-on' : ''}"
							aria-pressed={current.mark === 'star'}
							title={current.mark === 'star' ? 'Remove star' : 'Star this blunder'}
							onclick={() => toggleStar(current)}>★ Star</button
						>
						<button
							class="icon-btn {current.mark === 'done' ? 'icon-on' : ''}"
							aria-pressed={current.mark === 'done'}
							title="Mark done and move on"
							onclick={() => markDone(current)}>✓ Done</button
						>
					</div>

					<!-- Note: an uncontrolled textarea re-seeded per blunder via {#key}; saves
					     from blur (never an $effect), keyed by the move's id so each blunder
					     keeps its own note. -->
					{#key explainId(current)}
						<div class="mt-4">
							<label class="eyebrow mb-1 block" for="blunder-note">Your note</label>
							<textarea
								id="blunder-note"
								class="note"
								rows="2"
								placeholder="What were you thinking here? What will you do differently?"
								value={current.note ?? ''}
								onblur={(e) => writeNote(current, e.currentTarget.value)}
							></textarea>
						</div>
					{/key}

					<!-- Navigation -->
					<div class="mt-4 flex items-center justify-between">
						<button class="btn" disabled={clamped === 0} onclick={() => go(-1)}>◀ Prev</button>
						<span class="text-sm tabular-nums" style="color: {C.muted};"
							>{clamped + 1} / {entries.length}</span
						>
						<button class="btn" disabled={clamped >= entries.length - 1} onclick={() => go(1)}
							>Next ▶</button
						>
					</div>
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1.25rem;
		box-shadow: var(--shadow-1);
		transition: opacity var(--dur);
	}
	/* Done mutes the card so the queue reads as worked-through, not gone. */
	.card.done {
		opacity: 0.55;
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.muted {
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	/* Scrolls internally rather than overflowing the viewport on narrow phones. */
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
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9999px;
		padding: 0.4rem 0.95rem;
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.seg-count {
		font-size: 0.7rem;
		font-weight: 500;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	.seg-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}

	.tier {
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: color-mix(in srgb, var(--bad) 16%, transparent);
		color: var(--bad);
	}

	.btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		transition: background var(--dur);
	}
	.btn:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.btn:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.icon-btn {
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.4rem 0.8rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background var(--dur),
			color var(--dur);
	}
	.icon-btn:hover {
		background: var(--surface-2);
	}
	.icon-on {
		background: var(--surface-3);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}

	/* Roomier tap targets on touch devices; desktop keeps the compact controls. */
	@media (pointer: coarse) {
		.seg {
			min-height: 2.5rem;
		}
		.btn,
		.icon-btn {
			min-height: 2.75rem;
		}
	}

	.explain {
		border-left: 3px solid var(--border-strong);
		padding: 0.25rem 0 0.25rem 0.85rem;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--text-2);
	}

	.note {
		width: 100%;
		border-radius: 0.6rem;
		border: 1px solid var(--border-strong);
		background: var(--surface-1);
		padding: 0.5rem 0.7rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text);
		resize: vertical;
	}
	.note::placeholder {
		color: var(--text-muted);
	}
	.note:focus {
		outline: none;
		border-color: var(--rating);
	}

	.saved-chip {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.75rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--good) 16%, transparent);
		color: var(--good);
	}
</style>
