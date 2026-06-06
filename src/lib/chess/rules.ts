import { Chess, validateFen } from 'chess.js';
import type { Color, Square as ChessJsSquare } from 'chess.js';
import type { AppliedMove, Side, Square } from './types.ts';

const PIECE_DE: Record<string, string> = {
	p: 'Bauer',
	n: 'Springer',
	b: 'Läufer',
	r: 'Turm',
	q: 'Dame',
	k: 'König'
};

const PIECE_DE_VALUE_ORDER = ['König', 'Dame', 'Turm', 'Läufer', 'Springer', 'Bauer'];

export type Threat = { pieceDe: string; square: Square };

export type BoardPiece = { pieceDe: string; square: Square };
export type BoardCensus = { white: BoardPiece[]; black: BoardPiece[]; sideToMove: Side };

/**
 * Ground-truth description of a move, derived purely from chess.js. Passed to
 * the LLM coach as structured facts so the model never has to read FENs or
 * invent details about the position. Stockfish + chess.js are the only source
 * of truth; the prompt instructs the model to use only what's in here.
 */
export type MoveFacts = {
	from: Square;
	to: Square;
	san: string;
	uci: string;
	/** German name of the piece that moved. */
	pieceDe: string;
	/** German name of the captured piece, or null if no capture. */
	capturedPieceDe: string | null;
	givesCheck: boolean;
	isCheckmate: boolean;
	/** After the move: opposing pieces that attack `to` (could capture our piece). */
	attackersOfTo: Threat[];
	/** After the move: own pieces that defend `to` (could recapture). */
	defendersOfTo: Threat[];
	/** After the move: friendly pieces the moved piece (on `to`) now defends. */
	nowDefends: Threat[];
	/** After the move: enemy pieces the moved piece (on `to`) now attacks. */
	nowAttacks: Threat[];
	/** After the move: the mover's own pieces that are attacked by the opponent
	 *  and have ZERO friendly defenders — truly hanging. Both lists included for
	 *  context. */
	hangingAfter: {
		pieceDe: string;
		square: Square;
		attackers: Threat[];
		defenders: Threat[];
	}[];
};

/**
 * Thin wrapper around chess.js. The point is *not* to abstract chess.js — we want
 * to keep the rest of the codebase free of `new Chess(fen)` boilerplate and to
 * normalize move shapes (we always return both UCI and SAN).
 *
 * Every function here is pure — it never mutates an input.
 */

export class IllegalMoveError extends Error {
	constructor(
		public readonly fen: string,
		public readonly move: string
	) {
		super(`Illegal move "${move}" in position "${fen}"`);
		this.name = 'IllegalMoveError';
	}
}

export class InvalidFenError extends Error {
	constructor(
		public readonly fen: string,
		public readonly reason: string
	) {
		super(`Invalid FEN "${fen}": ${reason}`);
		this.name = 'InvalidFenError';
	}
}

/** True iff the FEN parses to a legal position (per chess.js rules). */
export function isValidFen(fen: string): boolean {
	return validateFen(fen).ok;
}

/** Throws InvalidFenError if invalid. */
export function assertValidFen(fen: string): void {
	const r = validateFen(fen);
	if (!r.ok) throw new InvalidFenError(fen, r.error ?? 'invalid FEN');
}

/** Returns 'w' or 'b' — the side to move in this position. */
export function sideToMove(fen: string): Side {
	assertValidFen(fen);
	return new Chess(fen).turn();
}

/** Returns true if this side currently has a legal mate-delivering move set, else false. */
export function isCheckmate(fen: string): boolean {
	assertValidFen(fen);
	return new Chess(fen).isCheckmate();
}

/** True iff side-to-move has no legal moves but isn't in check. */
export function isStalemate(fen: string): boolean {
	assertValidFen(fen);
	return new Chess(fen).isStalemate();
}

/**
 * Apply a move to a position. The move may be in SAN ("Nxe5", "O-O", "Rd8#")
 * or UCI ("e2e4", "e7e8q"). Returns the new FEN and a normalized move record.
 *
 * Throws IllegalMoveError if the move isn't legal in this position.
 */
export function applyMove(fen: string, move: string): { fen: string; move: AppliedMove } {
	assertValidFen(fen);
	const game = new Chess(fen);

	const result = tryMove(game, move);
	if (!result) throw new IllegalMoveError(fen, move);

	return {
		fen: game.fen(),
		move: {
			uci: result.from + result.to + (result.promotion ?? ''),
			san: result.san,
			from: result.from as Square,
			to: result.to as Square,
			promotion: result.promotion as AppliedMove['promotion']
		}
	};
}

function tryMove(game: Chess, move: string) {
	// chess.js accepts both SAN and a {from, to, promotion} object. UCI strings
	// (e.g. "e7e8q") aren't accepted directly, so we parse them ourselves.
	const uciMatch = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(move);
	try {
		if (uciMatch) {
			const [, from, to, promotion] = uciMatch;
			return game.move({ from: from!, to: to!, promotion });
		}
		return game.move(move);
	} catch {
		return null;
	}
}

/**
 * Apply `move` to `fen` and return structured ground-truth facts about it
 * (squares, German piece names, capture, check/mate, attackers and defenders
 * of the destination square AFTER the move). Pure: never mutates inputs.
 *
 * Sent to the LLM coach as the only allowed source of position truth so the
 * model can't hallucinate squares or threats. Throws IllegalMoveError if the
 * move isn't legal in this position.
 */
