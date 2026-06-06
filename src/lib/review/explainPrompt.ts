import type { ReviewExplainFacts } from './explain';

/**
 * System + user messages for the review explainer LLM call. English, adult
 * audience — chess terms are allowed. Hard-grounding contract: the model may
 * use only the moves, evaluations and facts in the FACTS block, and must cite
 * moves in the SAN it's given. Evals are pawns from the mover's POV so the
 * model never has to flip signs.
 *
 * The coaching is tuned for an improving beginner (~500–1000): the lesson is the
 * concrete, reachable consequence of the move — what it *allows* (the reply line
 * is the punishment), the recurring pattern to recognise next time — not the
 * engine's deep optimal conversion. `AUDIENCE` isolates that level so a future
 * per-Elo knob is a one-line change.
 */
const AUDIENCE =
	'an adult who recently started chess (roughly 500–1000 rating) and wants to build intuition and recognise recurring patterns, not memorise engine lines';

export function buildExplainPrompt(facts: ReviewExplainFacts): { system: string; user: string } {
	return { system: systemPrompt(facts), user: buildUserMessage(facts) };
}

/** Whose move this is, and how to address the reader. The reader is always the
 *  ${playerColor} player; the move is theirs only when ${playerIsMover}. We keep
 *  the engine numbers mover-POV (no sign flips) and change ONLY the voice. */
function voiceRule(f: ReviewExplainFacts): string {
	if (f.playerIsMover) {
		return `Whose move: this was the reader's OWN move (they play ${f.playerColor}). Address them directly as "you" — e.g. "you played ${f.playedSan}".`;
	}
	return `Whose move: this move was played by the reader's OPPONENT (${f.mover}); the reader plays ${f.playerColor}. Write in the THIRD PERSON, naming both sides by colour (White / Black). Do NOT address the reader as "you" and do NOT imply they made this move. Describe what the move does, and — when it is a mistake by ${f.mover} — what ${f.playerColor} can do about it (the reply line is ${f.playerColor}'s response).`;
}

function systemPrompt(f: ReviewExplainFacts): string {
	const mover = f.mover;
	return `You are a chess coach reviewing ONE move from a finished game for ${AUDIENCE}. You are given the move that was played, the engine's evaluation, its top candidate lines, and the engine's reply to the move played.

${voiceRule(f)}

Grounding (do not break):
- Use ONLY the moves, evaluations and facts in the FACTS block. Do not invent moves, evaluations, or tactics that don't appear in the given variations.
- Cite moves in standard algebraic notation (SAN), exactly as written.
- Evaluations are in pawns from ${mover}'s point of view: positive favours ${mover}, negative favours the opponent. "M5" = mate in 5 for ${mover}; "-M5" = ${mover} gets mated in 5.
- You may name a tactical motif (hanging piece, fork, pin, skewer, discovered attack, back-rank mate, overload, etc.) only when the given variation actually shows it.
- A square is undefended ONLY if it appears with "defended by: nothing". If a square has any defender listed, you MUST NOT call it undefended, loose, hanging, or "free".
- Only describe a capture or tactic that appears in the engine lines or the reply line. Do NOT invent a capturing move (e.g. "Nxe4") that is not in those lines.
- The pieces the moved piece now defends and now attacks are listed explicitly. Use them; do not claim the move abandoned or stopped defending a square it still defends.

If the move played is the engine's top choice (best / good): explain its idea and where it's heading, in one or two short sentences. Done.

Otherwise (inaccuracy / mistake / blunder), coach it like this:
- If a "Signals" line is given, that is the lesson — lead with it: a hung piece (name the square it sits on, undefended), an allowed mate, or a thrown-away winning position. Don't bury it under engine analysis.
- Lead with the concrete consequence. Start from the engine's reply line — that's the punishment the move allows — and say plainly what it does: what gets captured, mated, or forked, on which square. This is the lesson, not the engine's best line.
- If the move allows an immediate or short forced mate against ${mover}, say that directly (e.g. "this allows Qe1# — a back-rank mate"). Do NOT instead describe a longer mate ${mover} could have delivered — that is not what went wrong.
- If ${mover} was already winning and this threw it away, the point is what was given up, not the optimal way it could have been converted.
- Name the recurring pattern in a short phrase so it transfers to the next game ("an undefended piece", "weak back rank", "a knight fork").
- Then give the better move (the engine's best move, in the facts) as a simple idea, with the one-move point of it. Keep any variation to a move or two — no long lines.
- Mention the win-chance swing briefly.

Style: 2–4 sentences, plain prose, honest and direct, warm but never sugar-coated. Be concrete with squares and pieces. No hedging, no platitudes, no "great job", no jargon a beginner wouldn't know.

Output only the annotation text — no preamble, labels, JSON, or markdown.`;
}

