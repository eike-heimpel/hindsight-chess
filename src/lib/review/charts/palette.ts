/**
 * The stats dashboard's colour system, expressed as semantic-token references
 * (see docs/design/system.md). Every value is a `var(--…)` so charts theme with
 * the rest of the app — never a raw hex here.
 *
 * Three semantic families do the work: **good** (wins, accuracy, best moves),
 * **bad** (losses, blunders), and the brand accent for the rating "your number".
 * The five-step move-quality ramp shares the good/bad poles and steps
 * monotonically between them, so a quality distribution reads as one scale.
 *
 * These resolve in inline `style=` and SVG `fill`/`stroke` attributes, so the
 * strings must stay plain `var(--x)` — to tint one, wrap it in `color-mix()` at
 * the call site rather than concatenating a hex alpha.
 */
import type { MoveClass } from '../classify';

export const C = {
	ink: 'var(--text)', // primary text / strong marks
	body: 'var(--text-2)', // labels
	muted: 'var(--text-muted)', // captions, sublabels
	track: 'var(--surface-2)', // chart tracks
	grid: 'var(--border)', // hairlines

	good: 'var(--good)',
	draw: 'var(--draw)',
	bad: 'var(--bad)',
	rating: 'var(--brand)'
} as const;

/** Win / draw / loss, sharing the good/bad poles. */
export const RECORD_COLOR = { win: C.good, draw: C.draw, loss: C.bad } as const;

/** Monotonic good→bad ramp for the five move classes (one scale, not five hues). */
export const CLASS_COLOR: Record<MoveClass, string> = {
	best: 'var(--class-best)',
	good: 'var(--class-good)',
	inaccuracy: 'var(--class-inaccuracy)',
	mistake: 'var(--class-mistake)',
	blunder: 'var(--class-blunder)'
};

/** A win-rate (0–100) on the good↔bad scale: red below 50, green above. Used to
 *  colour win-rate bars by value so the eye lands on strong/weak matchups. */
export function winRateColor(pct: number): string {
	return pct >= 50 ? C.good : C.bad;
}
