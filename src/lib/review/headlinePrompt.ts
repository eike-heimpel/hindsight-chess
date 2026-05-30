/**
 * System + user messages for the home card's "story" headline — one warm,
 * plain-English sentence recapping a finished game from the player's side,
 * narrating the *arc* (comebacks, swings, where it turned), not just the peak.
 * Hard-grounded in the `HeadlineFacts` curve so it can't invent moves or evals.
 * Audience + voice match the move explainer (`explainPrompt.ts`) and the brand:
 * honest, on your side, never scolding.
 */
import type { HeadlineFacts } from './headlineFacts';

const AUDIENCE =
	'an adult who recently started chess (roughly 500–900 rating) reviewing a game they just finished';

export function buildHeadlinePrompt(facts: HeadlineFacts): { system: string; user: string } {
	return { system: systemPrompt(), user: buildUserMessage(facts) };
}

function systemPrompt(): string {
	return `You write the one-line recap that greets ${AUDIENCE} on their home screen.

Write ONE warm, plain-English sentence (about 12–20 words) recapping this finished game from the player's side. Narrate the arc of the game — note a comeback, a collapse, a back-and-forth, or where it turned — using the win-% trajectory and swings in the FACTS. Win-% is the player's own chance to win at each point (50% = even, 100% = winning, 0% = lost).

Grounding (do not break):
- Use ONLY the FACTS below. Never invent moves, evaluations, openings, or numbers that aren't given.
- You may reference a move number or a win-% only if it appears in the FACTS.

Voice: on the player's side — honest but never scolding, no blame, no "you should have". Warm and human, not a stat readout. No "As an AI", no preamble, no quotes, no markdown. Output the sentence only; a trailing period is optional.`;
}

function buildUserMessage(f: HeadlineFacts): string {
	const sideName = f.side === 'w' ? 'White' : 'Black';
	const trajectory = f.trajectory.map((t) => `m${t.moveNumber}:${t.winPct}%`).join(' ');

	const swings = f.swings.length
		? f.swings.map((s) => `around move ${s.moveNumber}: ${s.from}%→${s.to}%`).join('; ')
		: 'none significant';

	const mistake = f.biggestMistake
		? `move ${f.biggestMistake.moveNumber} ${f.biggestMistake.san} (${f.biggestMistake.classification}), cost ${f.biggestMistake.drop}% win chance`
		: 'none notable';

	return [
		`Outcome (player's side): ${f.outcome}`,
		`Player side: ${sideName}`,
		`Opponent: ${f.opponent}`,
		...(f.opening ? [`Opening: ${f.opening}`] : []),
		...(f.accuracy != null ? [`Player accuracy: ${Math.round(f.accuracy)}%`] : []),
		'',
		`Win-% trajectory (player's POV, by move number): ${trajectory}`,
		`Biggest swings: ${swings}`,
		`Costliest move: ${mistake}`,
		'',
		'Write the one-sentence recap now.'
	].join('\n');
}
