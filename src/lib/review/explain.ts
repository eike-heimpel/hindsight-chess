/**
 * Grounded move-explanation facts for the review tool. Pure: given a position,
 * the move played, and the engine's lines (client-computed — see the trust
 * note in `docs/review.md`), it derives an English, SAN-readable, mover-POV
 * fact set for the explainer LLM. No engine calls here; the math + chess.js
 * derivations are testable without Stockfish.
 *
 * Mirrors the opening `spotlight` pattern (extractFacts → hard-grounded prompt),
 * generalised to any position and an adult audience: the prompt may use chess
 * terms, but every claim must trace back to a line/eval/fact in here.
 */
import { applyMove, describeMove, sideToMove } from '$lib/chess/rules';
import { isMateScore, MATE_SCORE_BASE, type EngineLine } from '$lib/engine/engine';
import type { Square } from '$lib/chess/types';
import { winPercent } from './winPercent';
import { classifyMove, type MoveClass } from './classify';
import type { ReviewSource } from './types';

/** What the browser sends to `POST /api/review/explain`. The engine lines are
 *  trusted; the server re-derives all chess.js facts canonically from `fenBefore`
 *  + `playedUci`. */
export type ReviewExplainRequest = {
	source: ReviewSource;
	gameId: string;
	ply: number;
	/** Position before the move. */
	fenBefore: string;
	playedUci: string;
	/** Engine's top lines from `fenBefore`, best first. `cp` is mover POV. */
	bestLines: EngineLine[];
	/** Engine's best line from the position *after* `playedUci` — the reply that
	 *  "answers" the move. `cp` is the opponent's POV. Null when the played move
	 *  ends the game (mate/stalemate). */
	replyLine: EngineLine | null;
};

type AttackerEn = { pieceEn: string; square: Square };

/** Canonical, English, mover-POV facts the prompt is allowed to use. */
export type ReviewExplainFacts = {
	mover: 'White' | 'Black';
	moveNumber: number;
	playedSan: string;
	/** Tactical facts about the landing square *after* the played move. */
	played: {
		pieceEn: string;
		capturedEn: string | null;
		to: Square;
		givesCheck: boolean;
		isCheckmate: boolean;
		attackersOfTo: AttackerEn[];
		defendersOfTo: AttackerEn[];
	};
	/** Eval after the played move, pawns from the mover's POV (e.g. "-1.4", "M3"). */
	evalPlayed: string;
	classification: MoveClass;
	/** Win% (0..100) for the mover, before vs after the move. */
	winBefore: number;
	winAfter: number;
	bestSan: string;
	isBest: boolean;
	/** Engine's top lines from before the move, as SAN sequences, mover POV. */
	lines: { evalText: string; sanLine: string }[];
	/** Engine's reply to the played move as a SAN sequence (the "punish" line),
	 *  or null when the move ended the game. */
	replySanLine: string | null;
	/** Deterministic cues about *what kind* of error this was, derived from
	 *  chess.js + the evals — so the prompt can lead with the concrete lesson
	 *  reliably instead of inferring it from the lines. */
	nature: {
		/** The played move lets the opponent force mate against the mover. */
		allowedMate: boolean;
		/** Mover was clearly winning before the move and isn't after — a thrown win. */
		threwAwayWin: boolean;
		/** The piece just moved sits on `to` attacked by the opponent with no
		 *  defender — a hung piece, the most common beginner blunder. */
		hangsMovedPiece: boolean;
	};
};

/** Win-% at/above which the mover was "clearly winning" (for the thrown-win cue). */
const CLEARLY_WINNING = 75;
/** Win-% at/below which the mover is no longer winning. */
const NO_LONGER_WINNING = 55;

const DE_TO_EN: Record<string, string> = {
	Bauer: 'pawn',
	Springer: 'knight',
	Läufer: 'bishop',
	Turm: 'rook',
	Dame: 'queen',
	König: 'king'
};
const en = (pieceDe: string): string => DE_TO_EN[pieceDe] ?? pieceDe;

