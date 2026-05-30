/**
 * The stats dashboard's colour system. One small, deliberate palette so the
 * charts read as a designed set rather than a pile of ad-hoc hex codes.
 *
 * Three semantic families do all the work:
 *  - **good** (emerald) — wins, accuracy, best moves
 *  - **bad** (rose) — losses, blunders
 *  - **neutral** (indigo for the rating "your number", stone for structure)
 *
 * The five-step move-quality ramp shares those poles (best = good, blunder =
 * bad) and steps monotonically through it, so a quality distribution reads as
 * one scale instead of five unrelated swatches.
 */
import type { MoveClass } from '../classify';

export const C = {
	ink: '#1c1917', // stone-900 — primary text / strong marks
	body: '#57534e', // stone-600 — labels
	muted: '#a8a29e', // stone-400 — captions, sublabels
	track: '#f5f5f4', // stone-100 — chart tracks
	grid: '#e7e5e4', // stone-200 — hairlines

	good: '#059669', // emerald-600
	draw: '#d6d3d1', // stone-300
	bad: '#e11d48', // rose-600
	rating: '#6366f1' // indigo-500
} as const;

/** Win / draw / loss, sharing the good/bad poles. */
export const RECORD_COLOR = { win: C.good, draw: C.draw, loss: C.bad } as const;

/** Monotonic good→bad ramp for the five move classes. Same -600 saturation
 *  across the board so it looks like one scale, not five hues. */
export const CLASS_COLOR: Record<MoveClass, string> = {
	best: '#059669', // emerald-600
	good: '#65a30d', // lime-600
	inaccuracy: '#ca8a04', // yellow-600
	mistake: '#ea580c', // orange-600
	blunder: '#e11d48' // rose-600
};

/** A win-rate (0–100) on the good↔bad scale: red below 50, green above. Used to
 *  colour win-rate bars by value so the eye lands on strong/weak matchups. */
export function winRateColor(pct: number): string {
	return pct >= 50 ? C.good : C.bad;
}
