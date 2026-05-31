/**
 * One-off: produce the genuine RecapView for the landing page's static example,
 * by running a REAL game of the dogfooding account through the SAME pipeline +
 * depth the anonymous teaser uses (LIGHT_DEPTH). Prints a ready-to-paste object.
 *
 *   npx tsx scripts/build-landing-example.ts <chesscom-user> <gameId>
 */
import { isCheckmate, isStalemate } from '../src/lib/chess/rules.ts';
import { MATE_SCORE_BASE, type EngineEval } from '../src/lib/engine/engine.ts';
import { StockfishNodeEngine } from '../src/lib/engine/stockfish-node.ts';
import { buildAnalysis } from '../src/lib/review/analysis.ts';
import { LIGHT_DEPTH } from '../src/lib/client/reviewAnalysis.ts';
import { normalize } from '../src/lib/review/normalize.ts';
import { recapOverlayFrom, sideFor, toPerspective } from '../src/lib/review/stats/perspective.ts';
import { templateHeadline } from '../src/lib/review/headlineTemplate.ts';
import type { RawGame } from '../src/lib/review/source.ts';

const HEADERS = { 'User-Agent': 'hindsight-dev (eike@paretos.com)', Accept: 'application/json' };

function terminalEval(fen: string): EngineEval | null {
	if (isCheckmate(fen)) return { cp: -MATE_SCORE_BASE, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	if (isStalemate(fen)) return { cp: 0, bestMoveUci: '', bestMoveSan: '', depth: 0 };
	return null;
}

async function main() {
	const [user, gameId] = process.argv.slice(2);
	if (!user || !gameId) {
		console.error('Usage: npx tsx scripts/build-landing-example.ts <chesscom-user> <gameId>');
		process.exit(1);
	}

	const { archives } = (await (
		await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/archives`, {
			headers: HEADERS
		})
	).json()) as { archives: string[] };

	let raw: RawGame | null = null;
	for (let i = archives.length - 1; i >= 0 && !raw; i--) {
		const { games } = (await (await fetch(archives[i], { headers: HEADERS })).json()) as {
			games: { url: string; pgn?: string; rated: boolean }[];
		};
		const g = games.find((g) => g.url.endsWith(gameId));
		if (g?.pgn) raw = { source: 'chesscom', gameId, url: g.url, pgn: g.pgn, rated: g.rated };
	}
	if (!raw) throw new Error(`game ${gameId} not found for ${user}`);

	const game = normalize(raw);
	const accounts = new Set([user.toLowerCase()]);
	const side = sideFor(game, accounts);
	if (!side) throw new Error('account did not play in this game');

	const engine = new StockfishNodeEngine();
	const fens = [game.moves[0].fenBefore, ...game.moves.map((m) => m.fenAfter)];
	const evals: EngineEval[] = [];
	for (const fen of fens)
		evals.push(terminalEval(fen) ?? (await engine.evaluate(fen, { depth: LIGHT_DEPTH })));
	await engine.close?.();

	const analysis = buildAnalysis({
		source: game.source,
		gameId: game.gameId,
		depth: LIGHT_DEPTH,
		moves: game.moves,
		evals
	});
	const overlay = recapOverlayFrom(analysis, side);
	const p = toPerspective(game, analysis, accounts)!;

	console.log(
		JSON.stringify(
			{
				outcome: p.outcome,
				opponent: p.opponent,
				opening: p.opening,
				timeClass: p.timeClass,
				headline: templateHeadline(p),
				spark: overlay.spark.map((v) => Math.round(v)),
				peakWin: Math.round(overlay.peakWin),
				accuracy: Math.round(overlay.accuracy),
				analyzed: true
			},
			null,
			2
		)
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
