/**
 * Fold a person's games (+ analyses) into per-time-class stats. Pure: hand it the
 * stored games and a map of analyses keyed `source:gameId`, get back one
 * `ReviewStats` per time class, ordered by game count (most-played first).
 *
 * Adding a stat = add a field to `ReviewStats` and a reducer here. Every reducer
 * folds the same `PerspectiveGame[]`, so none of them re-derive "me".
 */
import type { Side } from '$lib/chess/types';
import type { GameAnalysis } from '../analysis';
import type { ReviewGame } from '../types';
import { MOVE_CLASSES, type MoveClass } from '../classify';
import { toPerspective } from './perspective';
import { buildCandidate } from './winnable';
import type {
	PerspectiveGame,
	Phase,
	RatingBand,
	Record as Tally,
	ReviewStats,
	TrendPoint,
	WinnableCandidate
} from './types';

/** Opponent within ±this rating counts as an even match. */
const EVEN_RATING_MARGIN = 100;

/** Upper bound (exclusive, ms) of each move-time bucket; the last is open-ended. */
const TIME_BUCKETS: { label: string; maxMs: number }[] = [
	{ label: '<2s', maxMs: 2_000 },
	{ label: '2–5s', maxMs: 5_000 },
	{ label: '5–10s', maxMs: 10_000 },
	{ label: '10–30s', maxMs: 30_000 },
	{ label: '30s+', maxMs: Infinity }
];

const analysisKey = (source: string, gameId: string) => `${source}:${gameId}`;

export function computeReviewStats(args: {
	games: ReviewGame[];
	analyses: Map<string, GameAnalysis>;
	accounts: Set<string>;
}): ReviewStats[] {
	const { games, analyses, accounts } = args;
	const perspectives = games
		.map((g) => toPerspective(g, analyses.get(analysisKey(g.source, g.gameId)) ?? null, accounts))
		.filter((p): p is PerspectiveGame => p !== null);

	const byClass = new Map<string, PerspectiveGame[]>();
	for (const p of perspectives) {
		const bucket = byClass.get(p.timeClass) ?? [];
		bucket.push(p);
		byClass.set(p.timeClass, bucket);
	}

	return [...byClass.entries()]
		.map(([timeClass, gs]) => statsFor(timeClass, gs))
		.sort((a, b) => b.totalGames - a.totalGames);
}

function statsFor(timeClass: string, games: PerspectiveGame[]): ReviewStats {
	const chronological = [...games].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
	const analyzed = chronological.filter((g) => g.analyzed);

	return {
		timeClass,
		totalGames: games.length,
		analyzedGames: analyzed.length,
		record: tally(games),
		winRate: winRate(games),
		avgAccuracy: mean(analyzed.map((g) => g.accuracy!)),
		accuracyTrend: trend(analyzed, (g) => g.accuracy!),
		avgBlundersPerGame: mean(analyzed.map(blunderCount)),
		blunderTrend: trend(analyzed, blunderCount),
		ratingTrend: trend(
			chronological.filter((g) => g.myRating != null),
			(g) => g.myRating!
		),
		moveClasses: moveClassDistribution(analyzed),
		blundersByPhase: blundersByPhase(analyzed),
		timeVsQuality: timeVsQuality(analyzed),
		byColor: byColor(games),
		byOpening: byOpening(games),
		byRatingBand: byRatingBand(games),
		terminations: terminations(games),
		winnable: winnable(analyzed)
	};
}

// --- shared helpers ---------------------------------------------------------

