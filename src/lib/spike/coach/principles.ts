/**
 * Deterministic beginner-principle detectors. These produce *candidate* signals
 * — "this looks like a development problem" — that we hand to the coach LLM.
 * The LLM decides whether each is actually worth raising in context (and the
 * engine facts can override it). We never assert a principle here; we only flag
 * what's worth a second look. Pure + browser-safe.
 */
import type { ReviewMove } from '$lib/review/types';
import type { Side } from '$lib/chess/types';
import type { PrincipleSignal } from './types';

/** Up to this move number, opening heuristics apply. */
const OPENING_MOVE = 10;
/** Development / castling stay relevant a bit longer (early middlegame). */
const EARLY_MOVE = 22;

const HOME = {
	w: { king: 'e1', minors: ['b1', 'g1', 'c1', 'f1'] },
	b: { king: 'e8', minors: ['b8', 'g8', 'c8', 'f8'] }
} as const;

function parsePieces(fen: string): Record<string, string> {
	const out: Record<string, string> = {};
	const ranks = fen.split(' ')[0].split('/');
	for (let r = 0; r < 8; r++) {
		let file = 0;
		for (const c of ranks[r]) {
			if (/[1-8]/.test(c)) file += parseInt(c, 10);
			else out[`${'abcdefgh'[file++]}${8 - r}`] = c;
		}
	}
	return out;
}

/** Piece letter from SAN: leading N/B/R/Q/K, else a pawn move. */
function pieceOf(san: string): string {
	const c = san[0];
	return 'NBRQK'.includes(c) ? c : 'P';
}

/**
 * @param moves   full game move list
 * @param ply     the turning-point ply (we look only at what happened up to here)
 * @param side    the player being coached
 * @param fenBefore  position at the turning point (for home-square checks)
 * @param moveNumber full-move number at the turning point
 */
export function detectPrinciples(args: {
	moves: ReviewMove[];
	ply: number;
	side: Side;
	fenBefore: string;
	moveNumber: number;
}): PrincipleSignal[] {
	const { moves, ply, side, fenBefore, moveNumber } = args;
	const mine = moves.filter((m) => m.ply <= ply && m.color === side);
	const signals: PrincipleSignal[] = [];
	const home = HOME[side];

	// --- moved a piece twice in the opening -----------------------------------
	const trail = new Map<string, { piece: string; count: number }>();
	let worstRepeat: { piece: string; count: number; square: string } | null = null;
	for (const m of mine) {
		if (m.san === 'O-O' || m.san === 'O-O-O') continue;
		if (m.ply > OPENING_MOVE * 2) break;
		const from = m.uci.slice(0, 2);
		const to = m.uci.slice(2, 4);
		const prev = trail.get(from);
		const rec = prev
			? { piece: prev.piece, count: prev.count + 1 }
			: { piece: pieceOf(m.san), count: 1 };
		trail.delete(from);
		trail.set(to, rec);
		if (rec.count >= 2 && 'NB'.includes(rec.piece)) {
			if (!worstRepeat || rec.count > worstRepeat.count) {
				worstRepeat = { piece: rec.piece, count: rec.count, square: to };
			}
		}
	}
	if (worstRepeat) {
		const name = worstRepeat.piece === 'N' ? 'knight' : 'bishop';
		signals.push({
			id: 'moved-twice',
			label: "Don't move the same piece twice in the opening",
			detail: `the ${name} (now on ${worstRepeat.square}) moved ${worstRepeat.count} times in the opening while other pieces sat undeveloped`
		});
	}

	// --- queen out too early (before minors developed) ------------------------
	let developedMinors = 0;
	let hasCastled = false;
	for (const m of mine) {
		if (m.san === 'O-O' || m.san === 'O-O-O') {
			hasCastled = true;
			continue;
		}
		const piece = pieceOf(m.san);
		if (piece === 'Q') {
			if (m.ply <= 12 && developedMinors < 2 && !hasCastled) {
				signals.push({
					id: 'early-queen',
					label: "Don't bring the queen out early",
					detail: `the queen came out on move ${Math.ceil(m.ply / 2)} (${m.san}) with only ${developedMinors} minor piece${developedMinors === 1 ? '' : 's'} developed — it tends to get chased and lose time`
				});
			}
			break; // only the first queen sortie matters
		}
		if (piece === 'N' || piece === 'B') developedMinors++;
	}

	// --- a king walk in the opening (non-castling) ----------------------------
	const kingWalk = mine.find((m) => pieceOf(m.san) === 'K' && m.ply <= OPENING_MOVE * 2 + 4);
	if (kingWalk) {
		signals.push({
			id: 'king-wander',
			label: 'Keep your king safe — castle, don’t walk it',
			detail: `the king moved (${kingWalk.san}) in the opening instead of castling/staying tucked`
		});
	}

	// --- undeveloped minor pieces (still on home squares) ---------------------
	if (moveNumber >= 7 && moveNumber <= EARLY_MOVE) {
		const pieces = parsePieces(fenBefore);
		const stillHome = home.minors.filter((sq) => {
			const p = pieces[sq];
			if (!p) return false;
			const isMine = side === 'w' ? p === p.toUpperCase() : p === p.toLowerCase();
			return isMine && 'nb'.includes(p.toLowerCase());
		});
		if (stillHome.length > 0) {
			signals.push({
				id: 'undeveloped',
				label: 'Develop all your pieces',
				detail: `${stillHome.length} minor piece${stillHome.length > 1 ? 's' : ''} still on the back rank at move ${moveNumber} (${stillHome.join(', ')})`
			});
		}
	}

	// --- not castled by the early middlegame ----------------------------------
	const castled = mine.some((m) => m.san === 'O-O' || m.san === 'O-O-O');
	const kingMoved = mine.some((m) => pieceOf(m.san) === 'K');
	if (!castled && !kingMoved && moveNumber >= OPENING_MOVE) {
		const pieces = parsePieces(fenBefore);
		const kingStillHome = pieces[home.king] === (side === 'w' ? 'K' : 'k');
		if (kingStillHome) {
			signals.push({
				id: 'late-castle',
				label: 'Castle early',
				detail: `still not castled at move ${moveNumber}; the king sits on ${home.king}`
			});
		}
	}

	return signals;
}
