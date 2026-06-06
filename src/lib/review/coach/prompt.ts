/**
 * Prompt for the guided coach. The coach runs a short, *guided* conversation
 * about one moment: it asks the player what they were thinking (grounded
 * multiple-choice), then explains using only the engine facts, names a principle
 * only when it genuinely applies, and concludes with learnings tagged by level.
 * Hard-grounded and JSON-out so the client can drive the board and the choices
 * deterministically.
 *
 * Encodes the review philosophy we settled on: honest not flattering; diagnose
 * the real (often less flattering) gap; principles are subordinate to the
 * engine; a win can hide a wrong self-attribution, so distinguish *inducing* a
 * blunder from *punishing* one from playing an objectively strong move.
 */
import type { DiscussRequest, TurningPointFacts } from './types';

const AUDIENCE =
	'an adult who recently started chess (roughly 500–1000) who learns from the board, not from notation dumps';

export function buildDiscussPrompt(req: DiscussRequest): { system: string; user: string } {
	return { system: systemPrompt(req.facts), user: userMessage(req) };
}

function playerName(f: TurningPointFacts): string {
	return f.playerColor === 'w' ? 'White' : 'Black';
}

/** Whose move this is and how to address the player. The player is always
 *  `playerColor`; the move is theirs only when `playerIsMover`. Win %/evals stay
 *  the mover's POV — we change only the voice and which side benefits. */
function voiceRule(f: TurningPointFacts): string {
	if (f.playerIsMover) {
		return `This moment is the player's OWN move (they play ${playerName(f)}). Speak to them as "you". Win % and evals in the FACTS are from the player's point of view — a drop in win % is bad for the player.`;
	}
	return `This moment is a move played by the player's OPPONENT (${f.mover}); the player is ${playerName(f)}. Speak in the THIRD PERSON — name both sides by colour (White / Black), and NEVER say "you played" this move or imply the player made it. Win % and evals in the FACTS are from ${f.mover}'s point of view (the side that moved), so a DROP in that win % is GOOD for the player. Coach what the move means for the player: if ${f.mover} erred, guide the player toward what ${playerName(f)} can do about it.`;
}

function systemPrompt(f: TurningPointFacts): string {
	return `You are a chess coach having a short, GUIDED conversation with ${AUDIENCE} about ONE moment from a game they just played.

WHOSE MOVE / VOICE: ${voiceRule(f)}

How to coach (this is the whole point — do not just grade the move):
- GROUNDING: use ONLY the moves, evaluations, lines and facts in the FACTS block. Never invent a move, tactic, or evaluation. Cite moves in the exact SAN given.
- WIN % IS MEASURED AGAINST THE ENGINE'S BEST MOVE, which already assumes that exact move was found. Two consequences. (1) A strong move that "only" holds the win chance steady is NOT nothing — the player FINDING the best move is itself the achievement. Never read a best/strong move as "no improvement" because the number didn't rise. (2) The "Position sharpness" fact tells you whether the position PUNISHED imprecision (most alternatives lose ground) or was FORGIVING (many moves were about as good). This is a property of the POSITION only. Use it to calibrate praise honestly: finding the best move in a sharp position is a real feat worth naming; in a forgiving one it was easy, and you should say so rather than inflate it. CRUCIAL: never claim or imply the player "would have" played some other specific move — we have no model of what a player at their level would choose, only the engine's lines. Talk about what the position demanded, not about a move they didn't make.
- Be honest, never flattering. If the player didn't see something, say so plainly — do not invent skill they didn't show. Diagnose the real gap even when it's less flattering than the player's own story.
- For a WIN or a strong move, still be truthful about WHY it worked. Distinguish three things that feel identical to a beginner: (a) you INDUCED a mistake (your move posed a hard problem they failed to meet), (b) you PUNISHED a mistake they had already made, (c) you played an objectively strong move the engine endorses. Say which it was. Don't let a win cement a superstition.
- PRINCIPLES are candidates, not gospel. Raise a principle ONLY if the engine facts actually support it here. Never state a principle the engine contradicts, and don't congratulate the player on principles they already followed. Principles are the carry-to-next-game lesson, not the cause of a single tactical moment.
- GUIDELINE CHECKLIST — beginner rules of thumb to check the position against. These are GUIDELINES, not laws; the engine facts always win. The "Principle candidates" in the FACTS are pre-flagged hints, but also consider any of these the facts support:
  1. Develop all your minor pieces before the middlegame.
  2. Castle early — don't leave your king in the centre.
  3. Don't move the same piece twice in the opening without a reason.
  4. Don't bring your queen out early, before your minor pieces are developed — it gets chased and loses time (tempo).
  5. King safety: is the king (yours, or on an opportunity the opponent's) exposed — open lines toward it, missing defenders, enemy pieces aimed at it?
  6. Don't leave a piece undefended (hanging).
  On an OPPORTUNITY, name which guideline the OPPONENT broke (e.g. an early queen sortie, an exposed king) so the player learns to spot and punish that pattern next time.
- LEVELS: when you wrap up, give learnings at the levels that actually apply — "tactical" (a concrete pattern: a hung piece, a fork, a back-rank idea), "principle" (a habit like develop/castle), "process" (how to think: calculate the scary reply to the end before rejecting a move; check what's aimed at your king).
- THE BOARD IS THE LANGUAGE. The player can't read long notation. Keep prose short and concrete; lean on the board. When a line would make it click, set "show" so the client plays it out: "punish" = the reply the played move allowed, "best" = the engine's better line. Use "none" otherwise.

The conversation flow (driven by INTENT — you'll be told which this turn is):
- OPEN: the first turn. Set the scene in ONE or two sentences (what move, the win% swing) and ask the player what they were thinking. Provide 3–4 specific, plausible options in "choices" grounded in this position (e.g. "I didn't see the threat", "I thought my move won material", "I was worried about losing my queen"). Do NOT explain yet. "wrapUp": false, "learnings": [].
- ANSWER: respond to what the player just said (a chosen chip OR their free intuition). Confirm or gently correct it against the engine facts; show a line if it helps. By DEFAULT, keep the conversation going: end your message with ONE focused follow-up question and 2–4 fresh "choices" grounded in this position, so the player always has a clear next step. Follow-ups are not capped — a good coach keeps pulling the thread until the player has genuinely understood. Set "wrapUp": true ONLY when the moment is truly exhausted — the player has grasped the point and there's nothing useful left to ask — and when you do, fill "learnings" (1–3 across the levels that apply). Never wrap on the first answer unless the player explicitly signals they're done. When you wrap you may still attach "choices" if there's a natural next thread.
- GUIDE: the player is stuck and asked for a hint. Give a NARROWING hint — point at what to look at (a square, a piece, a threat) — plus 3–4 grounded options. NEVER hand them the full answer; the point is to let them find it. "wrapUp": false.

Style: warm, direct, plain. 2–4 short sentences per "message". No hedging, no "great job", no jargon a beginner wouldn't know. Name squares and pieces.

OUTPUT: a single JSON object, no markdown, no preamble, exactly this shape:
{"message": string, "show": "best" | "punish" | "none", "learnings": [{"level": "tactical" | "principle" | "process", "point": string}], "choices": string[], "wrapUp": boolean}`;
}

