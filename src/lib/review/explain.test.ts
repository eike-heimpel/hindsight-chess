import { describe, it, expect } from 'vitest';
import { MATE_SCORE_BASE, type EngineLine } from '$lib/engine/engine';
import { buildExplainFacts, evalText, type ReviewExplainRequest } from './explain';
import { buildExplainPrompt } from './explainPrompt';

// Position after 1.e4 e5 — White to move, full-move 2.
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const line = (moveUci: string, pv: string[], cp: number): EngineLine => ({ moveUci, pv, cp });

const baseReq = (over: Partial<ReviewExplainRequest> = {}): ReviewExplainRequest => ({
	source: 'chesscom',
	gameId: 'g1',
	ply: 3,
	fenBefore: FEN,
	playedUci: 'd1h5', // Qh5 — not the engine's pick
	bestLines: [
		line('g1f3', ['g1f3', 'b8c6', 'f1b5'], 30),
		line('f1c4', ['f1c4', 'g8f6'], 20),
		line('b1c3', ['b1c3'], 15)
	],
	replyLine: line('b8c6', ['b8c6', 'f1c4', 'g7g6'], 30), // black POV after Qh5
	...over
});

describe('evalText', () => {
	it('renders pawns with sign and mate distances', () => {
		expect(evalText(30)).toBe('+0.3');
		expect(evalText(-30)).toBe('-0.3');
		expect(evalText(MATE_SCORE_BASE - 3)).toBe('M3');
		expect(evalText(-(MATE_SCORE_BASE - 5))).toBe('-M5');
	});
});

describe('buildExplainFacts', () => {
	it('derives mover, SAN lines, and the played move facts (English)', () => {
		const f = buildExplainFacts(baseReq());
		expect(f.mover).toBe('White');
		expect(f.moveNumber).toBe(2);
		expect(f.playedSan).toBe('Qh5');
		expect(f.isBest).toBe(false);
		expect(f.bestSan).toBe('Nf3');
		expect(f.lines).toHaveLength(3);
		expect(f.lines[0]).toEqual({ evalText: '+0.3', sanLine: 'Nf3 Nc6 Bb5' });
		expect(f.played.pieceEn).toBe('queen');
		expect(f.played.capturedEn).toBeNull();
	});

	it('SAN-ifies the reply line from the position after the played move', () => {
		const f = buildExplainFacts(baseReq());
		expect(f.replySanLine).toBe('Nc6 Bc4 g6');
		expect(f.evalPlayed).toBe('-0.3'); // -replyLine.cp, mover POV
	});

	it('classifies from the win-% drop', () => {
		const f = buildExplainFacts(baseReq());
		expect(f.winBefore).toBeGreaterThan(f.winAfter);
		expect(f.classification).toBe('inaccuracy'); // ~5.5% drop
	});

	it('flags the played move as best when it matches the engine', () => {
		const f = buildExplainFacts(
			baseReq({ playedUci: 'g1f3', replyLine: line('b8c6', ['b8c6'], 20) })
		);
		expect(f.isBest).toBe(true);
		expect(f.classification).toBe('best');
	});

	it('detects no error-nature signals on a quiet inaccuracy', () => {
		const f = buildExplainFacts(baseReq());
		expect(f.nature).toEqual({
			allowedMate: false,
			threwAwayWin: false,
			hangsMovedPiece: false
		});
	});

	it('flags a hung piece — moved onto an attacked, undefended square', () => {
		// White plays Qh5 into the g6 pawn, nothing defends h5.
		const f = buildExplainFacts({
			source: 'chesscom',
			gameId: 'g',
			ply: 5,
			fenBefore: 'rnbqkbnr/pppp1p1p/6p1/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3',
			playedUci: 'd1h5',
			bestLines: [line('g1f3', ['g1f3'], 20)],
			replyLine: line('g6h5', ['g6h5'], 900) // ...gxh5 wins the queen
		});
		expect(f.nature.hangsMovedPiece).toBe(true);
	});

	it('flags an allowed mate against the mover', () => {
		const f = buildExplainFacts(
			baseReq({ replyLine: line('d8e1', ['d8e1'], MATE_SCORE_BASE - 1) })
		);
		expect(f.nature.allowedMate).toBe(true);
	});

	it('flags a thrown-away winning position', () => {
		// Was clearly winning (best line +6.0), the move played hangs it to ~equal.
		const f = buildExplainFacts(
			baseReq({ bestLines: [line('g1f3', ['g1f3'], 600)], replyLine: line('b8c6', ['b8c6'], 10) })
		);
		expect(f.nature.threwAwayWin).toBe(true);
	});

	it('surfaces the board-diff facts: nowDefends, hangingAfter, and census (f5-style)', () => {
		// Black pawns e4 + f7, White knight f3 attacks e4. Black plays ...f5,
		// defending e4. The lie "f5 leaves e4 undefended" must be unsayable.
		const f = buildExplainFacts({
			source: 'chesscom',
			gameId: 'g',
			ply: 2,
			fenBefore: '4k3/5p2/8/8/4p3/5N2/8/4K3 b - - 0 1',
			playedUci: 'f7f5',
			bestLines: [line('f7f5', ['f7f5'], 20)],
			replyLine: line('f3e5', ['f3e5'], -20)
		});
		expect(f.played.nowDefends).toContainEqual({ pieceEn: 'pawn', square: 'e4' });
		expect(f.hangingAfter.some((h) => h.square === 'e4')).toBe(false);
		expect(f.census.black).toContainEqual({ pieceEn: 'pawn', square: 'f5' });
		expect(f.census.white).toContainEqual({ pieceEn: 'knight', square: 'f3' });
	});

	it('handles a checkmating move with no reply line', () => {
		// Scholar's mate: after 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6??, White plays Qxf7#.
		const f = buildExplainFacts({
			source: 'chesscom',
			gameId: 'g',
			ply: 7,
			fenBefore: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
			playedUci: 'h5f7',
			bestLines: [line('h5f7', ['h5f7'], MATE_SCORE_BASE - 1)],
			replyLine: null
		});
		expect(f.playedSan).toBe('Qxf7#');
		expect(f.played.isCheckmate).toBe(true);
		expect(f.replySanLine).toBeNull();
		expect(f.isBest).toBe(true);
	});
});

