/**
 * Tiny scale helpers for the hand-built SVG charts — no charting library. Pure
 * functions so the components stay declarative and these stay testable.
 */

/** Map a value from a numeric domain onto a pixel range (linear). */
export function linear(domain: [number, number], range: [number, number]): (v: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0 || 1;
	return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** "Nice" evenly-spaced ticks covering [min, max], roughly `count` of them.
 *  Returns at least [min, max]; used for the y-axis gridlines. */
export function ticks(min: number, max: number, count = 4): number[] {
	if (max <= min) return [min];
	const raw = (max - min) / count;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const norm = raw / mag;
	const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
	const start = Math.ceil(min / step) * step;
	const out: number[] = [];
	for (let t = start; t <= max + step / 1000; t += step) out.push(Math.round(t * 1000) / 1000);
	return out;
}

/** SVG polyline `points` string from (x,y) pairs. */
export function polyline(pts: { x: number; y: number }[]): string {
	return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Centered moving average; the window shrinks at the edges so the line spans
 *  the full series with no lag. Smooths a noisy per-game series into a readable
 *  trend line. */
export function movingAverage(values: number[], window: number): number[] {
	const half = Math.floor(window / 2);
	return values.map((_, i) => {
		const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
		return slice.reduce((a, b) => a + b, 0) / slice.length;
	});
}

/** Smooth SVG path through (x,y) pairs via Catmull-Rom → cubic bézier, low
 *  tension so it stays close to the data (no wild overshoot). Returns a plain
 *  polyline for < 3 points. */
export function smoothPath(pts: { x: number; y: number }[]): string {
	if (pts.length < 2) return '';
	if (pts.length < 3) return `M${pts.map((p) => `${p.x},${p.y}`).join(' L')}`;
	const t = 0.18;
	let d = `M${pts[0].x},${pts[0].y}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1x = p1.x + (p2.x - p0.x) * t;
		const c1y = p1.y + (p2.y - p0.y) * t;
		const c2x = p2.x - (p3.x - p1.x) * t;
		const c2y = p2.y - (p3.y - p1.y) * t;
		d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
	}
	return d;
}
