import { describe, it, expect } from 'vitest';
import { ok } from '$lib/result';
import type { EngineEval } from '$lib/engine/engine';
import { createExploreLine } from './exploreLine.svelte';

/**
 * The capability the rune module unlocks: the branch's move / classification
 * math and click-to-move state machine, driven against a scripted fake engine —
 * no Stockfish, no browser worker. chess.js does the real move legality so the
 * FENs and SANs are genuine.
 */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const ev = (cp: number, bestMoveUci: string): EngineEval => ({
	cp,
	bestMoveUci,
	bestMoveSan: bestMoveUci,
	depth: 12
});

/** Resolves each evaluate() immediately with the next scripted eval (last one
 *  sticks), recording the FENs it was asked about. */
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

describe('createExploreLine', () => {
	it('evaluates the base position on enter (white-POV win%)', async () => {
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'e2e4')]).evaluate });
		e.enter(START, 'the start');
		await flush();
		expect(e.active).toBe(true);
		expect(e.whiteWin).toBe(50); // cp 0 → 50%
		expect(e.bestArrow).toEqual({ from: 'e2', to: 'e4' });
	});

	it('click-to-move: select a piece, then a legal destination, plays it', async () => {
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'e2e4'), ev(0, 'e7e5')]).evaluate });
		e.enter(START, 'the start');
		await flush();

		e.onSquareClick('e2');
		expect(e.selected).toBe('e2');
		expect(e.legalDests).toContain('e4');

		e.onSquareClick('e4');
		await flush();
		expect(e.selected).toBe(null);
		expect(e.nodes).toHaveLength(1);
		expect(e.nodes[0].san).toBe('e4');
		expect(e.lastMove).toEqual({ from: 'e2', to: 'e4' });
	});

	it('scores a move that matches the engine as best', async () => {
		// Base prefers e2e4; we play e2e4.
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'e2e4'), ev(0, 'e7e5')]).evaluate });
		e.enter(START, 'the start');
		await flush();
		e.onSquareClick('e2');
		e.onSquareClick('e4');
		await flush();
		expect(e.nodes[0].classification).toBe('best');
	});

	it('scores a move that throws away the game as a blunder', async () => {
		// Base is even and prefers d2d4; we instead play e2e4, after which the
		// opponent is winning +800 → a big win% drop, not the engine's pick.
		const e = createExploreLine({
			evaluate: fakeEngine([ev(0, 'd2d4'), ev(800, 'd7d5')]).evaluate
		});
		e.enter(START, 'the start');
		await flush();
		e.onSquareClick('e2');
		e.onSquareClick('e4');
		await flush();
		expect(e.nodes[0].classification).toBe('blunder');
	});

	it('undo takes back the last explored move and re-reads the position', async () => {
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'e2e4'), ev(0, 'e7e5')]).evaluate });
		e.enter(START, 'the start');
		await flush();
		e.onSquareClick('e2');
		e.onSquareClick('e4');
		await flush();
		expect(e.nodes).toHaveLength(1);

		e.undo();
		await flush();
		expect(e.nodes).toHaveLength(0);
		expect(e.currentFen).toBe(START);
	});

	it('prompts for a promotion piece and applies the chosen one', async () => {
		const promo = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'; // white a-pawn one step from queening
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'a7a8q'), ev(0, 'e8d8')]).evaluate });
		e.enter(promo, 'a promotion test');
		await flush();

		e.onSquareClick('a7');
		e.onSquareClick('a8');
		expect(e.pendingPromotion).toEqual({ from: 'a7', to: 'a8' });
		expect(e.nodes).toHaveLength(0); // not played until a piece is chosen

		e.completePromotion('q');
		await flush();
		expect(e.pendingPromotion).toBe(null);
		expect(e.nodes).toHaveLength(1);
		expect(e.nodes[0].san).toBe('a8=Q+'); // queening here also gives check
	});

	it('exit clears the branch and deactivates', async () => {
		const e = createExploreLine({ evaluate: fakeEngine([ev(0, 'e2e4')]).evaluate });
		e.enter(START, 'the start');
		await flush();
		e.exit();
		expect(e.active).toBe(false);
		expect(e.nodes).toHaveLength(0);
		expect(e.whiteWin).toBe(null);
	});
});
