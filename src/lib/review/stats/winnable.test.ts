import { describe, it, expect } from 'vitest';
import type { MoveClass } from '../classify';
import type { PerspectiveGame, WinnableCandidate, WinnableMove } from './types';
import { buildCandidate, classifyWinnable } from './winnable';

let plyN = 1;
function mv(winBefore: number, winAfter: number, cls: MoveClass, material = 0): WinnableMove {
	const ply = plyN;
	plyN += 2; // my moves are every other ply
	return {
		ply,
		moveNumber: Math.ceil(ply / 2),
		san: 'x',
		classification: cls,
		winBefore,
		winAfter,
		phase: 'middlegame',
		materialLeadBefore: material
	};
}

function candidate(
	myMoves: WinnableMove[],
	over: Partial<WinnableCandidate> = {}
): WinnableCandidate {
	plyN = 1;
	return {
		source: 'chesscom',
		gameId: 'g',
		playedAt: new Date('2026-01-01'),
		opponent: 'foe',
		side: 'w',
		outcome: 'loss',
		peakWin: Math.max(...myMoves.map((m) => m.winBefore), 0),
		maxMaterialLead: Math.max(...myMoves.map((m) => m.materialLeadBefore), 0),
		winTimeline: [],
		myMoves,
		...over
	};
}

const LEVERS = { floor: 80, sustain: 3 };

describe('classifyWinnable', () => {
	it('qualifies a sustained win thrown by my own blunder', () => {
		const c = candidate([
			mv(85, 84, 'good'),
			mv(86, 85, 'best'),
			mv(88, 30, 'blunder'), // the give-back
			mv(30, 25, 'mistake')
		]);
		const v = classifyWinnable(c, LEVERS);
		expect(v.qualifies).toBe(true);
		expect(v.sustainedRun).toBe(3); // first three moves entered at/above 80
		expect(v.giveBack?.drop).toBe(58);
		expect(v.tier).toBe('thrown');
	});

	it('rejects a one-ply engine spike (mate-in-12 case) — never sustained', () => {
		// Winning for a single move only, then gone. The classic "I never had it".
		const c = candidate([
			mv(40, 41, 'good'),
			mv(95, 35, 'blunder'), // lone spike to winning, immediately lost
			mv(35, 30, 'good')
		]);
		const v = classifyWinnable(c, LEVERS);
		expect(v.sustainedRun).toBe(1);
		expect(v.qualifies).toBe(false);
	});

	it('still qualifies but tiers "outplayed" when no single move was a mistake', () => {
		const c = candidate([
			mv(88, 86, 'good'),
			mv(86, 83, 'good'),
			mv(83, 78, 'inaccuracy'), // biggest drop, but not a mistake/blunder
			mv(78, 60, 'good')
		]);
		const v = classifyWinnable(c, LEVERS);
		expect(v.qualifies).toBe(true);
		expect(v.tier).toBe('outplayed');
	});

	it('a higher floor shrinks the sustained run', () => {
		const c = candidate([mv(82, 81, 'good'), mv(84, 83, 'good'), mv(85, 40, 'blunder')]);
		expect(classifyWinnable(c, { floor: 80, sustain: 3 }).sustainedRun).toBe(3);
		expect(classifyWinnable(c, { floor: 90, sustain: 3 }).qualifies).toBe(false);
	});

	it('the optional material lever excludes positional-only wins', () => {
		const c = candidate([mv(88, 87, 'good'), mv(87, 86, 'best'), mv(86, 40, 'blunder')], {
			maxMaterialLead: 0
		});
		expect(classifyWinnable(c, LEVERS).qualifies).toBe(true);
		expect(classifyWinnable(c, { ...LEVERS, materialMin: 3 }).qualifies).toBe(false);
	});
});

describe('buildCandidate', () => {
	const base: PerspectiveGame = {
		source: 'chesscom',
		gameId: 'g',
		playedAt: new Date('2026-01-01'),
		timeClass: 'rapid',
		termination: '',
		side: 'w',
		outcome: 'loss',
		opponent: 'foe',
		analyzed: true,
		peakWin: 90,
		winTimeline: [50, 60, 90, 30],
		maxMaterialLead: 3,
		moves: [
			{
				ply: 1,
				phase: 'opening',
				san: 'e4',
				classification: 'best',
				winBefore: 88,
				winAfter: 90,
				winDrop: 0,
				materialLeadBefore: 0
			},
			{
				ply: 3,
				phase: 'middlegame',
				san: 'Qxf2',
				classification: 'blunder',
				winBefore: 90,
				winAfter: 30,
				winDrop: 60,
				materialLeadBefore: 3
			}
		]
	};

	it('builds a candidate from a non-won, analyzed, winning game', () => {
		const c = buildCandidate(base)!;
		expect(c).not.toBeNull();
		expect(c.myMoves).toHaveLength(2);
		expect(c.outcome).toBe('loss');
	});

	it('returns null for a won game', () => {
		expect(buildCandidate({ ...base, outcome: 'win' })).toBeNull();
	});

	it('returns null when unanalyzed or never clearly winning', () => {
		expect(buildCandidate({ ...base, analyzed: false, winTimeline: undefined })).toBeNull();
		expect(buildCandidate({ ...base, peakWin: 55 })).toBeNull();
	});
});