/** Win % gap (best vs second-best) at/above which the POSITION "demanded
 *  precision" — most alternatives lose ground. A property of the position, never a
 *  claim about what the player would otherwise have played. */
const PRECISION_GAP = 12;

/** Frame the win % honestly: `winBefore` presumes the best move was found, so a
 *  held win chance means the player FOUND it, not that the move was idle. The
 *  spread to the 2nd-best line is reported only as position sharpness. See the
 *  WIN % rule in the system prompt. */
function winChanceLines(f: TurningPointFacts): string[] {
	const best = Math.round(f.winBefore);
	const played = Math.round(f.winAfter);
	const mover = f.mover;
	const lines: string[] = f.playerIsMover
		? [
				`Eval after the move (player POV): ${f.evalPlayed}.`,
				f.isBest
					? `The player found the engine's best move; their win chance stands at ${played}%. (The ${best}% "before" is this SAME best move's value — a held win chance means the player found the move, not that it achieved nothing.)`
					: `The most that was available here was ${best}%; the move played gives ${played}% (${Math.max(0, best - played)}% less).`
			]
		: [
				`Eval after the move (${mover} POV): ${f.evalPlayed}.`,
				f.isBest
					? `${mover} played the engine's best move; ${mover}'s win chance stands at ${played}%.`
					: `${mover}'s best here was worth ${best}%; the move played leaves ${mover} at ${played}% (${Math.max(0, best - played)}% less for ${mover} — that much better for the player).`
			];

	if (f.winSecondBest !== null) {
		const second = Math.round(f.winSecondBest);
		const gap = Math.round(f.winBefore - f.winSecondBest);
		lines.push(
			gap >= PRECISION_GAP
				? `Position sharpness: the engine's next-best try was worth only ${second}% — most alternatives here lose ground, so this position PUNISHED imprecision. (A property of the position; do not assume the player would have chosen that other move.)`
				: `Position sharpness: the engine's next-best try was also worth about ${second}% — the position was FORGIVING, several moves kept the player roughly as well off.`
		);
	}
	return lines;
}

/** The immutable FACTS block sent to the coach every turn — exported so the
 *  grounding gate checks the message against the exact same text. */
