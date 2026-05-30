/**
 * Calibration harness for the game-review accuracy model. Fetches a sample of a
 * chess.com account's *reviewed* games (only those carry chess.com's own
 * `accuracies`), runs our Stockfish pass at REVIEW_DEPTH, and reports how close
 * our per-side accuracy lands to chess.com's — the ground-truth check the
 * win%/accuracy model is tuned against. No Mongo: this talks to chess.com and
 * the engine directly.
 *
 *   npm run calibrate:review -- Timbolt123        # default 8 games
 *   npm run calibrate:review -- Timbolt123 20      # sample size
 *
 * Scope note: chess.com's public API exposes per-game `accuracies` but NOT
 * per-move classifications. So this validates the *accuracy* model (win% +
 * aggregation). CLASS_THRESHOLDS (classify.ts) aren't recoverable from
 * chess.com's public data — the per-class distribution printed at the end is
 * for eyeballing them, not for fitting.
 */
import { isCheckmate, isStalemate } from '../src/lib/chess/rules.ts';
import { MATE_SCORE_BASE, type EngineEval } from '../src/lib/engine/engine.ts';
import { StockfishNodeEngine } from '../src/lib/engine/stockfish-node.ts';
import { buildAnalysis, type GameAnalysis } from '../src/lib/review/analysis.ts';
import { REVIEW_DEPTH } from '../src/lib/client/reviewAnalysis.ts';
import { MOVE_CLASSES, type MoveClass } from '../src/lib/review/classify.ts';
import { normalize } from '../src/lib/review/normalize.ts';
import type { RawGame } from '../src/lib/review/source.ts';
import type { ReviewGame } from '../src/lib/review/types.ts';

const API_BASE = 'https://api.chess.com/pub';
const HEADERS = {
	'User-Agent': 'kids-chess-learner/calibration (game review tool; contact eike@paretos.com)',
	Accept: 'application/json'
};
const DEFAULT_SAMPLE = 8;

type ChessComAccuracies = { white: number; black: number };

type MonthGame = {
	url: string;
	pgn?: string;
	rules: string;
	rated: boolean;
	accuracies?: ChessComAccuracies;
};

type Sample = { raw: RawGame; accuracies: ChessComAccuracies };

function gameIdFromUrl(url: string): string {
	return url.split('/').filter(Boolean).pop() ?? url;
}

/** Walk archives newest-first, keeping only reviewed standard-chess games. */
async function fetchReviewedGames(user: string, limit: number): Promise<Sample[]> {
	const archivesRes = await fetch(`${API_BASE}/player/${user}/games/archives`, {
		headers: HEADERS
	});
	if (!archivesRes.ok) {
		throw new Error(`archives fetch failed: ${archivesRes.status}`);
	}
	const { archives } = (await archivesRes.json()) as { archives: string[] };

	const samples: Sample[] = [];
	for (let i = archives.length - 1; i >= 0 && samples.length < limit; i--) {
		const monthRes = await fetch(archives[i], { headers: HEADERS });
		if (!monthRes.ok) throw new Error(`archive fetch failed: ${monthRes.status}`);
		const { games } = (await monthRes.json()) as { games: MonthGame[] };
		for (const g of games.slice().reverse()) {
			if (g.rules !== 'chess' || !g.pgn || !g.accuracies) continue;
			samples.push({
				raw: {
					source: 'chesscom',
					gameId: gameIdFromUrl(g.url),
					url: g.url,
					pgn: g.pgn,
					rated: g.rated
				},
				accuracies: g.accuracies
			});
			if (samples.length >= limit) break;
		}
	}
	return samples;
}

/** Engine returns no move for terminal positions; encode the outcome directly
 *  (mirrors `terminalEval` in client/reviewAnalysis.ts). */
function terminalEval(fen: string): EngineEval | null {
	if (isCheckmate(fen)) return { cp: -MATE_SCORE_BASE, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	if (isStalemate(fen)) return { cp: 0, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	return null;
}

/** Node-side equivalent of client `analyzeGame()`: one eval per position. */
async function analyzeWithNode(
	engine: StockfishNodeEngine,
	game: ReviewGame
): Promise<GameAnalysis> {
	const { moves } = game;
	const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
	const evals: EngineEval[] = [];
	for (const fen of fens) {
		evals.push(terminalEval(fen) ?? (await engine.evaluate(fen, { depth: REVIEW_DEPTH })));
	}
	return buildAnalysis({
		source: game.source,
		gameId: game.gameId,
		depth: REVIEW_DEPTH,
		moves,
		evals
	});
}

function pad(s: string, n: number): string {
	return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
	const [account, sampleArg] = process.argv.slice(2);
	if (!account) {
		console.error('Usage: npm run calibrate:review -- <chesscom-username> [sampleSize]');
		process.exit(1);
	}
	const sampleSize = sampleArg ? Number(sampleArg) : DEFAULT_SAMPLE;
	const user = account.trim().toLowerCase();

	console.log(`Fetching up to ${sampleSize} reviewed games for ${user}…`);
	const samples = await fetchReviewedGames(user, sampleSize);
	if (samples.length === 0) {
		console.error(`No reviewed games (with chess.com accuracies) found for ${user}.`);
		process.exit(1);
	}
	console.log(`Got ${samples.length} reviewed games. Analyzing at depth ${REVIEW_DEPTH}…\n`);

	const engine = new StockfishNodeEngine();
	const absErrors: number[] = [];
	const signedErrors: number[] = [];
	const classCounts: Record<MoveClass, number> = {
		best: 0,
		good: 0,
		inaccuracy: 0,
		mistake: 0,
		blunder: 0
	};

	console.log(pad('game', 16), pad('side', 6), pad('ours', 7), pad('chess.com', 10), 'err');
	console.log('-'.repeat(52));

	for (const { raw, accuracies } of samples) {
		const game = normalize(raw);
		if (game.moves.length === 0) continue;
		const analysis = await analyzeWithNode(engine, game);
		for (const m of analysis.moves) classCounts[m.classification]++;

		for (const side of ['white', 'black'] as const) {
			const ours = analysis.accuracy[side];
			const theirs = accuracies[side];
			const err = ours - theirs;
			absErrors.push(Math.abs(err));
			signedErrors.push(err);
			console.log(
				pad(game.gameId.slice(0, 15), 16),
				pad(side, 6),
				pad(ours.toFixed(1), 7),
				pad(theirs.toFixed(1), 10),
				(err >= 0 ? '+' : '') + err.toFixed(1)
			);
		}
	}

	await engine.close?.();

	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	console.log('\n--- accuracy fit (lower is better) ---');
	console.log(`samples (side-games): ${absErrors.length}`);
	console.log(`mean abs error:       ${mean(absErrors).toFixed(2)} pts`);
	console.log(
		`mean signed error:    ${mean(signedErrors).toFixed(2)} pts (>0 = we score higher than chess.com)`
	);

	const totalMoves = MOVE_CLASSES.reduce((a, c) => a + classCounts[c], 0);
	console.log('\n--- our move-class distribution (informational; not fit to chess.com) ---');
	for (const c of MOVE_CLASSES) {
		const n = classCounts[c];
		console.log(`${pad(c, 12)} ${pad(String(n), 5)} ${((100 * n) / totalMoves).toFixed(1)}%`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
