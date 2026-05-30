<script lang="ts">
	/**
	 * Minimal sparkline for per-game trends. No axes, no gridlines — just the
	 * shape, a soft gradient fill, and (optionally) the min / max value labelled
	 * at the bottom / top edge. Pointer/tap reveals a tooltip (tablet-first).
	 *
	 * For noisy per-game stats, pass `smoothWindow`: the raw series is drawn faint
	 * and a centered moving-average trend line takes the foreground, so "am I
	 * improving?" is legible instead of buried in the jitter. The big "current
	 * value + delta" readout lives in the *card* around this.
	 */
	import { linear, smoothPath, polyline, movingAverage } from './scale';
	import { C } from './palette';

	type Point = { label: string; value: number };

	let {
		series,
		color = C.good,
		yMin,
		yMax,
		unit = '',
		endpoints = true,
		smoothWindow,
		straight = false,
		mark,
		markColor = C.bad,
		threshold
	}: {
		series: Point[];
		color?: string;
		yMin?: number;
		yMax?: number;
		unit?: string;
		/** Label the lowest value at the bottom edge and highest at the top. */
		endpoints?: boolean;
		/** When set, foreground a centered moving-average of this window and draw
		 *  the raw series faintly behind it. */
		smoothWindow?: number;
		/** Straight segments instead of a smoothed curve — honest for raw, discrete
		 *  per-game data where a curve would overshoot between points. */
		straight?: boolean;
		/** Highlight one series index with a vertical line + ring (e.g. the move
		 *  where a winning position was given back). */
		mark?: number;
		markColor?: string;
		/** Draw a horizontal reference hairline at this y-value (e.g. the "clearly
		 *  winning" win-% floor), so a plateau-above vs a spike reads at a glance. */
		threshold?: number;
	} = $props();

	const W = 600;
	const H = 180;
	const PAD = { top: 18, right: 10, bottom: 18, left: 10 };

	const values = $derived(series.map((p) => p.value));
	const lo = $derived(yMin ?? Math.min(...values));
	const hiRaw = $derived(yMax ?? Math.max(...values));
	const hi = $derived(hiRaw > lo ? hiRaw : lo + 1);

	const sx = $derived(linear([0, Math.max(1, series.length - 1)], [PAD.left, W - PAD.right]));
	const sy = $derived(linear([lo, hi], [H - PAD.bottom, PAD.top]));

	const pts = $derived(series.map((p, i) => ({ x: sx(i), y: sy(p.value) })));

	// Foreground line: the moving average when smoothing, else the raw series.
	const trendValues = $derived(smoothWindow ? movingAverage(values, smoothWindow) : values);
	const trendPts = $derived(trendValues.map((v, i) => ({ x: sx(i), y: sy(v) })));
	const line = $derived(
		straight ? `M${trendPts.map((p) => `${p.x},${p.y}`).join(' L')}` : smoothPath(trendPts)
	);
	const area = $derived(
		trendPts.length > 1
			? `${line} L${trendPts.at(-1)!.x},${H - PAD.bottom} L${trendPts[0].x},${H - PAD.bottom} Z`
			: ''
	);

	const last = $derived(trendPts.at(-1)!);
	// `color` is a `var(--…)` string, so strip everything but alphanumerics for a
	// valid SVG gradient id / url(#…) reference.
	const gradId = $derived(
		`lc-${color.replace(/[^a-z0-9]/gi, '')}-${series.length}-${Math.round(hi)}`
	);

	let active = $state<number | null>(null);

	function track(e: PointerEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const frac = (e.clientX - rect.left) / rect.width;
		active = Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1))));
	}
	const fmt = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
</script>

<div class="relative w-full" style="aspect-ratio: {W} / {H};">
	<svg viewBox="0 0 {W} {H}" class="h-full w-full overflow-visible" aria-hidden="true">
		<defs>
			<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.22" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>

		{#if threshold != null && threshold >= lo && threshold <= hi}
			<line
				x1={PAD.left}
				y1={sy(threshold)}
				x2={W - PAD.right}
				y2={sy(threshold)}
				class="threshold"
			/>
		{/if}

		{#if pts.length > 1}
			<path d={area} fill="url(#{gradId})" />
			{#if smoothWindow}
				<!-- Raw per-game series, faint behind the trend line. -->
				<polyline
					points={polyline(pts)}
					fill="none"
					stroke={color}
					stroke-width="1.25"
					stroke-opacity="0.28"
					stroke-linejoin="round"
				/>
			{/if}
			<path
				d={line}
				fill="none"
				stroke={color}
				stroke-width="2.5"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
		{/if}

		{#if active !== null}
			<line
				x1={pts[active].x}
				y1={PAD.top - 8}
				x2={pts[active].x}
				y2={H - PAD.bottom}
				class="cursor"
			/>
			<circle
				cx={pts[active].x}
				cy={pts[active].y}
				r="5"
				fill="var(--surface-1)"
				stroke={color}
				stroke-width="2.5"
			/>
		{/if}

		{#if mark != null && pts[mark]}
			<line
				x1={pts[mark].x}
				y1={PAD.top - 8}
				x2={pts[mark].x}
				y2={H - PAD.bottom}
				stroke={markColor}
				stroke-width="1.5"
				stroke-dasharray="2 3"
				stroke-opacity="0.7"
			/>
			<circle
				cx={pts[mark].x}
				cy={pts[mark].y}
				r="5"
				fill="var(--surface-1)"
				stroke={markColor}
				stroke-width="2.5"
			/>
		{/if}

		<!-- Resting end-of-series marker -->
		{#if pts.length}
			<circle cx={last.x} cy={last.y} r="3.5" fill={color} />
		{/if}
	</svg>

	{#if endpoints && pts.length > 1}
		<span class="endpoint top-0" style="color: {C.muted};">{fmt(hi)}</span>
		<span class="endpoint bottom-0" style="color: {C.muted};">{fmt(lo)}</span>
	{/if}

	<div
		class="absolute inset-0"
		role="presentation"
		onpointermove={track}
		onpointerdown={track}
		onpointerleave={() => (active = null)}
	></div>

	{#if active !== null}
		{@const p = series[active]}
		<div
			class="pointer-events-none absolute -translate-x-1/2 rounded-lg px-2 py-1 text-center text-xs whitespace-nowrap shadow-lg"
			style="left: {(pts[active].x / W) * 100}%; top: -2px; background: {C.ink}; color: var(--bg);"
		>
			<span class="font-semibold">{fmt(p.value)}</span>
			<span class="ml-1 opacity-70">{p.label}</span>
		</div>
	{/if}
</div>

<style>
	.cursor {
		stroke: var(--border-strong);
		stroke-width: 1.5;
		stroke-dasharray: 2 3;
	}
	.threshold {
		stroke: var(--border-strong);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}
	.endpoint {
		position: absolute;
		left: 0;
		font-size: 0.7rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		pointer-events: none;
		text-shadow:
			0 0 3px var(--surface-1),
			0 0 3px var(--surface-1);
	}
</style>
