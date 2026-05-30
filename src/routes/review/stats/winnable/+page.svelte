<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static /review links and the runtime-built game href read clearer as plain
	 * hrefs; same convention as the other /review pages. */
	import type { PageData } from './$types';
	import type { MoveClass } from '$lib/review/classify';
	import type { ReviewGame } from '$lib/review/types';
	import type { WinnableCandidate } from '$lib/review/stats/types';
	import {
		classifyWinnable,
		WINNING_FLOOR_DEFAULT,
		SUSTAIN_DEFAULT,
		type WinnableVerdict
	} from '$lib/review/stats/winnable';
	import { explainMove } from '$lib/client/reviewExplain';
	import LineChart from '$lib/review/charts/LineChart.svelte';
	import RecencyFilter from '$lib/review/RecencyFilter.svelte';
	import { withinWindow, RECENCY_DEFAULT, type RecencyWindow } from '$lib/review/recency';
	import { C, CLASS_COLOR } from '$lib/review/charts/palette';

	let { data }: { data: PageData } = $props();

	let selected = $state(0);
	const cur = $derived(data.stats[Math.min(selected, Math.max(0, data.stats.length - 1))]);

	// --- levers ---
	const FLOORS = [70, 80, 90];
	const SUSTAINS = [2, 3, 4];
	const MATERIALS: { label: string; min?: number }[] = [
		{ label: 'Any', min: undefined },
		{ label: '≥ pawn', min: 1 },
		{ label: '≥ piece', min: 3 },
		{ label: '≥ rook', min: 5 }
	];

	let floor = $state(WINNING_FLOOR_DEFAULT);
	let sustain = $state(SUSTAIN_DEFAULT);
	let materialIdx = $state(0);

	// Coarser scope than the levers: drop stale early games (persisted across pages).
	let recency = $state<RecencyWindow>(RECENCY_DEFAULT);

	const opts = $derived({ floor, sustain, materialMin: MATERIALS[materialIdx].min });

	type Row = { c: WinnableCandidate; v: WinnableVerdict };

	const candidates = $derived<WinnableCandidate[]>(
		(cur?.winnable ?? []).filter((c) => withinWindow(c.playedAt, recency))
	);
	const judged = $derived<Row[]>(candidates.map((c) => ({ c, v: classifyWinnable(c, opts) })));
	const rows = $derived<Row[]>(
		judged
			.filter((r) => r.v.qualifies)
			.sort((a, b) => {
				// thrown (coachable) first, then by biggest give-back, then peak.
				if (a.v.tier !== b.v.tier) return a.v.tier === 'thrown' ? -1 : 1;
				return (b.v.giveBack?.drop ?? 0) - (a.v.giveBack?.drop ?? 0);
			})
	);
	const thrownCount = $derived(rows.filter((r) => r.v.tier === 'thrown').length);
	const outplayedCount = $derived(rows.length - thrownCount);
	const filtered = $derived(candidates.length - rows.length);

	const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
	const short = (d: Date | string) => dateFmt.format(new Date(d));
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	const CLASS_LABEL: Record<MoveClass, string> = {
		best: 'best',
		good: 'good',
		inaccuracy: 'inaccuracy',
		mistake: 'mistake',
		blunder: 'blunder'
	};

	const sparkSeries = (c: WinnableCandidate) =>
		c.winTimeline.map((v, i) => ({ label: `move ${Math.ceil(i / 2)}`, value: v }));

	// --- on-demand "what went wrong" (reuses the grounded move explainer) ---
	type ExplainState = {
		loading: boolean;
		text?: string;
		error?: string;
		progress?: { done: number; total: number };
	};
	let explains = $state<Record<string, ExplainState>>({});

	async function explain(row: Row) {
		const { c, v } = row;
		if (!v.giveBack) return;
		const id = `${c.source}:${c.gameId}`;
		if (explains[id]?.loading) return;
		explains = { ...explains, [id]: { loading: true } };
		try {
			const res = await fetch(`/api/review/game/${c.source}/${c.gameId}`);
			if (!res.ok) throw new Error(`couldn't load game (${res.status})`);
			const game = (await res.json()) as ReviewGame;
			const result = await explainMove(game, v.giveBack.ply, (done, total) => {
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

<svelte:head><title>Review · Winnable losses</title></svelte:head>

<div class="min-h-screen" style="background: #fafaf9;">
	<main class="mx-auto max-w-4xl px-4 py-8">
		<header class="mb-2 flex items-baseline justify-between gap-4">
			<h1 class="text-3xl font-bold tracking-tight" style="color: {C.ink};">Winnable losses</h1>
			<a href="/review/stats" class="text-sm font-medium" style="color: {C.muted};">← Stats</a>
		</header>
		<p class="mb-6 max-w-2xl text-sm leading-relaxed" style="color: {C.body};">
			Games you were clearly winning and didn't close out. A position only counts if you
			<strong>held</strong> the advantage across several of your own moves — a one-move engine spike (the
			mate-in-12 you'd never find over the board) doesn't qualify. The marked point on each curve is where
			you gave it back.
		</p>

		{#if data.accounts.length === 0}
			<p style="color: {C.body};">
				No linked accounts. Link a chess.com account on the
				<a href="/review" class="underline">games page</a> first.
			</p>
		{:else if data.coverage.analyzed === 0}
			<p style="color: {C.body};">
				No analyzed games yet. Run <strong>Analyze remaining</strong> on the
				<a href="/review/stats" class="underline">stats page</a> first — winnable losses need per-move
				analysis.
			</p>
		{:else}
			<!-- Recency window (coarser scope) -->
			<div class="mb-3">
				<RecencyFilter bind:value={recency} />
			</div>

			<!-- Time class (primary axis) -->
			<div class="segmented mb-4">
				{#each data.stats as s, i (s.timeClass)}
					<button class="seg {i === selected ? 'seg-on' : ''}" onclick={() => (selected = i)}>
						{cap(s.timeClass)}
						<span class="seg-count"
							>{s.winnable.filter((c) => withinWindow(c.playedAt, recency)).length}</span
						>
					</button>
				{/each}
			</div>

			<!-- Levers -->
			<section class="card mb-5">
				<div class="grid gap-4 sm:grid-cols-3">
					<div>
						<div class="eyebrow mb-1.5">Clearly winning ≥</div>
						<div class="pills">
							{#each FLOORS as f (f)}
								<button class="pill {floor === f ? 'pill-on' : ''}" onclick={() => (floor = f)}
									>{f}%</button
								>
							{/each}
						</div>
					</div>
					<div>
						<div class="eyebrow mb-1.5">Held for ≥</div>
						<div class="pills">
							{#each SUSTAINS as k (k)}
								<button class="pill {sustain === k ? 'pill-on' : ''}" onclick={() => (sustain = k)}
									>{k} moves</button
								>
							{/each}
						</div>
					</div>
					<div>
						<div class="eyebrow mb-1.5">Material edge <span class="opt">optional</span></div>
						<div class="pills">
							{#each MATERIALS as m, i (m.label)}
								<button
									class="pill {materialIdx === i ? 'pill-on' : ''}"
									onclick={() => (materialIdx = i)}>{m.label}</button
								>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<!-- Headline -->
			<section class="card mb-5">
				<div class="flex flex-wrap items-end gap-x-8 gap-y-3">
					<div>
						<div class="eyebrow mb-1">Winnable losses</div>
						<div class="num-xl" style="color: {rows.length ? C.bad : C.good};">{rows.length}</div>
					</div>
					<div class="flex gap-6 pb-1 text-sm">
						<div>
							<div class="num-md" style="color: {C.bad};">{thrownCount}</div>
							<div style="color: {C.muted};">thrown away</div>
						</div>
						<div>
							<div class="num-md" style="color: #ca8a04;">{outplayedCount}</div>
							<div style="color: {C.muted};">out-resourced</div>
						</div>
						<div>
							<div class="num-md" style="color: {C.muted};">{filtered}</div>
							<div style="color: {C.muted};">spikes filtered</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Cards -->
			{#if rows.length === 0}
				<div class="card">
					<p class="muted">
						Nothing clears these levers in {cap(cur.timeClass)}. Lower the threshold or the "held
						for" bar to surface closer calls.
					</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each rows as { c, v } (c.source + c.gameId)}
						{@const id = `${c.source}:${c.gameId}`}
						{@const ex = explains[id]}
						<section class="card">
							<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<span class="tier {v.tier}"
										>{v.tier === 'thrown' ? 'Thrown away' : 'Out-resourced'}</span
									>
									<span class="font-semibold" style="color: {C.ink};">vs {c.opponent}</span>
									<span class="text-sm" style="color: {C.muted};"
										>· {short(c.playedAt)} · {c.outcome === 'loss' ? 'lost' : 'drew'}</span
									>
								</div>
								<a
									href="/review/{c.source}/{c.gameId}?orient={c.side === 'w'
										? 'white'
										: 'black'}{v.giveBack ? `&ply=${v.giveBack.ply}` : ''}"
									class="text-sm font-medium"
									style="color: {C.rating};">{v.giveBack ? 'Replay from the slip →' : 'Replay →'}</a
								>
							</div>

							<LineChart
								series={sparkSeries(c)}
								color={C.good}
								yMin={0}
								yMax={100}
								unit="%"
								endpoints={false}
								threshold={floor}
								mark={v.giveBack?.ply}
							/>

							{#if v.giveBack}
								<p class="mt-2 text-sm leading-relaxed" style="color: {C.body};">
									Clearly winning for <strong>{v.sustainedRun} moves</strong> (peaked
									<strong style="color: {C.good};">{Math.round(c.peakWin)}%</strong
									>{#if c.maxMaterialLead > 0}, up
										{c.maxMaterialLead} pts{/if}). Gave it back at move
									<strong>{v.giveBack.moveNumber} {v.giveBack.san}</strong>
									<span style="color: {CLASS_COLOR[v.giveBack.classification]};"
										>({CLASS_LABEL[v.giveBack.classification]})</span
									>:
									<span class="tabular-nums"
										>{Math.round(v.giveBack.winBefore)}% →
										{Math.round(v.giveBack.winAfter)}%</span
									>.
								</p>
							{/if}

							<div class="mt-3">
								{#if ex?.text}
									<div class="explain">{ex.text}</div>
								{:else if ex?.loading}
									<button class="btn" disabled>
										Analyzing the position…{#if ex.progress}
											({ex.progress.done}/{ex.progress.total}){/if}
									</button>
								{:else}
									<button class="btn" onclick={() => explain({ c, v })}
										>Explain what went wrong</button
									>
									{#if ex?.error}<span class="ml-2 text-xs" style="color: {C.bad};">{ex.error}</span
										>{/if}
								{/if}
							</div>
						</section>
					{/each}
				</div>
			{/if}
		{/if}
	</main>
</div>

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid #ede9e6;
		background: #fff;
		padding: 1.25rem;
		box-shadow: 0 1px 2px rgb(28 25 23 / 0.04);
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #a8a29e;
	}
	.opt {
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: #c7c2bd;
	}
	.muted {
		font-size: 0.875rem;
		color: #a8a29e;
	}
	.num-xl {
		font-size: 2.75rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.num-md {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.segmented {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 9999px;
		background: #f0eeec;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 9999px;
		padding: 0.4rem 0.95rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #78716c;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.seg-count {
		font-size: 0.7rem;
		font-weight: 500;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	.seg-on {
		background: #fff;
		color: #1c1917;
		box-shadow: 0 1px 3px rgb(28 25 23 / 0.12);
	}

	/* Lever pills */
	.pills {
		display: inline-flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.pill {
		border-radius: 0.55rem;
		border: 1px solid #e7e5e4;
		background: #fff;
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #57534e;
		transition:
			background 0.12s,
			border-color 0.12s,
			color 0.12s;
	}
	.pill:hover {
		background: #fafaf9;
	}
	.pill-on {
		border-color: #059669;
		background: #f0fdf9;
		color: #047857;
	}

	.tier {
		border-radius: 9999px;
		padding: 0.15rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tier.thrown {
		background: #fde7ec;
		color: #be123c;
	}
	.tier.outplayed {
		background: #fef3c7;
		color: #b45309;
	}

	.btn {
		border-radius: 0.6rem;
		border: 1px solid #d6d3d1;
		background: #fff;
		padding: 0.45rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #292524;
		transition: background 0.15s;
	}
	.btn:hover:not(:disabled) {
		background: #f5f5f4;
	}
	.btn:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.explain {
		border-left: 3px solid #e7e5e4;
		padding: 0.25rem 0 0.25rem 0.85rem;
		font-size: 0.9rem;
		line-height: 1.6;
		color: #44403c;
	}
</style>
