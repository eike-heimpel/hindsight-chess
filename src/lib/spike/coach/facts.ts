/**
 * Build the grounded fact pack for one turning point. Reuses the review
 * explainer's `buildExplainFacts` for the hard chess.js + eval derivations
 * (single source of truth for "what does this move do"), then layers on the
 * principle signals and game context the guided coach needs. Pure + browser-safe.
 */
import type { EngineLine } from '$lib/engine/engine';
import type { ReviewGame } from '$lib/review/types';
import type { Side } from '$lib/chess/types';
import { buildExplainFacts } from '$lib/review/explain';
import { winPercent } from '$lib/review/winPercent';
import { detectPrinciples } from './principles';
import type { TurningPointFacts } from './types';

export type TurningPointInput = {
	ply: number;
	fenBefore: string;
	playedUci: string;
	kind: 'mistake' | 'opportunity';
	setup: { opponentBlunderSan: string; opponentDropPct: number } | null;
	/** Engine top lines from fenBefore, best first, mover POV. */
	bestLines: EngineLine[];
	/** Engine reply from the position after the played move, opponent POV. Null
	 *  when the move ended the game. */
	replyLine: EngineLine | null;
};

function resultForPlayer(game: ReviewGame, side: Side): 'win' | 'loss' | 'draw' {
	if (game.result === '1/2-1/2') return 'draw';
	const whiteWon = game.result === '1-0';
	return whiteWon === (side === 'w') ? 'win' : 'loss';
}

export function buildTurningPointFacts(
	game: ReviewGame,
	side: Side,
	tp: TurningPointInput
): TurningPointFacts {
	const f = buildExplainFacts({
		source: game.source,
		gameId: game.gameId,
		ply: tp.ply,
		fenBefore: tp.fenBefore,
		playedUci: tp.playedUci,
		bestLines: tp.bestLines,
		replyLine: tp.replyLine
	});

	// `winBefore` is the engine's BEST move's value — it presumes that move was
	// found. The second line's win% gauges how SHARP the position was: a big gap
	// means most alternatives lose ground; a small gap means it was forgiving. It is
	// a property of the position, not a guess at what the player would have played.
	// Null when the engine returned a single line (a forced / only move).
	const secondCp = tp.bestLines[1]?.cp ?? null;
	const winSecondBest = secondCp === null ? null : winPercent(secondCp);

	const principles = detectPrinciples({
		moves: game.moves,
		ply: tp.ply,
		side,
		fenBefore: tp.fenBefore,
		moveNumber: f.moveNumber
	});

	return {
		ply: tp.ply,
		moveNumber: f.moveNumber,
		mover: f.mover,
		playerColor: side,
		kind: tp.kind,
		setup: tp.setup,
		playedSan: f.playedSan,
		bestSan: f.bestSan,
		isBest: f.isBest,
		classification: f.classification,
		winBefore: f.winBefore,
		winAfter: f.winAfter,
		winSecondBest,
		evalPlayed: f.evalPlayed,
		played: f.played,
		bestLineSan: f.lines[0]?.sanLine ?? f.bestSan,
		altLinesSan: f.lines
			.slice(1)
			.map((l) => l.sanLine)
			.filter(Boolean),
		punishLineSan: f.replySanLine,
		nature: f.nature,
		principles,
		opening: game.opening ?? null,
		resultForPlayer: resultForPlayer(game, side)
	};
}
