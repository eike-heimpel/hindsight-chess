<script lang="ts">
	/**
	 * Horizontal bars, pure HTML/CSS (reflows responsively, labels never clip).
	 * One row: label · track+fill · value. Used for distributions, phase/time
	 * buckets, openings and matchups.
	 *
	 * `tone`:
	 *  - 'neutral' (default) — single accent fill
	 *  - 'scale'   — colour each bar by its value on the win/loss scale (for
	 *                win-rate bars, so strong/weak matchups pop)
	 * `baseline` draws a faint reference tick across every track (e.g. 50%).
	 */
	import { C, winRateColor } from './palette';

	type Bar = { label: string; value: number; sublabel?: string };

	let {
		bars,
		unit = '',
		max,
		baseline,
		tone = 'neutral',
		emphasizeMax = false
	}: {
		bars: Bar[];
		unit?: string;
		/** Track full-scale; defaults to the largest bar value. */
		max?: number;
		/** Reference line drawn across each track, in value units. */
		baseline?: number;
		tone?: 'neutral' | 'scale';
		/** Tint the single largest bar (e.g. worst phase). Ignored when tone='scale'. */
		emphasizeMax?: boolean;
	} = $props();

	const scale = $derived(max ?? Math.max(1, ...bars.map((b) => b.value)));
	const peak = $derived(Math.max(...bars.map((b) => b.value)));
	const fmt = (v: number) => `${Math.round(v * 10) / 10}${unit}`;

	function fillFor(value: number): string {
		if (tone === 'scale') return winRateColor(value);
		if (emphasizeMax && value === peak && peak > 0) return C.bad;
		return C.body;
	}
</script>

<ul class="space-y-2.5">
	{#each bars as b (b.label)}
		<li class="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
			<span class="truncate text-stone-500" title={b.label}>{b.label}</span>
			<span class="relative h-2.5 overflow-hidden rounded-full" style="background: {C.track};">
				<span
					class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
					style="width: {Math.max(
						0,
						Math.min(100, (b.value / scale) * 100)
					)}%; background: {fillFor(b.value)};"
				></span>
				{#if baseline != null && baseline > 0 && baseline < scale}
					<span
						class="absolute inset-y-0 w-px"
						style="left: {(baseline / scale) * 100}%; background: {C.muted}; opacity: 0.5;"
					></span>
				{/if}
			</span>
			<span class="text-right tabular-nums" style="color: {C.ink};">
				<span class="font-semibold">{fmt(b.value)}</span>
				{#if b.sublabel}<span class="ml-1 font-normal" style="color: {C.muted};">{b.sublabel}</span
					>{/if}
			</span>
		</li>
	{/each}
</ul>