export function describeMove(fen: string, move: string): MoveFacts {
	assertValidFen(fen);
	const game = new Chess(fen);
	const result = tryMove(game, move);
	if (!result) throw new IllegalMoveError(fen, move);

	const movedColor: Color = result.color;
	const opposite: Color = movedColor === 'w' ? 'b' : 'w';
	const to = result.to as Square;

	const toThreats = (squares: ChessJsSquare[]): Threat[] =>
		squares.map((sq) => {
			const piece = game.get(sq);
			if (!piece) throw new Error(`attackers() returned empty square ${sq}`);
			return { pieceDe: PIECE_DE[piece.type], square: sq as Square };
		});

	// Walk the whole board once to compute, from the moved piece's POV:
	//  - what it now defends/attacks (squares it geometrically reaches), and
	//  - which of the mover's pieces are hanging (enemy-attacked, no defender).
	// chess.js `attackers(sq, color)` is pseudo-geometric: it returns every piece
	// of `color` that hits `sq` regardless of occupant, and may include pinned
	// pieces. That's acceptable here — we ground the LLM in the geometry, not a
	// full static-exchange evaluation.
	const nowDefends: Threat[] = [];
	const nowAttacks: Threat[] = [];
	const hangingAfter: MoveFacts['hangingAfter'] = [];

	const board = game.board();
	for (let r = 0; r < 8; r++) {
		for (let f = 0; f < 8; f++) {
			const cell = board[r]?.[f];
			if (!cell) continue;
			const sq = (String.fromCharCode(97 + f) + String(8 - r)) as ChessJsSquare;
			const occupantDe = PIECE_DE[cell.type];

			if (cell.color === movedColor) {
				if (sq !== to && game.attackers(sq, movedColor).includes(to as ChessJsSquare)) {
					nowDefends.push({ pieceDe: occupantDe, square: sq as Square });
				}
				const enemyAttackers = toThreats(game.attackers(sq, opposite));
				const friendlyDefenders = toThreats(game.attackers(sq, movedColor));
				if (enemyAttackers.length > 0 && friendlyDefenders.length === 0) {
					hangingAfter.push({
						pieceDe: occupantDe,
						square: sq as Square,
						attackers: enemyAttackers,
						defenders: friendlyDefenders
					});
				}
			} else if (game.attackers(sq, movedColor).includes(to as ChessJsSquare)) {
				nowAttacks.push({ pieceDe: occupantDe, square: sq as Square });
			}
		}
	}

	return {
		from: result.from as Square,
		to,
		san: result.san,
		uci: result.from + result.to + (result.promotion ?? ''),
		pieceDe: PIECE_DE[result.piece],
		capturedPieceDe: result.captured ? PIECE_DE[result.captured] : null,
		givesCheck: game.isCheck(),
		isCheckmate: game.isCheckmate(),
		attackersOfTo: toThreats(game.attackers(to as ChessJsSquare, opposite)),
		defendersOfTo: toThreats(game.attackers(to as ChessJsSquare, movedColor)),
		nowDefends,
		nowAttacks,
		hangingAfter
	};
}

/**
 * Full piece census of a position, sorted by piece value desc then by square.
 * Used to ground the LLM coach with the actual board state so it can't invent
 * pieces or colors. Side-to-move comes from the FEN.
 */
export function boardCensus(fen: string): BoardCensus {
	assertValidFen(fen);
	const game = new Chess(fen);
	const board = game.board();
	const white: BoardPiece[] = [];
	const black: BoardPiece[] = [];
	for (let r = 0; r < 8; r++) {
		for (let f = 0; f < 8; f++) {
			const cell = board[r]?.[f];
			if (!cell) continue;
			const square = (String.fromCharCode(97 + f) + String(8 - r)) as Square;
			const entry: BoardPiece = { pieceDe: PIECE_DE[cell.type], square };
			(cell.color === 'w' ? white : black).push(entry);
		}
	}
	const order = (a: BoardPiece, b: BoardPiece) => {
		const cmp = PIECE_DE_VALUE_ORDER.indexOf(a.pieceDe) - PIECE_DE_VALUE_ORDER.indexOf(b.pieceDe);
		return cmp !== 0 ? cmp : a.square.localeCompare(b.square);
	};
	white.sort(order);
	black.sort(order);
	return { white, black, sideToMove: game.turn() };
}

/**
 * Returns all legal moves from `from` as destination squares.
 * Used by the UI to highlight where a clicked piece can go.
 */
export function legalDestinations(fen: string, from: Square): Square[] {
	assertValidFen(fen);
	const game = new Chess(fen);
	return game.moves({ square: from, verbose: true }).map((m) => m.to as Square);
}

/**
 * True iff playing from `from` to `to` is a promotion move. chess.js emits
 * one verbose entry per promotion piece (q/r/b/n), each with `promotion` set —
 * any one of them confirms a promotion is required for that destination.
 */
export function requiresPromotion(fen: string, from: Square, to: Square): boolean {
	assertValidFen(fen);
	const game = new Chess(fen);
	return game.moves({ square: from, verbose: true }).some((m) => m.to === to && !!m.promotion);
}
