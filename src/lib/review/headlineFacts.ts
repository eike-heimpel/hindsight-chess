/**
 * Facts for the LLM "story" headline. The fix for headlines that only know the
 * peak: feed the model the *shape* of the win-% curve — a downsampled
 * trajectory plus the biggest reversals — so it can narrate an up-down-up game
 * ("you clawed it back, then let it go"), not just the high-water mark. Pure: no
 * engine, no I/O. Win-% is always the player's POV (from `PerspectiveGame`).
 */
import type { Side } from '$lib/chess/types';
import type { MoveClass } from './classify';
import type { Outcome, PerspectiveGame } from './stats/types';

/** A point on the my-POV win-% curve. `moveNumber` is the full-move number. */
export type TrajectoryPoint = { moveNumber: number; winPct: number };

/** A reversal between two consecutive local extrema of the curve. */
export type Swing = { moveNumber: number; from: number; to: number };

/** The single costliest move, from my analyzed moves (max win-% drop). */
export type BiggestMistake = {
	moveNumber: number;
	san: string;
	classification: MoveClass;
	drop: number;
};

export type HeadlineFacts = {
	outcome: Outcome;
	opponent: string;
	opening: string | null;
	/** My-side accuracy %, when analyzed. */
	accuracy: number | null;
	side: Side;
	/** ~12–16 (moveNumber, winPct) points along the curve, my POV, start→end. */
	trajectory: TrajectoryPoint[];
	/** The 2–3 largest reversals (|Δ win%| ≥ threshold), in move order. */
	swings: Swing[];
	biggestMistake: BiggestMistake | null;
};

/** Min |Δ win%| between consecutive extrema to count as a swing worth narrating. */
const SWING_MIN = 15;
/** Roughly how many trajectory points to hand the model. */
const TRAJECTORY_POINTS = 14;

/** Full-move number for a position at timeline index `ply` (0 = start). */
const moveNumberOf = (ply: number) => Math.ceil(ply / 2);

/** Evenly-spaced indices across `[0, length-1]`, always including both ends. */
function downsampleIndices(length: number, target: number): number[] {
	if (length <= target) return Array.from({ length }, (_, i) => i);
	const out: number[] = [];
	for (let k = 0; k < target; k++) {
		out.push(Math.round((k * (length - 1)) / (target - 1)));
	}
	return [...new Set(out)];
}

/** Indices of local extrema (slope reversals), including both endpoints. */
function extremaIndices(t: number[]): number[] {
	const ext = [0];
	let lastDir = 0;
	for (let i = 1; i < t.length; i++) {
		const dir = Math.sign(t[i] - t[i - 1]);
		if (dir !== 0 && lastDir !== 0 && dir !== lastDir) ext.push(i - 1);
		if (dir !== 0) lastDir = dir;
	}
	ext.push(t.length - 1);
	return [...new Set(ext)];
}

function detectSwings(timeline: number[]): Swing[] {
	const ext = extremaIndices(timeline);
	const swings: Swing[] = [];
	for (let i = 1; i < ext.length; i++) {
		const a = ext[i - 1];
		const b = ext[i];
		const delta = timeline[b] - timeline[a];
		if (Math.abs(delta) >= SWING_MIN) {
			swings.push({
				moveNumber: moveNumberOf(b),
				from: Math.round(timeline[a]),
				to: Math.round(timeline[b])
			});
		}
	}
	return swings
		.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from))
		.slice(0, 3)
		.sort((x, y) => x.moveNumber - y.moveNumber);
}

function biggestMistakeOf(p: PerspectiveGame): BiggestMistake | null {
	let worst: BiggestMistake | null = null;
	for (const m of p.moves) {
		if (m.winDrop == null || m.classification == null || m.winDrop <= 0) continue;
		if (!worst || m.winDrop > worst.drop) {
			worst = {
				moveNumber: moveNumberOf(m.ply),
				san: m.san,
				classification: m.classification,
				drop: Math.round(m.winDrop)
			};
		}
	}
	return worst;
}

export function buildHeadlineFacts(p: PerspectiveGame): HeadlineFacts {
	const timeline = p.winTimeline ?? [];
	const trajectory = downsampleIndices(timeline.length, TRAJECTORY_POINTS).map((i) => ({
		moveNumber: moveNumberOf(i),
		winPct: Math.round(timeline[i])
	}));

	return {
		outcome: p.outcome,
		opponent: p.opponent,
		opening: p.opening ?? null,
		accuracy: p.accuracy ?? null,
		side: p.side,
		trajectory,
		swings: timeline.length >= 2 ? detectSwings(timeline) : [],
		biggestMistake: biggestMistakeOf(p)
	};
}
