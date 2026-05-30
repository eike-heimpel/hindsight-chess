/**
 * Recency window for the drilling surfaces (blunder trainer + winnable losses).
 * A coarse "how far back do I care about" scope: your first-week games are stale
 * signal — the temporal sibling of the spike-vs-held robustness cut. Pure +
 * client-side: every candidate carries `playedAt`, so filtering is a predicate.
 *
 * Deliberately scoped to the *drilling* pages only — the stats dashboard's trend
 * cards already answer "am I improving?" with a windowed recent-vs-early
 * comparison, so a hard cutoff there would fight the existing design.
 */
export type RecencyWindow = 'all' | '12m' | '6m' | '90d' | '30d';

export const RECENCY_OPTIONS: { id: RecencyWindow; label: string; days: number | null }[] = [
	{ id: 'all', label: 'All time', days: null },
	{ id: '12m', label: '12 mo', days: 365 },
	{ id: '6m', label: '6 mo', days: 182 },
	{ id: '90d', label: '90 d', days: 90 },
	{ id: '30d', label: '30 d', days: 30 }
];

/** Recent-but-still-enough-volume default, per the "recent default" decision. */
export const RECENCY_DEFAULT: RecencyWindow = '6m';

const DAYS = new Map(RECENCY_OPTIONS.map((o) => [o.id, o.days]));

const DAY_MS = 86_400_000;

export function withinWindow(
	playedAt: Date | string,
	window: RecencyWindow,
	now: Date = new Date()
): boolean {
	const days = DAYS.get(window);
	if (days == null) return true;
	return new Date(playedAt).getTime() >= now.getTime() - days * DAY_MS;
}
