import { describe, it, expect } from 'vitest';
import { MockEngine } from './mock.ts';

describe('MockEngine', () => {
	it('returns the registered answer', async () => {
		const e = new MockEngine({
			'fen-1': { cp: 300, bestMoveSan: 'Rxe5', bestMoveUci: 'e1e5', depth: 18 }
		});
		const r = await e.evaluate('fen-1');
		expect(r.cp).toBe(300);
		expect(r.bestMoveSan).toBe('Rxe5');
	});

	it('throws on unknown FEN', async () => {
		const e = new MockEngine({});
		await expect(e.evaluate('unknown')).rejects.toThrow(/no answer registered/);
	});

	it('returns a fresh copy (no shared mutation)', async () => {
		const a: Record<string, import('./engine.ts').EngineEval> = {
			f: { cp: 0, bestMoveSan: 'e4', bestMoveUci: 'e2e4', depth: 1 }
		};
		const e = new MockEngine(a);
		const r = await e.evaluate('f');
		r.cp = 999;
		expect((await e.evaluate('f')).cp).toBe(0);
	});
});
