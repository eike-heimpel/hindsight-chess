/**
 * Material counting from a FEN — the kid-legible currency. Engine win-% calls a
 * position "winning" whenever a forced line exists (even a mate-in-12 of
 * only-moves); a beginner converts *material*, not evaluations. So the winnable-
 * loss analysis grades opportunity in points up, not centipawns.
 *
 * Standard relative values; the king is worth 0 (it's never captured). Pure +
 * dependency-free — just the board field of the FEN.
 */
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** White-POV material balance in points: white total minus black total. */
export function materialBalance(fen: string): number {
	const board = fen.trim().split(/\s+/)[0];
	let balance = 0;
	for (const ch of board) {
		const value = PIECE_VALUE[ch.toLowerCase()];
		if (value === undefined) continue; // digits, slashes
		balance += ch === ch.toUpperCase() ? value : -value;
	}
	return balance;
}

/** Material lead from one side's POV: positive = that side is up. */
export function materialLead(fen: string, side: 'w' | 'b'): number {
	const balance = materialBalance(fen);
	return side === 'w' ? balance : -balance;
}
