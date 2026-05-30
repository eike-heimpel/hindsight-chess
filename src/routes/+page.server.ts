import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { useMongo } from '$lib/server/env';
import { getUser } from '$lib/server/auth';
import { listGamesForAccounts } from '$lib/server/reviewGames';
import { getAnalysesByIds } from '$lib/server/reviewAnalysis';
import { toPerspective } from '$lib/review/stats/perspective';
import { collectBlunders } from '$lib/review/stats/blunders';
import {
	buildCandidate,
	classifyWinnable,
	WINNING_FLOOR_DEFAULT,
	SUSTAIN_DEFAULT
} from '$lib/review/stats/winnable';
import type { PerspectiveGame, Record as Tally } from '$lib/review/stats/types';

/**
 * The home — the room you come back to after a game. Pure, server-rendered from
 * stored games + cached analyses (same data path as /review/stats, no engine):
 * a warm greeting, the latest game as a plain-English recap (the hook), a few
 * identity numbers, and doors into the depth. Account management stays on
 * /review; this is deliberately calm. See docs/product-strategy + docs/design.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Window for the "recent form" W–D–L line — recent enough to feel like *now*. */
const FORM_WINDOW = 12;

const analysisKey = (source: string, gameId: string) => `${source}:${gameId}`;

function tally(games: PerspectiveGame[]): Tally {
	const t: Tally = { win: 0, draw: 0, loss: 0 };
	for (const g of games) t[g.outcome]++;
	return t;
}

/** The give-back move (move number + win-% drop) for a non-won game I was once
 *  clearly winning — reused for the recap headline. Null when not applicable. */
function turningPoint(p: PerspectiveGame) {
	const candidate = buildCandidate(p);
	if (!candidate) return null;
	const verdict = classifyWinnable(candidate, {
		floor: WINNING_FLOOR_DEFAULT,
		sustain: SUSTAIN_DEFAULT
	});
	return verdict.giveBack;
}

/** One warm, plain-English line about the latest game — the hook. On your side,
 *  never scolding; the number is available but the sentence leads (see brand.md). */
function headlineFor(p: PerspectiveGame): string {
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

function recapFor(p: PerspectiveGame) {
	return {
		source: p.source,
		gameId: p.gameId,
		url: p.url ?? null,
		opponent: p.opponent,
		outcome: p.outcome,
		timeClass: p.timeClass,
		opening: p.opening ?? null,
		playedAt: p.playedAt,
		analyzed: p.analyzed,
		accuracy: p.accuracy ?? null,
		peakWin: p.peakWin ?? null,
		/** My-POV win-% at every position — drives the sparkline. */
		spark: p.winTimeline ?? null,
		headline: headlineFor(p)
	};
}

const EMPTY = {
	needsAccount: true,
	name: null as string | null,
	account: null as string | null,
	accounts: [] as string[],
	totalGames: 0,
	latest: null as ReturnType<typeof recapFor> | null,
	summary: {
		gamesThisWeek: 0,
		recentForm: { win: 0, draw: 0, loss: 0 } as Tally,
		sharpest: null as { accuracy: number; opponent: string; source: string; gameId: string } | null
	},
	depth: { blunders: 0, winnable: 0, analyzed: 0, total: 0 }
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(307, '/login');

	const accounts = user.reviewAccounts;
	const primary = accounts[0] ?? null;
	if (accounts.length === 0) return EMPTY;

	const accountsSet = new Set(accounts.map((a) => a.toLowerCase()));
	const games = await listGamesForAccounts(accounts);
	const analyses = await getAnalysesByIds(
		games.map((g) => ({ source: g.source, gameId: g.gameId }))
	);

	// games are newest-first, so perspectives stay newest-first.
	const perspectives = games
		.map((g) =>
			toPerspective(g, analyses.get(analysisKey(g.source, g.gameId)) ?? null, accountsSet)
		)
		.filter((p): p is PerspectiveGame => p !== null);

	const now = Date.now();
	const thisWeek = perspectives.filter((p) => now - p.playedAt.getTime() <= WEEK_MS);

	let sharpest: typeof EMPTY.summary.sharpest = null;
	for (const p of thisWeek) {
		if (!p.analyzed || p.accuracy == null) continue;
		if (!sharpest || p.accuracy > sharpest.accuracy) {
			sharpest = { accuracy: p.accuracy, opponent: p.opponent, source: p.source, gameId: p.gameId };
		}
	}

	const winnable = perspectives
		.map(buildCandidate)
		.filter((c) => c !== null)
		.filter(
			(c) =>
				classifyWinnable(c, { floor: WINNING_FLOOR_DEFAULT, sustain: SUSTAIN_DEFAULT }).qualifies
		).length;
	const blunders = collectBlunders({ games, analyses, accounts: accountsSet }).length;
	const analyzed = perspectives.filter((p) => p.analyzed).length;

	return {
		needsAccount: false,
		name: primary,
		account: primary,
		accounts,
		totalGames: games.length,
		latest: perspectives[0] ? recapFor(perspectives[0]) : null,
		summary: {
			gamesThisWeek: thisWeek.length,
			recentForm: tally(perspectives.slice(0, FORM_WINDOW)),
			sharpest
		},
		depth: { blunders, winnable, analyzed, total: games.length }
	};
};