/** Eval as pawns from the mover's POV. Mate → "M{n}" / "-M{n}". */
export function evalText(cpMoverPov: number): string {
	if (isMateScore(cpMoverPov)) {
		const dist = MATE_SCORE_BASE - Math.abs(cpMoverPov);
		return cpMoverPov > 0 ? `M${dist}` : `-M${dist}`;
	}
	const pawns = cpMoverPov / 100;
	return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

/** Replay a UCI line from `startFen` into a SAN string, stopping at the first
 *  move that doesn't apply (engine PVs can be truncated — render what verifies). */
function uciLineToSan(startFen: string, uci: string[], maxPlies = 10): string {
	let fen = startFen;
	const sans: string[] = [];
	for (const mv of uci.slice(0, maxPlies)) {
		try {
			const { fen: next, move } = applyMove(fen, mv);
			sans.push(move.san);
			fen = next;
		} catch {
			break;
		}
	}
	return sans.join(' ');
}

function fullMoveNumber(fen: string): number {
	return parseInt(fen.trim().split(/\s+/)[5] ?? '1', 10);
}

/**
 * Build the grounded fact set. Assumes a validated request (the route parses
 * it). `bestLines` must be non-empty; `bestLines[0]` is the engine's #1 line.
 */
export function buildExplainFacts(req: ReviewExplainRequest): ReviewExplainFacts {
	const { fenBefore, playedUci, bestLines, replyLine } = req;
	if (bestLines.length === 0) throw new Error('buildExplainFacts: bestLines is empty');

	const mover = sideToMove(fenBefore);
	const played = describeMove(fenBefore, playedUci);
	const bestUci = bestLines[0]!.moveUci;
	const best = describeMove(fenBefore, bestUci);
	const isBest = playedUci === bestUci;

	const fenAfter = applyMove(fenBefore, playedUci).fen;
	// Reply eval is the opponent's POV at fenAfter; negate for the mover.
	const cpAfterMover = replyLine ? -replyLine.cp : played.isCheckmate ? MATE_SCORE_BASE : 0;
	const cpBeforeMover = bestLines[0]!.cp;

	const winBefore = winPercent(cpBeforeMover);
	const winAfter = winPercent(cpAfterMover);
	const delta = Math.max(0, winBefore - winAfter);

	const toAttackersEn = (xs: { pieceDe: string; square: Square }[]): AttackerEn[] =>
		xs.map((t) => ({ pieceEn: en(t.pieceDe), square: t.square }));

	return {
		mover: mover === 'w' ? 'White' : 'Black',
		moveNumber: fullMoveNumber(fenBefore),
		playedSan: played.san,
		played: {
			pieceEn: en(played.pieceDe),
			capturedEn: played.capturedPieceDe ? en(played.capturedPieceDe) : null,
			to: played.to,
			givesCheck: played.givesCheck,
			isCheckmate: played.isCheckmate,
			attackersOfTo: toAttackersEn(played.attackersOfTo),
			defendersOfTo: toAttackersEn(played.defendersOfTo)
		},
		evalPlayed: evalText(cpAfterMover),
		classification: classifyMove({ delta, isBest }),
		winBefore,
		winAfter,
		bestSan: best.san,
		isBest,
		lines: bestLines.map((l) => ({
			evalText: evalText(l.cp),
			sanLine: uciLineToSan(fenBefore, l.pv)
		})),
		replySanLine: replyLine ? uciLineToSan(fenAfter, replyLine.pv) : null,
		nature: {
			allowedMate: isMateScore(cpAfterMover) && cpAfterMover < 0,
			threwAwayWin: !isBest && winBefore >= CLEARLY_WINNING && winAfter <= NO_LONGER_WINNING,
			hangsMovedPiece:
				!played.givesCheck &&
				!played.isCheckmate &&
				played.attackersOfTo.length > 0 &&
				played.defendersOfTo.length === 0
		}
	};
}

/** From-square / to-square of a UCI move, for board overlays (the replay page's
 *  reply arrow). */
export function moveSquares(uci: string): { from: Square; to: Square } {
	return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}
