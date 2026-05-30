/**
 * The deterministic, data-driven recap headline — one warm, plain-English line
 * about a game, on the player's side, never scolding (see docs/design brand
 * voice). This is the fallback the home card uses everywhere the LLM "story"
 * headline isn't available: the loader's SSR line, a not-yet-analyzed game, the
 * setting turned off, or the writer throwing. Behaviour is identical to the old
 * `headlineFor` that lived in `+page.server.ts`.
 */
import type { PerspectiveGame } from './stats/types';
import {
	buildCandidate,
	classifyWinnable,
	WINNING_FLOOR_DEFAULT,
	SUSTAIN_DEFAULT
} from './stats/winnable';

/** The give-back move (move number + win-% drop) for a non-won game I was once
 *  clearly winning — the turning point the headline points at. Null when N/A. */
function turningPoint(p: PerspectiveGame) {
	const candidate = buildCandidate(p);
	if (!candidate) return null;
	const verdict = classifyWinnable(candidate, {
		floor: WINNING_FLOOR_DEFAULT,
		sustain: SUSTAIN_DEFAULT
	});
	return verdict.giveBack;
}

export function templateHeadline(p: PerspectiveGame): string {
	const opp = p.opponent;
	if (!p.analyzed || !p.winTimeline) {
		if (p.outcome === 'win') return `A win over ${opp}. See how you got there.`;
		if (p.outcome === 'draw') return `A draw with ${opp}. See how it played out.`;
		return `A loss to ${opp}. Let's find where it turned.`;
	}

	const timeline = p.winTimeline;
	const peak = Math.round(p.peakWin ?? Math.max(...timeline));
	const low = Math.round(Math.min(...timeline));

	if (p.outcome === 'win') {
		if (low >= 55) return `Wire to wire — you stayed in control against ${opp}.`;
		if (low < 35) return `You were in trouble — down to ${low}% — then turned it around.`;
		return `A composed win over ${opp}. You kept the edge when it mattered.`;
	}

	const giveBack = turningPoint(p);
	const tail = p.outcome === 'draw' ? 'then it slipped to a draw.' : 'then it slipped away.';
	if (giveBack && peak >= WINNING_FLOOR_DEFAULT) {
		return `You were winning — up to ${peak}% around move ${giveBack.moveNumber} — ${tail}`;
	}
	if (peak >= 60)
		return `You had your chances against ${opp} — peaked at ${peak}% — but it got away.`;
	return `A tough one against ${opp}. Let's find the moment it turned.`;
}
