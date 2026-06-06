/**
 * Pure selector over a GameAnalysis: the moments that mattered. A player move
 * that dropped >=8% win chance is a 'mistake'; an opponent move that dropped
 * >=12% sets up an 'opportunity' on the player's reply. Top 3 by magnitude,
 * ordered by ply; fallback to the single worst own move when none clear the
 * bars. Used for quick-start chips (variant A) and move-list / eval markers
 * (variant B). Pure + browser-safe.
 *
 * Note: this only ever produces 'mistake' / 'opportunity'. A user-picked quiet
 * move ('chosen') is derived server-side from the ply, not by this selector.
 */
import type { GameAnalysis } from '$lib/review/analysis';
import type { ReviewGame } from '$lib/review/types';
import type { Side } from '$lib/chess/types';

/** Win-% drop at/above which a player's own move counts as a mistake worth a look. */
const MISTAKE_DELTA = 8;
/** Win-% drop at/above which the opponent's move opens an opportunity to punish. */
const OPPORTUNITY_DELTA = 12;

export type Moment = {
	ply: number;
	kind: 'mistake' | 'opportunity';
	magnitude: number;
	setup: { opponentBlunderSan: string; opponentDropPct: number } | null;
};

export function selectTurningPoints(a: GameAnalysis, g: ReviewGame, side: Side): Moment[] {
	const opp: Side = side === 'w' ? 'b' : 'w';
	const cands: Moment[] = [];
	for (const m of a.moves) {
		if (m.color === side && m.delta >= MISTAKE_DELTA) {
			cands.push({ ply: m.ply, kind: 'mistake', magnitude: m.delta, setup: null });
		}
		if (m.color === opp && m.delta >= OPPORTUNITY_DELTA) {
			const reply = a.moves.find((x) => x.ply === m.ply + 1);
			if (reply) {
				cands.push({
					ply: reply.ply,
					kind: 'opportunity',
					magnitude: m.delta,
					setup: { opponentBlunderSan: g.moves[m.ply - 1].san, opponentDropPct: m.delta }
				});
			}
		}
	}

	const best: Record<number, Moment> = {};
	for (const c of cands) {
		const cur = best[c.ply];
		if (!cur || cur.magnitude < c.magnitude) best[c.ply] = c;
	}

	let arr = Object.values(best)
		.sort((x, y) => y.magnitude - x.magnitude)
		.slice(0, 3);

	if (arr.length === 0) {
		const mine = a.moves.filter((x) => x.color === side).sort((x, y) => y.delta - x.delta);
		if (mine[0]) {
			arr = [{ ply: mine[0].ply, kind: 'mistake', magnitude: mine[0].delta, setup: null }];
		}
	}

	return arr.sort((x, y) => x.ply - y.ply);
}