function buildUserMessage(f: ReviewExplainFacts): string {
	const checkNote = f.played.isCheckmate ? ' (checkmate)' : f.played.givesCheck ? ' (check)' : '';
	const captureNote = f.played.capturedEn ? `, capturing a ${f.played.capturedEn}` : '';

	const lines = f.lines
		.map((l, i) => `${i + 1}. (${l.evalText}) ${l.sanLine || '(no line)'}`)
		.join('\n');

	const signals = [
		f.nature.hangsMovedPiece && `hangs the ${f.played.pieceEn} on ${f.played.to} (undefended)`,
		f.nature.allowedMate && `allows the opponent to force mate against ${f.mover}`,
		f.nature.threwAwayWin && 'throws away a clearly winning position'
	].filter(Boolean);

	const hanging = f.hangingAfter.length
		? f.hangingAfter
				.map((h) => `${h.pieceEn} on ${h.square} (attacked by: ${fmtAttackers(h.attackedByEn)})`)
				.join('; ')
		: 'none';

	return [
		`Mover: ${f.mover}`,
		`Move played: ${f.moveNumber}. ${f.playedSan}${checkNote}`,
		`Piece: ${f.played.pieceEn} to ${f.played.to}${captureNote}`,
		`Classification: ${f.classification}`,
		...(signals.length ? [`Signals: ${signals.join('; ')}`] : []),
		`Win chance for ${f.mover}: ${Math.round(f.winBefore)}% before → ${Math.round(f.winAfter)}% after`,
		`Evaluation after the move played (${f.mover} POV): ${f.evalPlayed}`,
		`Landing square ${f.played.to} after the move — attacked by: ${fmtAttackers(f.played.attackersOfTo)}; defended by: ${fmtAttackers(f.played.defendersOfTo)}`,
		`After ${f.playedSan}, the ${f.played.pieceEn} on ${f.played.to} now defends: ${fmtAttackers(f.played.nowDefends)}; and now attacks: ${fmtAttackers(f.played.nowAttacks)}`,
		`${f.mover}'s pieces currently hanging (attacked, no defender): ${hanging}`,
		'',
		`Board after the move played:`,
		`  White: ${fmtCensus(f.census.white)}`,
		`  Black: ${fmtCensus(f.census.black)}`,
		'',
		`Engine top lines from before the move (${f.mover} POV):`,
		lines,
		'',
		`What ${f.playedSan} allows — engine's reply (the punishment line): ${f.replySanLine ?? '— (the move ended the game)'}`,
		`Engine's best move: ${f.bestSan}${f.isBest ? ' (this is the move that was played)' : ''}`,
		'',
		'Write the annotation now: 2–5 sentences, plain prose, grounded only in the facts above.'
	].join('\n');
}

function fmtCensus(xs: { pieceEn: string; square: string }[]): string {
	if (xs.length === 0) return 'none';
	return xs.map((x) => `${x.pieceEn} ${x.square}`).join(', ');
}

function fmtAttackers(xs: { pieceEn: string; square: string }[]): string {
	if (xs.length === 0) return 'nothing';
	return xs.map((x) => `${x.pieceEn} on ${x.square}`).join(', ');
}
