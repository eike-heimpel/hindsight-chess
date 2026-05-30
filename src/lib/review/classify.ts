/**
 * Move classification, chess.com-style but our own five buckets. Classified on
 * the win-% drop a move concedes (see `winPercent`). Thresholds are the tuning
 * knob — calibrated against chess.com's own per-game accuracies (see the
 * calibration script). The fancier `Brilliant / Great / Miss / Book` classes
 * are deferred (they need sacrifice / only-move / theory detection).
 */
export const MOVE_CLASSES = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;
export type MoveClass = (typeof MOVE_CLASSES)[number];

/** Upper bound (inclusive) on win-% drop for each class below 'blunder'. */
export const CLASS_THRESHOLDS = {
	best: 1,
	good: 3,
	inaccuracy: 7,
	mistake: 15
} as const;

export function classifyMove(args: { delta: number; isBest: boolean }): MoveClass {
	if (args.isBest || args.delta <= CLASS_THRESHOLDS.best) return 'best';
	if (args.delta <= CLASS_THRESHOLDS.good) return 'good';
	if (args.delta <= CLASS_THRESHOLDS.inaccuracy) return 'inaccuracy';
	if (args.delta <= CLASS_THRESHOLDS.mistake) return 'mistake';
	return 'blunder';
}
