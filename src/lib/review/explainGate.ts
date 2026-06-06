/**
 * Deterministic gate for the move-explainer LLM. The explainer once told a user
 * a move "left e4 undefended" and "Nxe4 captures a pawn for free" — both
 * provably false by chess.js (e4 was defended by the f5 pawn; Nxe4 loses the
 * knight to fxe4). We must NEVER show a board claim that contradicts chess.js.
 *
 * This is pure code, not another LLM. It is CONSERVATIVE: it flags only claims
 * it can PROVE false, and stays silent on anything ambiguous (low false-
 * positive). `buildFallbackExplanation` is the last-resort, facts-only text
 * shown when the LLM keeps failing the gate.
 */
import { Chess } from 'chess.js';
import type { Color, Square as ChessJsSquare } from 'chess.js';
import type { Square } from '$lib/chess/types';
import type { ReviewExplainFacts } from './explain';

export type ExplainViolation = string;

/** Move-shaped SAN — mirrors coach/gate.ts: castling, a piece move (incl.
 *  capture/check/promotion), or a pawn CAPTURE (exd5). Bare pawn pushes and
 *  file/square words are NOT matched — too ambiguous to flag. */
const SAN_TOKEN =
	/\b(O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;

/** Strip decorations so "Nxe4+" and "Nxe4" compare equal. */
function bareSan(san: string): string {
	return san.replace(/[+#]/g, '');
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** Words that assert a move/square wins material or sits undefended. */
const FREE_WIN_RE = /free|for free|wins? (?:a )?(?:pawn|piece|material)|undefended|hang/i;
const HANGING_RE =
	/undefended|hanging|hangs|loose|for free|free (?:pawn|piece)|left .* (?:undefended|hanging)/i;

function legalBareSanSet(fen: string): Set<string> {
	try {
		return new Set(new Chess(fen).moves().map(bareSan));
	} catch {
		return new Set();
	}
}

/** Every SAN the FACTS reference — the known-good set the text may cite. */
function knownSanTokens(facts: ReviewExplainFacts): Set<string> {
	const tokens = new Set<string>();
	const add = (s: string | null | undefined) => {
		if (!s) return;
		for (const m of s.match(SAN_TOKEN) ?? []) tokens.add(bareSan(m));
		// sanLines are whitespace-separated SANs; also add the bare splits.
		for (const part of s.split(/\s+/)) {
			const bare = bareSan(part);
			if (bare) tokens.add(bare);
		}
	};
	add(facts.playedSan);
	add(facts.bestSan);
	for (const l of facts.lines) add(l.sanLine);
	add(facts.replySanLine);
	return tokens;
}

/** Destination square of a SAN token, e.g. "Nxe4" → "e4", "exd5" → "d5". */
function captureSquare(san: string): Square | null {
	const m = /([a-h][1-8])(?:=[QRBN])?[+#]?$/.exec(bareSan(san));
	return m ? (m[1] as Square) : null;
}

/** Apply a capture SAN to a copy of the position and report whether the
 *  capturing piece is recaptured by an equal-or-cheaper opponent piece. */
function recaptureBy(
	fen: string,
	san: string,
	sq: Square
): { piece: string; square: Square } | null {
	const game = new Chess(fen);
	let result;
	try {
		result = game.move(san);
	} catch {
		return null;
	}
	if (!result) return null;
	const capturingValue = PIECE_VALUE[result.piece] ?? 100;
	const opponent: Color = result.color === 'w' ? 'b' : 'w';
	for (const from of game.attackers(sq as ChessJsSquare, opponent)) {
		const attacker = game.get(from as ChessJsSquare);
		if (!attacker) continue;
		if ((PIECE_VALUE[attacker.type] ?? 100) <= capturingValue) {
			return { piece: attacker.type, square: from as Square };
		}
	}
	return null;
}

/** Pieces defending an occupied square (attackers of it by its owner's color). */
function defendersOf(fen: string, sq: Square): { owner: Color; squares: Square[] } | null {
	const game = new Chess(fen);
	const piece = game.get(sq as ChessJsSquare);
	if (!piece) return null;
	const squares = game.attackers(sq as ChessJsSquare, piece.color).map((s) => s as Square);
	return { owner: piece.color, squares };
}

/**
 * Validate an explainer message against chess.js ground truth. Collects every
 * provable contradiction; stays silent on anything it cannot disprove.
 */
export function validateExplanation(
	text: string,
	ctx: { fenBefore: string; fenAfter: string; facts: ReviewExplainFacts }
): { ok: boolean; violations: ExplainViolation[] } {
	const { fenBefore, fenAfter, facts } = ctx;
	const violations: ExplainViolation[] = [];

	const known = knownSanTokens(facts);
	const legalBefore = legalBareSanSet(fenBefore);
	const legalAfter = legalBareSanSet(fenAfter);

	const sanTokens = text.match(SAN_TOKEN) ?? [];

	// A. INVENTED MOVE — a move-shaped token neither known nor legal anywhere.
	for (const raw of sanTokens) {
		const san = bareSan(raw);
		if (known.has(san) || legalBefore.has(san) || legalAfter.has(san)) continue;
		violations.push(
			`mentions move "${raw}" which is not in any engine line and not legal in the position`
		);
	}

	// B. FALSE "FREE" CAPTURE — a capture the text frames as winning material that
	//    is actually recaptured by an equal-or-cheaper piece.
	for (const raw of sanTokens) {
		if (!raw.includes('x')) continue;
		const san = bareSan(raw);
		const sq = captureSquare(san);
		if (!sq) continue;
		const fen = legalAfter.has(san) ? fenAfter : legalBefore.has(san) ? fenBefore : null;
		if (!fen) continue;
		const sentence = sentenceContaining(text, raw);
		if (!sentence || !FREE_WIN_RE.test(sentence)) continue;
		const recap = recaptureBy(fen, san, sq);
		if (recap) {
			violations.push(
				`claims "${raw}" wins material, but it is recaptured by ${recap.piece} on ${recap.square}`
			);
		}
	}

	// C. FALSE "UNDEFENDED/HANGING" SQUARE — a square called undefended/hanging
	//    that actually has at least one defender.
	for (const sentence of text.split(/[.!?]/)) {
		if (!HANGING_RE.test(sentence)) continue;
		for (const sqRaw of sentence.match(/\b[a-h][1-8]\b/g) ?? []) {
			const sq = sqRaw as Square;
			const def = defendersOf(fenAfter, sq) ?? defendersOf(fenBefore, sq);
			if (def && def.squares.length > 0) {
				violations.push(`calls ${sq} undefended, but it is defended by ${def.squares.join(', ')}`);
			}
		}
	}

	return { ok: violations.length === 0, violations };
}

/** The first sentence (split on .!?) that contains `needle`. */
function sentenceContaining(text: string, needle: string): string | null {
	for (const sentence of text.split(/[.!?]/)) {
		if (sentence.includes(needle)) return sentence;
	}
	return null;
}

/**
 * Last-resort, facts-only explanation. Built purely from `facts` — no LLM, no
 * claim that isn't in the fact set. Shown when the LLM keeps failing the gate.
 */
export function buildFallbackExplanation(facts: ReviewExplainFacts): string {
	const sentences: string[] = [
		`${facts.playedSan} is classified as a ${facts.classification}; your win chance went from ${Math.round(facts.winBefore)}% to ${Math.round(facts.winAfter)}%.`
	];

	const bestLine = facts.lines[0]?.sanLine;
	sentences.push(
		bestLine
			? `The engine preferred ${facts.bestSan} (${bestLine}).`
			: `The engine preferred ${facts.bestSan}.`
	);

	if (facts.replySanLine) {
		sentences.push(`After the move played, the engine's main line is ${facts.replySanLine}.`);
	}

	return sentences.join(' ');
}