describe('buildExplainPrompt', () => {
	it('grounds the user message in the played move, best move, and evals', () => {
		const { system, user } = buildExplainPrompt(buildExplainFacts(baseReq()));
		expect(system).toContain("White's point of view");
		expect(user).toContain('Qh5');
		expect(user).toContain('Nf3 Nc6 Bb5');
		expect(user).toContain('Nc6 Bc4 g6');
		expect(user).toContain('inaccuracy');
	});

	it('coaches at a beginner level and leads with what the move allows', () => {
		const { system, user } = buildExplainPrompt(buildExplainFacts(baseReq()));
		// Beginner audience + pattern-recognition framing, not deep engine lines.
		expect(system).toContain('500–1000');
		expect(system).toContain('reply line');
		// The refutation is labelled as the punishment, i.e. the lead evidence.
		expect(user).toContain('the punishment line');
	});

	it('renders the board-diff facts and hardens the no-undefended-lie rules', () => {
		const { system, user } = buildExplainPrompt(
			buildExplainFacts({
				source: 'chesscom',
				gameId: 'g',
				ply: 2,
				fenBefore: '4k3/5p2/8/8/4p3/5N2/8/4K3 b - - 0 1',
				playedUci: 'f7f5',
				bestLines: [line('f7f5', ['f7f5'], 20)],
				replyLine: line('f3e5', ['f3e5'], -20)
			})
		);
		// Hardened grounding rules present.
		expect(system).toContain('defended by: nothing');
		expect(system).toContain('Do NOT invent a capturing move');
		// The defends/attacks line and a census block are rendered.
		expect(user).toContain('now defends: pawn on e4');
		expect(user).toContain('Board after the move played');
		expect(user).toContain('currently hanging');
	});

	it('surfaces error-nature signals as a Signals line', () => {
		const { user } = buildExplainPrompt(
			buildExplainFacts({
				source: 'chesscom',
				gameId: 'g',
				ply: 5,
				fenBefore: 'rnbqkbnr/pppp1p1p/6p1/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3',
				playedUci: 'd1h5',
				bestLines: [line('g1f3', ['g1f3'], 20)],
				replyLine: line('g6h5', ['g6h5'], 900)
			})
		);
		expect(user).toContain('Signals: hangs the queen on h5');
	});
});
