<script lang="ts">
	import { C, CLASS_COLOR } from '$lib/review/charts/palette';
	import type { MoveClass } from '$lib/review/classify';

	/**
	 * The classification chip + sentence under the board: a coloured dot, the
	 * class label, and "{side} played {san}". The engine's better move is shown
	 * when supplied (the replay verdict) and omitted when it isn't (a free
	 * exploration move, where "better" is just the live arrow on the board).
	 */
	let {
		classification,
		mover,
		san,
		bestSan = null
	}: {
		classification: MoveClass;
		mover: 'w' | 'b';
		san: string;
		bestSan?: string | null;
	} = $props();

	const LABEL: Record<MoveClass, string> = {
		best: 'Best',
		good: 'Good',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
	const cc = $derived(CLASS_COLOR[classification]);
</script>

<div
	class="verdict"
	style="background: color-mix(in srgb, {cc} 10%, transparent); border-color: color-mix(in srgb, {cc} 22%, transparent);"
>
	<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background: {cc};"></span>
	<span class="font-semibold" style="color: {cc};">{LABEL[classification]}</span>
	<span class="text-sm" style="color: {C.body};">
		{mover === 'w' ? 'White' : 'Black'} played
		<strong style="color: {C.ink};">{san}</strong>{#if bestSan}, best was
			<strong style="color: {C.ink};">{bestSan}</strong>{/if}
	</span>
</div>

<style>
	.verdict {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		border-radius: 0.85rem;
		border: 1px solid;
		padding: 0.7rem 0.95rem;
	}
</style>
