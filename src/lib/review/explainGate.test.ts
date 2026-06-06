import { describe, it, expect } from 'vitest';
import { validateExplanation, buildFallbackExplanation } from './explainGate';
import type { ReviewExplainFacts } from './explain';

// The real failing position: Black plays ...f5. e4 (a black pawn) is defended
// by the f5 pawn, and a White Nxe4 is recaptured by fxe4 — both facts that the
// explainer LLM got backwards.
const fenBefore = 'rn2kb1r/pp2ppp1/2p3p1/q2n4/3Pp1P1/2N4P/PPPBBP2/R2QK2R b KQkq - 4 11';
const fenAfter = 'rn2kb1r/pp2p1p1/2p3p1/q2n1p2/3Pp1P1/2N4P/PPPBBP2/R2QK2R w KQkq - 0 12';

function facts(over: Partial<ReviewExplainFacts> = {}): ReviewExplainFacts {
	return {
		mover: 'Black',
		moveNumber: 11,
		playedSan: 'f5',
		played: {
			pieceEn: 'pawn',
			capturedEn: null,
			to: 'f5',
			givesCheck: false,
			isCheckmate: false,
			attackersOfTo: [],
			defendersOfTo: []
		},
		evalPlayed: '-0.5',
		classification: 'mistake',
		winBefore: 48,
		winAfter: 40,
		bestSan: 'Nxc3',
		isBest: false,
		lines: [{ evalText: '+0.4', sanLine: 'Nxc3 Bxc3 Qxc3' }],
		replySanLine: null,
		nature: { allowedMate: false, threwAwayWin: false, hangsMovedPiece: false },
		...over
	} as ReviewExplainFacts;
}

describe('validateExplanation', () => {
	it('flags the real false explanation (free capture + undefended square)', () => {
		const text =
			'This is a blunder because it leaves the e4 pawn undefended, allowing White to play Nxe4 capturing a pawn for free.';
		const result = validateExplanation(text, { fenBefore, fenAfter, facts: facts() });
		expect(result.ok).toBe(false);
		// Check B: Nxe4 is recaptured by the f5 pawn.
		expect(result.violations.some((v) => /Nxe4.*recaptured/.test(v))).toBe(true);
		// Check C: e4 is defended.
		expect(result.violations.some((v) => /e4.*defended/.test(v))).toBe(true);
	});

	it('passes a clean explanation that makes no false claim', () => {
		const text =
			'f5 weakens the position; the engine preferred Nxc3, trading off a piece and easing the pressure.';
		const result = validateExplanation(text, { fenBefore, fenAfter, facts: facts() });
		expect(result.ok).toBe(true);
		expect(result.violations).toEqual([]);
	});
});

describe('buildFallbackExplanation', () => {
	it('returns facts-only prose mentioning the best move and classification', () => {
		const text = buildFallbackExplanation(facts());
		expect(text.length).toBeGreaterThan(0);
		expect(text).toContain('Nxc3');
		expect(text).toContain('mistake');
	});
});
