import { applyMove, legalDestinations, requiresPromotion, sideToMove } from '$lib/chess/rules';
import { safeEvaluate } from '$lib/client/engine';
import { uciSquares } from '$lib/review/analysis';
import { winPercent } from '$lib/review/winPercent';
import { classifyMove, type MoveClass } from '$lib/review/classify';
import type { Side, Square } from '$lib/chess/types';

export type ExploreNode = {
	/** Position after this move. */
	fen: string;
	san: string;
	uci: string;
	from: Square;
	to: Square;
	/** Side that made the move. */
	color: Side;
	/** White-POV win% of `fen`; null until the engine lands. */
	whiteWin: number | null;
	/** Quality of this move; null until the engine lands. */
	classification: MoveClass | null;
};

type Promotion = 'q' | 'r' | 'b' | 'n';
type EvaluateFn = typeof safeEvaluate;

// Time-bounded rather than a fixed depth so the bar settles within ~a second of
// each move instead of stalling in sharp positions.
const EXPLORE_MOVETIME_MS = 1200;

/**
 * The "play it out from here" branch on the review board — a throwaway analysis
 * board in the spirit of chess.com's. Lifted out of the route (CLAUDE.md: the
 * page is already oversized; stateful logic belongs in a rune module) and given
 * an injected `evaluate` so the move/classification math is unit-testable
 * against a fake engine.
 *
 * It owns its own line, the click-to-move state machine, and a live engine
 * readout. It never touches the game's stored analysis — the branch is
 * disposable and resets on `exit()`.
 */