function mean(xs: number[]): number | null {
	if (xs.length === 0) return null;
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function tally(games: PerspectiveGame[]): Tally {
	const t: Tally = { win: 0, draw: 0, loss: 0 };
	for (const g of games) t[g.outcome]++;
	return t;
}

/** Win rate over decisive + drawn games (draws count as half), 0..100. */
function winRate(games: PerspectiveGame[]): number {
	if (games.length === 0) return 0;
	const points = games.reduce(
		(a, g) => a + (g.outcome === 'win' ? 1 : g.outcome === 'draw' ? 0.5 : 0),
		0
	);
	return (points / games.length) * 100;
}

function trend(games: PerspectiveGame[], value: (g: PerspectiveGame) => number): TrendPoint[] {
	return games.map((g) => ({
		source: g.source,
		gameId: g.gameId,
		playedAt: g.playedAt,
		value: value(g)
	}));
}

const blunderCount = (g: PerspectiveGame) =>
	g.moves.filter((m) => m.classification === 'blunder').length;

// --- reducers ---------------------------------------------------------------

function moveClassDistribution(games: PerspectiveGame[]): { class: MoveClass; count: number }[] {
	const counts = new Map<MoveClass, number>(MOVE_CLASSES.map((c) => [c, 0]));
	for (const g of games)
		for (const m of g.moves)
			if (m.classification) counts.set(m.classification, counts.get(m.classification)! + 1);
	return MOVE_CLASSES.map((c) => ({ class: c, count: counts.get(c)! }));
}

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

/** Blunders + mistakes per phase — where the person's serious slips cluster. */
function blundersByPhase(games: PerspectiveGame[]): { phase: Phase; count: number }[] {
	const counts = new Map<Phase, number>(PHASES.map((p) => [p, 0]));
	for (const g of games)
		for (const m of g.moves)
			if (m.classification === 'blunder' || m.classification === 'mistake')
				counts.set(m.phase, counts.get(m.phase)! + 1);
	return PHASES.map((p) => ({ phase: p, count: counts.get(p)! }));
}

/** Serious-slip rate (blunder+mistake share) by how long the move took. Answers
 *  "do I slip when I rush?". Only moves with both a clock and a classification. */
function timeVsQuality(
	games: PerspectiveGame[]
): { bucket: string; sample: number; slipRate: number }[] {
	const buckets = TIME_BUCKETS.map((b) => ({ label: b.label, slips: 0, sample: 0 }));
	for (const g of games)
		for (const m of g.moves) {
			if (m.msSpent == null || !m.classification) continue;
			const idx = TIME_BUCKETS.findIndex((b) => m.msSpent! < b.maxMs);
			buckets[idx].sample++;
			if (m.classification === 'blunder' || m.classification === 'mistake') buckets[idx].slips++;
		}
	return buckets.map((b) => ({
		bucket: b.label,
		sample: b.sample,
		slipRate: b.sample ? (b.slips / b.sample) * 100 : 0
	}));
}

function byColor(games: PerspectiveGame[]): ReviewStats['byColor'] {
	return (['w', 'b'] as Side[])
		.map((side) => {
			const subset = games.filter((g) => g.side === side);
			const analyzed = subset.filter((g) => g.analyzed);
			return {
				side,
				games: subset.length,
				record: tally(subset),
				winRate: winRate(subset),
				accuracy: mean(analyzed.map((g) => g.accuracy!))
			};
		})
		.filter((c) => c.games > 0);
}

function byOpening(games: PerspectiveGame[]): ReviewStats['byOpening'] {
	const groups = new Map<string, PerspectiveGame[]>();
	for (const g of games) {
		const key = g.opening ?? 'Unknown opening';
		const bucket = groups.get(key) ?? [];
		bucket.push(g);
		groups.set(key, bucket);
	}
	return [...groups.entries()]
		.map(([opening, gs]) => ({
			opening,
			games: gs.length,
			winRate: winRate(gs),
			accuracy: mean(gs.filter((g) => g.analyzed).map((g) => g.accuracy!))
		}))
		.sort((a, b) => b.games - a.games);
}

function bandFor(g: PerspectiveGame): RatingBand {
	if (g.myRating == null || g.opponentRating == null) return 'unknown';
	const diff = g.opponentRating - g.myRating;
	if (diff > EVEN_RATING_MARGIN) return 'stronger';
	if (diff < -EVEN_RATING_MARGIN) return 'weaker';
	return 'even';
}

const RATING_BANDS: RatingBand[] = ['weaker', 'even', 'stronger', 'unknown'];

function byRatingBand(games: PerspectiveGame[]): ReviewStats['byRatingBand'] {
	const groups = new Map<RatingBand, PerspectiveGame[]>(RATING_BANDS.map((b) => [b, []]));
	for (const g of games) groups.get(bandFor(g))!.push(g);
	return RATING_BANDS.map((band) => ({
		band,
		games: groups.get(band)!.length,
		winRate: winRate(groups.get(band)!)
	})).filter((b) => b.games > 0);
}

/** chess.com Termination strings are personalised ("Foo won by resignation");
 *  reduce to the method via keywords. */
function terminationMethod(termination: string): string {
	const t = termination.toLowerCase();
	if (t.includes('checkmate')) return 'checkmate';
	if (t.includes('resignation') || t.includes('resigned')) return 'resignation';
	if (t.includes('time') || t.includes('abandon')) return 'timeout';
	if (t.includes('agreement')) return 'agreement';
	if (t.includes('stalemate')) return 'stalemate';
	if (t.includes('repetition')) return 'repetition';
	if (t.includes('insufficient')) return 'insufficient material';
	if (t.includes('50') || t.includes('fifty')) return 'fifty-move';
	return 'other';
}

function terminations(games: PerspectiveGame[]): { method: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const g of games) {
		const method = terminationMethod(g.termination);
		counts.set(method, (counts.get(method) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([method, count]) => ({ method, count }))
		.sort((a, b) => b.count - a.count);
}

/** Non-won games I was ever clearly winning in — raw candidates the page tiers
 *  client-side by the winnable-loss levers (`classifyWinnable`). Most-squandered
 *  (highest peak) first. */
function winnable(games: PerspectiveGame[]): WinnableCandidate[] {
	return games
		.map(buildCandidate)
		.filter((c): c is WinnableCandidate => c !== null)
		.sort((a, b) => b.peakWin - a.peakWin);
}
