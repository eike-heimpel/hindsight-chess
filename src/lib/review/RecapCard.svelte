<script lang="ts" module>
	export type RecapView = {
		outcome: 'win' | 'loss' | 'draw';
		opponent: string;
		opening?: string | null;
		timeClass: string;
		headline: string | null;
		/** My-POV win-% (0..100) at every position — drives the sparkline. */
		spark: number[] | null;
		peakWin: number | null;
		accuracy: number | null;
		analyzed: boolean;
	};
</script>

<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * `href` is a runtime-built game link (carries a ?me query string); resolve()
	 * adds noise without value here. */
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Attachment } from 'svelte/attachments';
	import type { Snippet } from 'svelte';

	/**
	 * The recap card — your latest game as a plain-English headline over a win-%
	 * sparkline. Presentational: it draws whatever `recap` it's handed. The home
	 * feeds it live, self-analyzing games (with the line-draw attachment + a flip
	 * pager); the landing feeds it a static example. One card, no drift.
	 */
	let {
		recap,
		/** When set, the headline/chart/footer become a link to the full game. */
		href = null,
		/** Mid-analysis: show a progress bar in place of the (not-yet-ready) chart. */
		analyzing = false,
		progress = { done: 0, total: 0 },
		/** When >0, the bar sweeps over this window instead of tracking real
		 *  progress — the teaser's deliberate "settle" beat. In-app reveals leave
		 *  it 0 so the bar stays honest (never feels longer than it is). */
		beatMs = 0,
		/** Optional attachment for the polyline — the home's line-draw reveal. */
		lineAttach = () => {},
		/** Optional header-right slot — the home's newer/older flip controls. */
		pager
	}: {
		recap: RecapView;
		href?: string | null;
		analyzing?: boolean;
		progress?: { done: number; total: number };
		beatMs?: number;
		lineAttach?: Attachment<SVGPolylineElement>;
		pager?: Snippet;
	} = $props();

	type Outcome = RecapView['outcome'];
	const outcomeLabel: Record<Outcome, string> = { win: 'Won', loss: 'Lost', draw: 'Drew' };
	const outcomeToken: Record<Outcome, string> = { win: 'good', loss: 'bad', draw: 'draw' };

	const progressPct = $derived(progress.total ? (progress.done / progress.total) * 100 : 0);

	// Sparkline: my-POV win-% (0..100) → a polyline in a 100×30 viewBox, win up top.
	const sparkPoints = $derived.by(() => {
		const s = recap.spark;
		if (!s || s.length < 2) return null;
		const n = s.length;
		return s.map((v, i) => `${(i / (n - 1)) * 100},${((100 - v) / 100) * 30}`).join(' ');
	});

	// The peak win-% point, as percentages over the chart, for an in-graph label.
	// (The SVG is preserveAspectRatio="none", so we overlay HTML instead of <text>.)
	const peakMarker = $derived.by(() => {
		const s = recap.spark;
		if (!s || s.length < 2 || recap.peakWin == null) return null;
		let bi = 0;
		for (let i = 1; i < s.length; i++) if (s[i] > s[bi]) bi = i;
		const x = (bi / (s.length - 1)) * 100; // % across width
		const y = 100 - s[bi]; // % down (spark is 0..100, win up top)
		// Keep the label inside the card: left-align near the start, right-align
		// near the end, centered otherwise.
		const tx = x < 15 ? '0' : x > 85 ? '-100%' : '-50%';
		return { x, y, value: s[bi], tx };
	});
</script>

{#snippet body()}
	<div class="mt-4 grid">
		{#key recap.headline}
			<p
				class="col-start-1 row-start-1 text-xl leading-snug font-medium text-text"
				in:fly={{ y: 10, duration: 500, delay: 120, easing: cubicOut }}
				out:fade={{ duration: 200 }}
			>
				{recap.headline}
			</p>
		{/key}
	</div>

	{#if analyzing}
		<div class="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
			{#if beatMs > 0}
				<!-- Teaser beat: a smooth eased sweep over the floor, decoupled from
				     raw analysis speed so it lands the same on any device. -->
				<div class="recap-beat h-full rounded-full bg-brand" style="--beat: {beatMs}ms"></div>
			{:else}
				<div
					class="h-full rounded-full bg-brand transition-[width] duration-150"
					style="width: {progressPct}%"
				></div>
			{/if}
		</div>
	{:else if sparkPoints}
		<div class="relative mt-5">
			<svg
				class="block h-14 w-full"
				viewBox="0 0 100 30"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<line
					x1="0"
					y1="15"
					x2="100"
					y2="15"
					stroke="var(--border)"
					stroke-width="0.5"
					stroke-dasharray="2 2"
					vector-effect="non-scaling-stroke"
				/>
				<polyline
					{@attach lineAttach}
					points={sparkPoints}
					fill="none"
					stroke="var(--brand)"
					stroke-width="1.5"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			{#if peakMarker}
				<span
					class="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-surface-1"
					style="left: {peakMarker.x}%; top: {peakMarker.y}%;"
				></span>
				<span
					class="absolute text-[11px] font-medium whitespace-nowrap text-text-2"
					style="left: {peakMarker.x}%; top: calc({peakMarker.y}% - 0.45rem); transform: translate({peakMarker.tx}, -100%);"
				>
					Peak <span class="font-semibold text-text tabular-nums"
						>{peakMarker.value.toFixed(0)}%</span
					>
				</span>
			{/if}
		</div>
	{/if}

	<div class="mt-4 flex items-center gap-5 text-sm">
		{#if analyzing}
			<span class="text-text-muted"
				>Analyzing your game…{#if beatMs === 0}
					{progress.done}/{progress.total}{/if}</span
			>
		{:else if recap.analyzed}
			{#if recap.accuracy != null}
				<span class="text-text-2" transition:fade={{ duration: 400 }}
					>Accuracy <span class="font-semibold text-text tabular-nums"
						>{recap.accuracy.toFixed(0)}%</span
					></span
				>
			{/if}
		{:else}
			<span class="text-text-muted">Not analyzed yet — open it to run the engine.</span>
		{/if}
		<span class="ml-auto font-medium text-brand">See the full game →</span>
	</div>
{/snippet}

<section
	class="rounded-xl border border-border bg-surface-1 p-6"
	style="box-shadow: var(--shadow-1);"
>
	<div class="flex items-center gap-3">
		<span
			class="rounded-md px-2.5 py-1 text-xs font-semibold"
			style="background: color-mix(in srgb, var(--{outcomeToken[
				recap.outcome
			]}) 16%, transparent); color: var(--{outcomeToken[recap.outcome]});"
		>
			{outcomeLabel[recap.outcome]}
		</span>
		<span class="min-w-0 flex-1 truncate text-base text-text-2">
			vs {recap.opponent}{#if recap.opening}<span class="text-text-muted">
					· {recap.opening}</span
				>{/if}
		</span>
		<span class="shrink-0 text-xs text-text-muted capitalize">{recap.timeClass}</span>
		{#if pager}{@render pager()}{/if}
	</div>

	{#if href}
		<a {href} class="group block transition-opacity hover:opacity-90">{@render body()}</a>
	{:else}
		{@render body()}
	{/if}
</section>

<style>
	/* The teaser's settle beat: ease toward the end without hitting 100%, so a
	   slower-than-floor device reads as "almost there" rather than stuck. */
	.recap-beat {
		width: 8%;
		animation: recap-beat var(--beat) ease-out forwards;
	}
	@keyframes recap-beat {
		to {
			width: 94%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.recap-beat {
			animation: none;
			width: 94%;
		}
	}
</style>
