<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static /review links and the runtime-built game href (?t.source/t.gameId)
	 * read clearer as plain hrefs; same convention as the other /review pages. */
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { MoveClass } from '$lib/review/classify';
	import type { Phase, RatingBand, TrendPoint } from '$lib/review/stats/types';
	import { batchAnalyze, type BatchProgress } from '$lib/client/reviewStats';
	import LineChart from '$lib/review/charts/LineChart.svelte';
	import BarChart from '$lib/review/charts/BarChart.svelte';
	import SegmentedBar from '$lib/review/charts/SegmentedBar.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { C, RECORD_COLOR, CLASS_COLOR, winRateColor } from '$lib/review/charts/palette';
	import { windowTrend, recentMean } from '$lib/review/stats/trend';

	let { data }: { data: PageData } = $props();

	/** Headline "current level" for a noisy stat = mean of the last N games. */
	const RECENT_FORM_WINDOW = 5;
	/** Centered moving-average window for the noisy-stat trend lines. */
	const MA_WINDOW = 5;

	type TrendCardProps = {
		title: string;
		series: { label: string; value: number }[];
		color: string;
		unit: string;
		goodUp: boolean;
		empty: string;
		avgLabel?: string;
		/** 'last' = exact most-recent value (rating); 'recent' = mean of the last
		 *  few games (noisy per-game stats). */
		headline: 'last' | 'recent';
		smooth?: boolean;
	};

	const headlineText = (v: number, unit: string, mode: 'last' | 'recent') =>
		mode === 'last' ? `${Math.round(v)}${unit}` : `${(Math.round(v * 10) / 10).toFixed(1)}${unit}`;

	let selected = $state(0);
	const cur = $derived(data.stats[Math.min(selected, Math.max(0, data.stats.length - 1))]);

	/** Which trend badge has its "what is this?" popover open (keyed by card title);
	 *  null = none. Tap toggles; a tap anywhere else closes it. */
	let openTip = $state<string | null>(null);

	type View = 'overview' | 'mistakes' | 'matchups';
	let view = $state<View>('overview');
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'mistakes', label: 'Mistakes' },
		{ id: 'matchups', label: 'Matchups' }
	];

	const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
	const short = (d: Date) => dateFmt.format(new Date(d));
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	const CLASS_LABEL: Record<MoveClass, string> = {
		best: 'Best',
		good: 'Good',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
	const PHASE_LABEL: Record<Phase, string> = {
		opening: 'Opening',
		middlegame: 'Middlegame',
		endgame: 'Endgame'
	};
	const BAND_LABEL: Record<RatingBand, string> = {
		weaker: 'Weaker',
		even: 'Even (±100)',
		stronger: 'Stronger',
		unknown: 'Unknown'
	};

	const recordSegments = (r: { win: number; draw: number; loss: number }) => [
		{ label: 'Won', value: r.win, color: RECORD_COLOR.win },
		{ label: 'Drawn', value: r.draw, color: RECORD_COLOR.draw },
		{ label: 'Lost', value: r.loss, color: RECORD_COLOR.loss }
	];

	const toSeries = (pts: TrendPoint[]) =>
		pts.map((p) => ({ label: short(p.playedAt), value: p.value }));

	// --- batch analyze ---
	let analyzing = $state(false);
	let progress = $state<BatchProgress | null>(null);
	let batchNote = $state<string | null>(null);

	async function runBatch() {
		analyzing = true;
		batchNote = null;
		const result = await batchAnalyze(data.pending, (p) => (progress = p));
		analyzing = false;
		progress = null;
		batchNote =
			`Analyzed ${result.analyzed} game(s).` +
			(result.failed.length ? ` ${result.failed.length} failed.` : '');
		await invalidateAll();
	}
</script>

<svelte:head><title>Review · Stats</title></svelte:head>

<svelte:window onclick={() => (openTip = null)} />

{#snippet deltaBadge(d: number, goodUp: boolean, unit: string, key: string)}
	{@const good = goodUp ? d >= 0 : d <= 0}
	<span class="tip-anchor">
		<button
			type="button"
			class="cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-semibold tabular-nums pointer-coarse:px-3 pointer-coarse:py-1.5"
			style="color: {good ? C.good : C.bad}; background: color-mix(in srgb, {good
				? C.good
				: C.bad} 12%, transparent);"
			aria-expanded={openTip === key}
			onclick={(e) => {
				e.stopPropagation();
				openTip = openTip === key ? null : key;
			}}
		>
			{d > 0 ? '↑' : '↓'}{Math.abs(Math.round(d * 10) / 10)}{unit}
		</button>
		{#if openTip === key}
			<div class="tip" role="tooltip">
				<p class="tip-title">Recent vs. earlier</p>
				<p>
					We average your most recent games and compare them to your earliest ones — this is the
					gap. <strong style="color: {good ? C.good : C.bad};"
						>{good ? 'Green means you’re trending up.' : 'Red means you’re trending down.'}</strong
					>
				</p>
			</div>
		{/if}
	</span>
{/snippet}

{#snippet trendCard(cfg: TrendCardProps)}
	{@const values = cfg.series.map((p) => p.value)}
	{@const t = windowTrend(values)}
	{@const headline =
		cfg.headline === 'last' ? values.at(-1) : recentMean(values, RECENT_FORM_WINDOW)}
	<div class="card">
		<div class="mb-1 flex items-start justify-between gap-2">
			<span class="eyebrow">{cfg.title}</span>
			{#if t && Math.abs(t.delta) >= 0.05}
				{@render deltaBadge(t.delta, cfg.goodUp, cfg.unit, cfg.title)}
			{/if}
		</div>
		{#if headline != null}
			<div class="num-lg" style="color: {C.ink};">
				{headlineText(headline, cfg.unit, cfg.headline)}
			</div>
			{#if cfg.avgLabel}<div class="mb-2 text-xs" style="color: {C.muted};">
					{cfg.avgLabel}
				</div>{/if}
			{#if cfg.series.length > 1}
				<div class="mt-1">
					<LineChart
						series={cfg.series}
						color={cfg.color}
						unit={cfg.unit}
						yMin={cfg.unit === '' && cfg.goodUp === false ? 0 : undefined}
						smoothWindow={cfg.smooth ? MA_WINDOW : undefined}
					/>
				</div>
			{/if}
		{:else}
			<p class="muted py-4">{cfg.empty}</p>
		{/if}
	</div>
{/snippet}

<div class="min-h-dvh" style="background: var(--bg);">
	<main class="mx-auto max-w-4xl px-4 py-8">
		<PageHeader title="Stats" back={{ href: '/review', label: 'Games' }} />

		{#if data.accounts.length === 0}
			<p style="color: {C.body};">
				No linked accounts. Link a chess.com account on the
				<a href="/review" class="underline">games page</a> first.
			</p>
		{:else if data.coverage.total === 0}
			<p style="color: {C.body};">
				No games stored yet for {data.accounts.join(', ')}. Sync some on the
				<a href="/review" class="underline">games page</a>.
			</p>
		{:else}
			<!-- Coverage + batch analyze -->
			<section class="card mb-6">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="text-sm">
						<span class="font-semibold" style="color: {C.ink};"
							>{data.coverage.analyzed} / {data.coverage.total}</span
						>
						<span style="color: {C.muted};"> games analyzed</span>
						{#if data.pending.length > 0}
							<p class="mt-0.5 text-xs" style="color: {C.muted};">
								Accuracy, blunders and move quality need analysis. Openings, results and ratings
								already cover every game.
							</p>
						{/if}
					</div>
					{#if data.pending.length > 0}
						<button class="btn" onclick={runBatch} disabled={analyzing}>
							{analyzing ? 'Analyzing…' : `Analyze remaining (${data.pending.length})`}
						</button>
					{/if}
				</div>
				{#if analyzing && progress}
					<div class="mt-3">
						<div class="h-1.5 w-full overflow-hidden rounded-full" style="background: {C.track};">
							<div
								class="h-full rounded-full transition-[width] duration-150"
								style="width: {progress.gamesTotal
									? (progress.gamesDone / progress.gamesTotal) * 100
									: 0}%; background: {C.good};"
							></div>
						</div>
						<p class="mt-1 text-xs" style="color: {C.muted};">
							Game {progress.gamesDone + 1} / {progress.gamesTotal}
							{#if progress.current.total}· {progress.current.done}/{progress.current.total} positions{/if}
						</p>
					</div>
				{/if}
				{#if batchNote}<p class="mt-2 text-xs" style="color: {C.body};">{batchNote}</p>{/if}
			</section>

			<!-- Time class — primary axis (never pooled across classes) -->
			<div class="segmented mb-4">
				{#each data.stats as s, i (s.timeClass)}
					<button class="seg {i === selected ? 'seg-on' : ''}" onclick={() => (selected = i)}>
						{cap(s.timeClass)}
						<span class="seg-count">{s.totalGames}</span>
					</button>
				{/each}
			</div>

			<!-- Section sub-nav -->
			<nav class="tabbar mb-6">
				{#each VIEWS as v (v.id)}
					<button class="tab {view === v.id ? 'tab-on' : ''}" onclick={() => (view = v.id)}>
						{v.label}
					</button>
				{/each}
			</nav>

			{#if cur}
				{#if view === 'overview'}
					<!-- Hero: win rate + record -->
					<section class="card mb-4">
						<div class="flex flex-col gap-5 sm:flex-row sm:items-center">
							<div class="sm:w-44 sm:shrink-0">
								<div class="eyebrow mb-1">Win rate</div>
								<div
									class="text-5xl font-bold tracking-tight tabular-nums"
									style="color: {winRateColor(cur.winRate)};"
								>
									{Math.round(cur.winRate)}<span class="text-2xl font-semibold">%</span>
								</div>
								<div class="mt-1 text-sm" style="color: {C.muted};">
									over {cur.totalGames} games
								</div>
							</div>
							<div class="flex-1">
								<SegmentedBar segments={recordSegments(cur.record)} />
							</div>
						</div>
					</section>

					<!-- Trajectory -->
					<div class="mb-2 flex items-baseline justify-between">
						<h2 class="section-title">Am I improving?</h2>
						<span class="text-xs" style="color: {C.muted};">recent games vs. earlier</span>
					</div>
					<div class="grid gap-4 sm:grid-cols-3">
						{@render trendCard({
							title: 'Rating',
							series: toSeries(cur.ratingTrend),
							color: C.rating,
							unit: '',
							goodUp: true,
							empty: 'No rating data yet.',
							headline: 'last'
						})}
						{@render trendCard({
							title: 'Accuracy',
							series: toSeries(cur.accuracyTrend),
							color: C.good,
							unit: '%',
							goodUp: true,
							empty:
								cur.analyzedGames === 0
									? 'Analyze games to track accuracy.'
									: 'Not enough analyzed games.',
							avgLabel: cur.avgAccuracy === null ? undefined : `avg ${cur.avgAccuracy.toFixed(1)}%`,
							headline: 'recent',
							smooth: true
						})}
						{@render trendCard({
							title: 'Blunders / game',
							series: toSeries(cur.blunderTrend),
							color: C.bad,
							unit: '',
							goodUp: false,
							empty:
								cur.analyzedGames === 0
									? 'Analyze games to track blunders.'
									: 'Not enough analyzed games.',
							avgLabel:
								cur.avgBlundersPerGame === null
									? undefined
									: `avg ${cur.avgBlundersPerGame.toFixed(1)} / game`,
							headline: 'recent',
							smooth: true
						})}
					</div>
				{:else if view === 'mistakes'}
					{#if cur.analyzedGames === 0}
						<div class="card">
							<p class="muted">
								No analyzed games in this category yet. Hit <strong>Analyze remaining</strong> above to
								see move quality.
							</p>
						</div>
					{:else}
						<section class="card mb-4">
							<h2 class="section-title mb-1">Move quality</h2>
							<p class="caption mb-3">{cur.analyzedGames} analyzed games</p>
							<SegmentedBar
								segments={cur.moveClasses.map((m) => ({
									label: CLASS_LABEL[m.class],
									value: m.count,
									color: CLASS_COLOR[m.class]
								}))}
							/>
						</section>

						<section class="card mb-4">
							<h2 class="section-title mb-1">Blunders per game</h2>
							<p class="caption mb-3">every analyzed game, in order played</p>
							{#if cur.blunderTrend.length > 1}
								<LineChart series={toSeries(cur.blunderTrend)} color={C.bad} yMin={0} straight />
							{:else}
								<p class="muted">Not enough analyzed games to plot.</p>
							{/if}
						</section>

						<div class="grid gap-4 sm:grid-cols-2">
							<section class="card">
								<h2 class="section-title mb-1">Where slips cluster</h2>
								<p class="caption mb-3">blunders + mistakes by phase</p>
								<BarChart
									bars={cur.blundersByPhase.map((b) => ({
										label: PHASE_LABEL[b.phase],
										value: b.count
									}))}
									emphasizeMax
								/>
							</section>

							{#if cur.timeVsQuality.some((t) => t.sample > 0)}
								<section class="card">
									<h2 class="section-title mb-1">Do I slip when I rush?</h2>
									<p class="caption mb-3">serious-slip rate by time on the move</p>
									<BarChart
										bars={cur.timeVsQuality
											.filter((t) => t.sample > 0)
											.map((t) => ({
												label: t.bucket,
												value: t.slipRate,
												sublabel: `${t.sample}`
											}))}
										unit="%"
										max={100}
									/>
								</section>
							{/if}
						</div>

						<a href="/review/stats/winnable" class="winnable-teaser mt-4">
							<div>
								<h2 class="section-title">Winnable losses</h2>
								<p class="caption mt-0.5">
									{#if cur.winnable.length === 0}
										No winning position slipped in {cur.timeClass}. 🎯
									{:else}
										{cur.winnable.length} game{cur.winnable.length === 1 ? '' : 's'} you were clearly
										winning and didn't close out — filter the spikes, find the real ones.
									{/if}
								</p>
							</div>
							<span class="shrink-0 text-sm font-semibold" style="color: {C.rating};"
								>Explore →</span
							>
						</a>

						<a href="/review/blunders" class="winnable-teaser mt-4">
							<div>
								<h2 class="section-title">Blunder trainer</h2>
								<p class="caption mt-0.5">
									Walk every blunder across your games on a board, worst first, with the engine's
									better move and a grounded explanation.
								</p>
							</div>
							<span class="shrink-0 text-sm font-semibold" style="color: {C.rating};">Train →</span>
						</a>
					{/if}
				{:else if view === 'matchups'}
					<section class="card mb-4">
						<h2 class="section-title mb-3">By color</h2>
						<div class="grid gap-3 sm:grid-cols-2">
							{#each cur.byColor as c (c.side)}
								<div class="colorcard">
									<div class="mb-2 flex items-baseline justify-between">
										<span class="flex items-center gap-2 font-semibold" style="color: {C.ink};">
											<span class="chip {c.side === 'w' ? 'chip-w' : 'chip-b'}"></span>
											{c.side === 'w' ? 'White' : 'Black'}
										</span>
										<span class="text-sm tabular-nums" style="color: {C.muted};">
											<span class="font-semibold" style="color: {winRateColor(c.winRate)};"
												>{Math.round(c.winRate)}%</span
											>
											· {c.games}g{c.accuracy !== null ? ` · ${c.accuracy.toFixed(0)}% acc` : ''}
										</span>
									</div>
									<SegmentedBar
										segments={recordSegments(c.record)}
										showPercent={false}
										height="sm"
									/>
								</div>
							{/each}
						</div>
					</section>

					<div class="grid gap-4 sm:grid-cols-2">
						<section class="card">
							<h2 class="section-title mb-1">Win rate by opponent strength</h2>
							<p class="caption mb-3">relative to your rating</p>
							<BarChart
								bars={cur.byRatingBand.map((b) => ({
									label: BAND_LABEL[b.band],
									value: b.winRate,
									sublabel: `${b.games}g`
								}))}
								unit="%"
								max={100}
								baseline={50}
								tone="scale"
							/>
						</section>

						<section class="card">
							<h2 class="section-title mb-1">How games ended</h2>
							<p class="caption mb-3">termination method</p>
							<BarChart
								bars={cur.terminations.map((t) => ({ label: cap(t.method), value: t.count }))}
							/>
						</section>
					</div>

					<section class="card mt-4">
						<h2 class="section-title mb-1">Win rate by opening</h2>
						<p class="caption mb-3">top {Math.min(8, cur.byOpening.length)} most-played</p>
						<BarChart
							bars={cur.byOpening
								.slice(0, 8)
								.map((o) => ({ label: o.opening, value: o.winRate, sublabel: `${o.games}g` }))}
							unit="%"
							max={100}
							baseline={50}
							tone="scale"
						/>
					</section>
				{/if}
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
	}
	.section-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}
	.eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.caption {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.muted {
		font-size: 0.875rem;
		color: var(--text-muted);
	}
	.num-lg {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	/* Tap-to-explain popover anchored to a trend badge. */
	.tip-anchor {
		position: relative;
		display: inline-flex;
	}
	.tip {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		z-index: 30;
		width: 15rem;
		max-width: 70vw;
		padding: 0.6rem 0.7rem;
		border-radius: 0.6rem;
		border: 1px solid var(--border);
		background: var(--surface-2);
		box-shadow: var(--shadow-1);
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.4;
		text-align: left;
		color: var(--text-2);
	}
	.tip-title {
		margin-bottom: 0.2rem;
		font-weight: 600;
		color: var(--text);
	}

	/* iOS-style segmented control for the primary time-class axis.
	   Scrolls internally rather than overflowing the viewport on narrow phones. */
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

	/* Underline tab bar for the section sub-nav */
	.tabbar {
		display: flex;
		gap: 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.tab {
		position: relative;
		padding: 0.5rem 0;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-muted);
		transition: color var(--dur);
	}
	.tab:hover {
		color: var(--text-2);
	}
	.tab-on {
		color: var(--text);
		font-weight: 600;
	}
	.tab-on::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 2px;
		background: var(--brand);
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
		opacity: 0.6;
	}

	/* Roomier tap targets on touch devices; desktop keeps the compact controls. */
	@media (pointer: coarse) {
		.seg {
			min-height: 2.5rem;
		}
		.tab {
			min-height: 2.75rem;
		}
		.btn {
			min-height: 2.75rem;
		}
	}

	.colorcard {
		border-radius: 0.75rem;
		border: 1px solid var(--border);
		background: var(--surface-2);
		padding: 0.9rem;
	}
	.chip {
		display: inline-block;
		height: 0.85rem;
		width: 0.85rem;
		border-radius: 9999px;
		border: 1px solid var(--border-strong);
	}
	.chip-w {
		background: var(--piece-white);
	}
	.chip-b {
		background: var(--piece-black);
		border-color: var(--piece-black);
	}

	.winnable-teaser {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-radius: 1rem;
		border: 1px solid var(--border);
		background: var(--surface-1);
		padding: 1.1rem 1.25rem;
		box-shadow: var(--shadow-1);
		transition:
			background var(--dur-fast),
			box-shadow var(--dur-fast);
	}
	.winnable-teaser:hover {
		background: var(--surface-2);
		box-shadow: var(--shadow-2);
	}
</style>
