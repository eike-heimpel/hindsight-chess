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
import { templateHeadline } from '$lib/review/headlineTemplate';
import { getUserSettings } from '$lib/server/userSettings';
import { getHeadlinesByIds } from '$lib/server/reviewHeadlines';
import type { PerspectiveGame, Record as Tally } from '$lib/review/stats/types';
import type { ReviewSource } from '$lib/review/types';

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
/** How many recent games the home card lets you flip back through (newest first). */
const RECENT_LIMIT = 10;

const analysisKey = (source: string, gameId: string) => `${source}:${gameId}`;

function tally(games: PerspectiveGame[]): Tally {
	const t: Tally = { win: 0, draw: 0, loss: 0 };
	for (const g of games) t[g.outcome]++;
	return t;
}

const headlineKey = (source: string, gameId: string, side: string) => `${source}:${gameId}:${side}`;

function recapFor(p: PerspectiveGame, cachedHeadlines: Map<string, string>) {
	return {
		source: p.source,
		gameId: p.gameId,
		side: p.side,
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
		/** A cached LLM "story" headline if one exists (no flash on repeat
		 *  visits); otherwise the deterministic template. The client may upgrade
		 *  this to a freshly-written story after it analyzes the game. */
		headline: cachedHeadlines.get(headlineKey(p.source, p.gameId, p.side)) ?? templateHeadline(p)
	};
}

const EMPTY = {
	needsAccount: true,
	name: null as string | null,
	account: null as string | null,
	accounts: [] as string[],
	llmHeadlines: true,
	totalGames: 0,
	recents: [] as ReturnType<typeof recapFor>[],
	summary: {
		gamesThisWeek: 0,
		recentForm: { win: 0, draw: 0, loss: 0 } as Tally,
		sharpest: null as { accuracy: number; opponent: string; source: string; gameId: string } | null
	},
	depth: { blunders: 0, winnable: 0, analyzed: 0, total: 0 }
};

export const load: PageServerLoad = async ({ locals, depends }) => {
	// The client re-runs this (without a full reload) after an auto-sync pulls
	// new games — see +page.svelte's `invalidate('app:recents')`.
	depends('app:recents');

	if (!useMongo()) throw error(503, 'mongo not configured');
	const user = await getUser(locals);
	if (!user) throw redirect(307, '/login');

	// The home scopes to the active profile — platforms stay separate (ratings
	// don't translate), so we never blend chess.com and lichess into one view.
	const active = user.activeAccount;
	if (!active) return EMPTY;
	const primary = active.username;

	const settings = await getUserSettings(user.userId);

	const accountsSet = new Set([active.username.toLowerCase()]);
	const games = await listGamesForAccounts([active]);
	const analyses = await getAnalysesByIds(
		games.map((g) => ({ source: g.source, gameId: g.gameId }))
	);

	// games are newest-first, so perspectives stay newest-first.
	const perspectives = games
		.map((g) =>
			toPerspective(g, analyses.get(analysisKey(g.source, g.gameId)) ?? null, accountsSet)
		)
		.filter((p): p is PerspectiveGame => p !== null);

	const recents = perspectives.slice(0, RECENT_LIMIT);
	// Batch-read cached LLM headlines for the recents so SSR shows a known story
	// instantly. Loader stays pure (DB reads only) — no LLM call here.
	const cachedHeadlines = await getHeadlinesByIds(
		recents.map((p) => ({ source: p.source as ReviewSource, gameId: p.gameId, side: p.side }))
	);

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
		accounts: [active.username],
		llmHeadlines: settings.llmHeadlines,
		totalGames: games.length,
		recents: recents.map((p) => recapFor(p, cachedHeadlines)),
		summary: {
			gamesThisWeek: thisWeek.length,
			recentForm: tally(perspectives.slice(0, FORM_WINDOW)),
			sharpest
		},
		depth: { blunders, winnable, analyzed, total: games.length }
	};
};
