import { isMateScore } from '$lib/engine/engine';

/**
 * Win probability (0..100) for the side whose centipawn eval this is. Lichess'
 * logistic model. We classify on the *drop* in this value rather than raw
 * centipawns so a move behaves sensibly in already-winning or already-lost
 * positions (losing 200cp at +900 barely moves win%, but at 0 it's decisive).
 * Mate scores saturate to 0/100.
 */
export function winPercent(cp: number): number {
	if (isMateScore(cp)) return cp > 0 ? 100 : 0;
	const w = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
	return Math.max(0, Math.min(100, w));
}