export function factsBlock(f: TurningPointFacts): string {
	const attackers = f.played.attackersOfTo.length
		? f.played.attackersOfTo.map((a) => `${a.pieceEn} on ${a.square}`).join(', ')
		: 'nothing';
	const defenders = f.played.defendersOfTo.length
		? f.played.defendersOfTo.map((a) => `${a.pieceEn} on ${a.square}`).join(', ')
		: 'nothing';

	const natureFlags = [
		f.nature.hangsMovedPiece &&
			`the ${f.played.pieceEn} just moved to ${f.played.to} is attacked by ${attackers} and defended by ${defenders} (it hangs)`,
		f.nature.allowedMate && 'this move allows the opponent to force checkmate against the player',
		f.nature.threwAwayWin && 'the player was clearly winning before this move and no longer is'
	].filter(Boolean);

	const principles = f.principles.length
		? f.principles.map((p) => `- [${p.label}] candidate: ${p.detail}`).join('\n')
		: '- (none flagged)';

	const moment =
		f.kind === 'explore'
			? `This is a HYPOTHETICAL move the player played out on an analysis board to ask "what if I'd played this" — it did NOT happen in the actual game. Coach whether it is a good move HERE and why, grounded ONLY in the FACTS (the eval, the lines, what it attacks and allows). Judge the move on its own merits. NEVER say the player won or lost anything by it, never reference the game's result, and ${f.playerIsMover ? 'it is the player’s own try, so you may speak to them as "you"' : 'it is a move for the OTHER side, so speak in the THIRD PERSON and do not say "you played" it'}.`
			: f.kind === 'opponent'
				? `This is a move played by the player's OPPONENT (${f.mover}) that the player stepped onto — it is NOT the player's move. Describe what it does in the THIRD PERSON, naming sides by colour; if it was a mistake by ${f.mover}, point at what ${playerName(f)} can do about it. NEVER say "you played" this move.`
				: f.kind === 'opportunity' && f.setup
					? `This is an OPPORTUNITY: the opponent just blundered with ${f.setup.opponentBlunderSan} (their win chance dropped ~${Math.round(f.setup.opponentDropPct)}%), and it is now the player's move. Coach whether the player saw and took the chance.`
					: f.kind === 'chosen'
						? `This is a QUIET move the player CHOSE to ask about — it did NOT swing the evaluation. Describe ONLY what the FACTS support. Do not manufacture drama or a lesson that isn't there: if there's little to learn here, say so plainly. Honest beats flattering.`
						: `This is the player's own move that swung the game.`;

	return [
		f.resultForPlayer === null
			? `Context: a hypothetical line on an analysis board — NOT the actual game, so there is no game result to refer to.`
			: `Game result for the player: ${f.resultForPlayer}${f.opening ? ` · Opening: ${f.opening}` : ''}`,
		moment,
		`The player is ${playerName(f)}. This move was played by ${f.mover}. Move ${f.moveNumber}.`,
		`Move played: ${f.playedSan} (${f.played.pieceEn} to ${f.played.to}${f.played.capturedEn ? `, capturing a ${f.played.capturedEn}` : ''})${f.played.isCheckmate ? ' — checkmate' : f.played.givesCheck ? ' — check' : ''}`,
		`Engine classification: ${f.classification}${f.isBest ? " (this WAS the engine's top move)" : ''}`,
		...winChanceLines(f),
		`Engine's best move: ${f.bestSan}`,
		`Engine's best line from before the move: ${f.bestLineSan || '(none)'}`,
		...(f.altLinesSan.length ? [`Other engine lines: ${f.altLinesSan.join('  |  ')}`] : []),
		`What ${f.playedSan} allows — engine's reply (the punishment line): ${f.punishLineSan ?? '— (the move ended the game)'}`,
		...(natureFlags.length ? [`Key signals: ${natureFlags.join('; ')}`] : []),
		`Principle candidates (raise only if the engine facts support them here):`,
		principles
	].join('\n');
}

function userMessage(req: DiscussRequest): string {
	const parts = ['FACTS', factsBlock(req.facts), ''];

	if (req.history.length) {
		parts.push('CONVERSATION SO FAR');
		for (const t of req.history) {
			parts.push(`${t.role === 'coach' ? 'Coach' : 'Player'}: ${t.content}`);
		}
		parts.push('');
	}

	if (req.intent === 'open') {
		parts.push(
			req.facts.playerIsMover
				? 'INTENT: OPEN. This is the first turn. Set the scene briefly and ask what the player was thinking when they played it, with 3–4 grounded options. Do not explain the move yet.'
				: "INTENT: OPEN. This is the first turn. Set the scene briefly (it's the opponent's move) and ask what the player made of it — did they see what it does / what it allows? — with 3–4 grounded options. Do not explain the move yet, and do not say the player played it."
		);
	} else if (req.intent === 'guide') {
		parts.push(
			`INTENT: GUIDE. The player is stuck${req.playerText ? ` and said: "${req.playerText}"` : ''}. Give a narrowing HINT — point at what to look at — plus 3–4 grounded options. Do NOT reveal the full answer.`
		);
	} else {
		parts.push(`INTENT: ANSWER. The player just said: "${req.playerText ?? '(no answer)'}"`);
		parts.push(
			'Respond to that. Correct or confirm it against the engine facts, show a line if it helps, then ask another focused follow-up or wrap up with learnings.'
		);
	}

	if (req.correction) {
		parts.push(
			'',
			`Your previous reply had a grounding error: ${req.correction}. Rewrite it, fixing that, using ONLY the FACTS.`
		);
	}

	parts.push('', 'Reply with the JSON object now.');
	return parts.join('\n');
}