export function createExploreLine(opts?: { evaluate?: EvaluateFn }) {
	const evaluate = opts?.evaluate ?? safeEvaluate;

	let active = $state(false);
	let baseFen = $state<string | null>(null);
	let baseLabel = $state('');
	let nodes = $state<ExploreNode[]>([]);

	let selected = $state<Square | null>(null);
	let legalDests = $state<Square[]>([]);
	let pendingPromotion = $state<{ from: Square; to: Square } | null>(null);

	// Live engine readout of the current (deepest) position.
	let whiteWin = $state<number | null>(null);
	let evaluating = $state(false);
	let currentCp = $state<number | null>(null); // side-to-move POV; classifies the next move
	let currentBestUci = $state<string | null>(null); // the "play this" arrow

	// Bumped on every structural change. A late-resolving eval only drives the
	// live readout when it's still the deepest position; per-move classification
	// is guarded separately (by node identity), so fast moves all get scored.
	let gen = 0;

	const currentFen = $derived(nodes.length ? nodes[nodes.length - 1].fen : (baseFen ?? ''));

	function clearSelection() {
		selected = null;
		legalDests = [];
	}

	async function evalPosition(
		fen: string,
		classify: { index: number; uci: string; preCp: number | null; preBestUci: string | null } | null
	) {
		const myGen = ++gen;
		evaluating = true;
		const res = await evaluate(fen, { movetimeMs: EXPLORE_MOVETIME_MS });
		const deepest = myGen === gen;
		if (deepest) evaluating = false;
		if (!res.ok) {
			if (deepest) currentBestUci = null;
			return;
		}
		const e = res.value;
		const stm = sideToMove(fen);
		const wWin = stm === 'w' ? winPercent(e.cp) : 100 - winPercent(e.cp);
		if (deepest) {
			whiteWin = wWin;
			currentCp = e.cp;
			currentBestUci = e.bestMoveUci;
		}
		// Classify the move that reached `fen` regardless of whether this is still
		// the deepest line, as long as the node is still there — mirrors
		// buildAnalysis: delta is the mover's win% drop, `best` if it was the engine's.
		if (classify && classify.preCp !== null && nodes[classify.index]?.uci === classify.uci) {
			const cpAfterMover = -e.cp; // `fen` is the opponent's turn; flip to mover POV
			const delta = Math.max(0, winPercent(classify.preCp) - winPercent(cpAfterMover));
			const isBest = classify.preBestUci === classify.uci;
			nodes[classify.index] = {
				...nodes[classify.index],
				whiteWin: wWin,
				classification: classifyMove({ delta, isBest })
			};
		}
	}

	function doMove(from: Square, to: Square, promotion?: Promotion) {
		const fen = currentFen;
		let applied;
		try {
			applied = applyMove(fen, `${from}${to}${promotion ?? ''}`);
		} catch {
			return; // illegal — ignore; the UI only offers legal destinations
		}
		const node: ExploreNode = {
			fen: applied.fen,
			san: applied.move.san,
			uci: applied.move.uci,
			from,
			to,
			color: sideToMove(fen),
			whiteWin: null,
			classification: null
		};
		const index = nodes.length;
		const preCp = currentCp;
		const preBestUci = currentBestUci;
		nodes = [...nodes, node];
		evalPosition(applied.fen, { index, uci: node.uci, preCp, preBestUci });
	}

	return {
		get active() {
			return active;
		},
		get currentFen() {
			return currentFen;
		},
		get nodes() {
			return nodes;
		},
		get selected() {
			return selected;
		},
		get legalDests() {
			return legalDests;
		},
		get pendingPromotion() {
			return pendingPromotion;
		},
		/** Colour of the side whose pawn is promoting — for the picker's icons. */
		get promotionColor(): Side {
			return sideToMove(currentFen);
		},
		get whiteWin() {
			return whiteWin;
		},
		get evaluating() {
			return evaluating;
		},
		get baseLabel() {
			return baseLabel;
		},
		/** Highlight the last explored move's from/to squares. */
		get lastMove() {
			const n = nodes[nodes.length - 1];
			return n ? { from: n.from, to: n.to } : null;
		},
		/** The engine's best move in the current position — the "play this" arrow. */
		get bestArrow() {
			return currentBestUci ? uciSquares(currentBestUci) : null;
		},

		/** Everything needed to hand the deepest move to the coach as an explored
		 *  "what if" line: the full UCI line from the branch, and the discussed move's
		 *  fenBefore/fenAfter/uci/san (the discussed move is the deepest one played).
		 *  Null until at least one move has been made. */
		get coachSubject(): {
			line: string[];
			fenBefore: string;
			fenAfter: string;
			playedUci: string;
			san: string;
		} | null {
			if (!nodes.length) return null;
			const last = nodes[nodes.length - 1];
			const fenBefore = nodes.length >= 2 ? nodes[nodes.length - 2].fen : (baseFen ?? last.fen);
			return {
				line: nodes.map((n) => n.uci),
				fenBefore,
				fenAfter: last.fen,
				playedUci: last.uci,
				san: last.san
			};
		},

		/** Fork a throwaway line from `fen`; `label` names where we branched. */
		enter(fen: string, label: string) {
			active = true;
			baseFen = fen;
			baseLabel = label;
			nodes = [];
			clearSelection();
			pendingPromotion = null;
			whiteWin = null;
			currentCp = null;
			currentBestUci = null;
			evalPosition(fen, null);
		},

		onSquareClick(sq: Square) {
			if (pendingPromotion) return; // resolve the picker first
			const fen = currentFen;
			if (selected !== null && legalDests.includes(sq)) {
				if (requiresPromotion(fen, selected, sq)) {
					pendingPromotion = { from: selected, to: sq };
					return;
				}
				doMove(selected, sq);
				clearSelection();
				return;
			}
			// (Re)select: chess.js returns destinations only for a side-to-move piece,
			// so a non-empty list is exactly "this is a piece you may move".
			const dests = legalDestinations(fen, sq);
			if (dests.length) {
				selected = sq;
				legalDests = dests;
			} else {
				clearSelection();
			}
		},

		completePromotion(piece: Promotion) {
			if (!pendingPromotion) return;
			const { from, to } = pendingPromotion;
			pendingPromotion = null;
			doMove(from, to, piece);
			clearSelection();
		},

		cancelPromotion() {
			pendingPromotion = null;
			clearSelection();
		},

		/** Take back the last explored move. */
		undo() {
			if (!nodes.length) return;
			nodes = nodes.slice(0, -1);
			clearSelection();
			pendingPromotion = null;
			currentCp = null;
			currentBestUci = null;
			evalPosition(currentFen, null);
		},

		/** Leave the branch and return to the real game. */
		exit() {
			active = false;
			baseFen = null;
			baseLabel = '';
			nodes = [];
			clearSelection();
			pendingPromotion = null;
			whiteWin = null;
			currentCp = null;
			currentBestUci = null;
			gen++; // invalidate any in-flight eval's live-readout update
		}
	};
}

export type ExploreLine = ReturnType<typeof createExploreLine>;
