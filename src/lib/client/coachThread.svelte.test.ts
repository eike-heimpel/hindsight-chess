import { describe, it, expect } from 'vitest';
import { ok } from '$lib/result';
import type { EngineEval } from '$lib/engine/engine';
import type { ReviewGame } from '$lib/review/types';
import type { GameAnalysis } from '$lib/review/analysis';
import type { CoachTurnRequest, CoachTurnResponse } from '$lib/review/coach/types';
import { createCoachThread } from './coachThread.svelte';

/**
 * The capability the rune module unlocks: the guided conversation — picking a
 * spot, the per-ply deep-eval memo, the variant A/B opener split, and the
 * answer/guide turns — driven against a fake `discuss` (no network) and a fake
 * `evaluate` (no Stockfish). chess.js does the real move legality so the frames
 * and FENs are genuine.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const ev = (
	cp: number,
	bestMoveUci: string,
	lines?: { cp: number; pv: string[]; moveUci: string }[]
): EngineEval => ({
	cp,
	bestMoveUci,
	bestMoveSan: bestMoveUci,
	depth: 16,
	lines
});

/** A one-move game: White plays 1.e4, coached side is White. */
function makeGame(): ReviewGame {
	return {
		source: 'chesscom',
		gameId: 'g1',
		playedAt: new Date('2026-01-01T00:00:00Z'),
		timeClass: 'rapid',
		timeControl: '600',
		opening: 'Open Game',
		white: { username: 'me', rating: 800 },
		black: { username: 'them', rating: 820 },
		result: '1-0',
		termination: 'normal',
		moves: [{ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', fenBefore: START, fenAfter: AFTER_E4 }]
	};
}

const analysis: GameAnalysis = {
	source: 'chesscom',
	gameId: 'g1',
	depth: 16,
	analyzedAt: '2026-01-01T00:00:00Z',
	moves: [
		{
			ply: 1,
			color: 'w',
			cpBefore: 20,
			cpAfter: 20,
			winBefore: 52,
			winAfter: 52,
			delta: 0,
			classification: 'best',
			bestMoveUci: 'e2e4',
			bestMoveSan: 'e4'
		}
	],
	accuracy: { white: 100, black: 100 }
};

/** Records the requests it received and replies with a scripted response. */
function fakeDiscuss(resp?: Partial<CoachTurnResponse>) {
	const reqs: CoachTurnRequest[] = [];
	const discuss = async (req: CoachTurnRequest): Promise<CoachTurnResponse> => {
		reqs.push(req);
		return {
			message: `coach:${req.intent}`,
			show: 'none',
			learnings: [],
			choices: ['a', 'b'],
			wrapUp: false,
			canGuide: true,
			...resp
		};
	};
	return { discuss, reqs };
}

/** Resolves each evaluate() with the next scripted eval (last sticks), recording
 *  the FENs asked about. */
function fakeEngine(script: EngineEval[]) {
	let i = 0;
	const calls: string[] = [];
	const evaluate = async (fen: string) => {
		calls.push(fen);
		const e = script[Math.min(i, script.length - 1)];
		i++;
		return ok(e);
	};
	return { evaluate, calls };
}

describe('createCoachThread', () => {
	it('variant A: the coach speaks first on open (intent "open")', async () => {
		const d = fakeDiscuss();
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'A',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await t.open(1);
		await flush();
		expect(d.reqs).toHaveLength(1);
		expect(d.reqs[0].intent).toBe('open');
		expect(t.messages).toHaveLength(1);
		expect(t.messages[0].role).toBe('coach');
		expect(t.choices).toEqual(['a', 'b']);
		expect(t.currentPly).toBe(1);
	});

	it('variant B: the coach stays silent on open (no discuss call)', async () => {
		const d = fakeDiscuss();
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await t.open(1);
		await flush();
		expect(d.reqs).toHaveLength(0);
		expect(t.messages).toHaveLength(0);
		expect(t.currentPly).toBe(1);
	});

	it('openers differ by variant for the same spot', async () => {
		const a = fakeDiscuss();
		const b = fakeDiscuss();
		const tA = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'A',
			discuss: a.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		const tB = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: b.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await tA.open(1);
		await tB.open(1);
		await flush();
		expect(a.reqs.length).toBe(1);
		expect(b.reqs.length).toBe(0);
	});

	it('seeds the EvalBar from cached analysis instantly, before the deep eval lands', async () => {
		const d = fakeDiscuss();
		// An evaluate that never resolves: the bar must already be seeded from the
		// cached analysis (white-POV winAfter = 52) while the deep eval is in flight.
		const evaluate = () => new Promise<never>(() => {});
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: evaluate as never
		});
		t.open(1);
		await flush();
		expect(t.whiteWin).toBe(52);
	});

	it('memoises the per-ply deep eval: a second open() does not re-evaluate', async () => {
		const d = fakeDiscuss();
		const eng = fakeEngine([ev(20, 'e2e4')]);
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: eng.evaluate
		});
		await t.open(1);
		await flush();
		const afterFirst = eng.calls.length;
		expect(afterFirst).toBeGreaterThan(0);

		await t.open(1);
		await flush();
		expect(eng.calls.length).toBe(afterFirst); // memo hit → no new evaluate
	});

	it('answer() pushes a player turn then a coach turn and sets state', async () => {
		const d = fakeDiscuss({ choices: ['c'], wrapUp: true, canGuide: false });
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await t.open(1);
		await flush();

		await t.answer('I wanted the center');
		await flush();
		expect(d.reqs[d.reqs.length - 1].intent).toBe('answer');
		expect(d.reqs[d.reqs.length - 1].playerText).toBe('I wanted the center');
		expect(t.messages.map((m) => m.role)).toEqual(['player', 'coach']);
		expect(t.choices).toEqual(['c']);
		expect(t.wrapUpReady).toBe(true);
		expect(t.canGuide).toBe(false);
	});

	it('answer() builds the request from state + memoised eval', async () => {
		const d = fakeDiscuss();
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4', [{ cp: 20, pv: ['e2e4'], moveUci: 'e2e4' }])]).evaluate
		});
		await t.open(1);
		await flush();
		await t.answer('center');
		await flush();
		const req = d.reqs[d.reqs.length - 1];
		expect(req.source).toBe('chesscom');
		expect(req.gameId).toBe('g1');
		expect(req.ply).toBe(1);
		expect(req.fenBefore).toBe(START);
		expect(req.playedUci).toBe('e2e4');
		expect(req.bestLines[0].moveUci).toBe('e2e4');
	});

	it('guideMe() sends intent "guide" and pushes a coach turn', async () => {
		const d = fakeDiscuss({ message: 'a hint' });
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'B',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await t.open(1);
		await flush();

		await t.guideMe();
		await flush();
		expect(d.reqs[d.reqs.length - 1].intent).toBe('guide');
		expect(t.messages[t.messages.length - 1].content).toBe('a hint');
	});

	it('finish() clears the thread and returns to picking', async () => {
		const d = fakeDiscuss();
		const t = createCoachThread({
			game: makeGame(),
			analysis,
			variant: 'A',
			discuss: d.discuss,
			evaluate: fakeEngine([ev(20, 'e2e4')]).evaluate
		});
		await t.open(1);
		await flush();
		t.finish();
		expect(t.currentPly).toBe(null);
		expect(t.messages).toHaveLength(0);
		expect(t.choices).toHaveLength(0);
	});
});
