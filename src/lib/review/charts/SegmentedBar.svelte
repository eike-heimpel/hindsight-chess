<script lang="ts">
	/**
	 * One 100%-stacked horizontal bar + legend, for a part-of-whole breakdown
	 * (move-class mix, win/draw/loss record). Pure HTML/CSS. Zero-value segments
	 * drop out of the bar but stay in the legend so the shape stays honest.
	 */
	import { C } from './palette';

	type Segment = { label: string; value: number; color: string };

	let {
		segments,
		showPercent = true,
		height = 'md'
	}: { segments: Segment[]; showPercent?: boolean; height?: 'sm' | 'md' } = $props();

	const total = $derived(segments.reduce((a, s) => a + s.value, 0));
	const pct = (v: number) => (total ? (v / total) * 100 : 0);
	const h = $derived(height === 'sm' ? '0.5rem' : '0.75rem');
</script>

<div
	class="flex w-full gap-0.5 overflow-hidden rounded-full"
	style="height: {h}; background: {C.track};"
>
	{#each segments as s (s.label)}
		{#if s.value > 0}
			<span
				class="first:rounded-l-full last:rounded-r-full"
				style="width: {pct(s.value)}%; background: {s.color};"
				title="{s.label}: {s.value}"
			></span>
		{/if}
	{/each}
</div>

<ul class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
	{#each segments as s (s.label)}
		<li class="flex items-center gap-1.5">
			<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {s.color};"></span>
			<span style="color: {C.body};">{s.label}</span>
			<span class="font-semibold tabular-nums" style="color: {C.ink};">
				{s.value}{#if showPercent && total}<span
						class="ml-0.5 font-normal"
						style="color: {C.muted};">· {Math.round(pct(s.value))}%</span
					>{/if}
			</span>
		</li>
	{/each}
</ul>
