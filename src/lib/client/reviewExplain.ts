import { isCheckmate, isStalemate } from '$lib/chess/rules';
import type { EngineLine } from '$lib/engine/engine';
import type { ReviewExplainRequest } from '$lib/review/explain';
import type { ReviewGame } from '$lib/review/types';
import { type Result, ok, err } from '$lib/result';
import { safeEvaluate } from './engine';

/**
 * Browser-side gathering for the on-demand move explainer. Two focused engine
 * passes — the top-N lines from the position *before* the move, and the
 * engine's single best reply to the move actually played — then POST the lines
 * to `/api/review/explain`, which re-derives the chess.js facts canonically and
 * calls the LLM. We use `movetime` (not a fixed depth) here: the explanation
 * prose is cached as text, so reproducibility doesn't matter and bounded
 * latency does.
 */
export const EXPLAIN_MULTIPV = 3;
export const EXPLAIN_MOVETIME_MS = 3500;

export async function explainMove(
	game: ReviewGame,
	ply: number,
	onProgress?: (done: number, total: number) => void
): Promise<Result<{ text: string }>> {
	const move = game.moves[ply - 1];
	if (!move) return err('engine_failed', `no move at ply ${ply}`);

	onProgress?.(0, 2);
	const before = await safeEvaluate(move.fenBefore, {
		movetimeMs: EXPLAIN_MOVETIME_MS,
		multiPv: EXPLAIN_MULTIPV
	});
	if (!before.ok) return err(before.error.kind, before.error.message);
	onProgress?.(1, 2);

	const bestLines: EngineLine[] =
		before.value.lines && before.value.lines.length > 0
			? before.value.lines
			: [{ cp: before.value.cp, pv: before.value.pv ?? [], moveUci: before.value.bestMoveUci }];

	// The reply line only exists if the move didn't end the game.
	let replyLine: EngineLine | null = null;
	if (!isCheckmate(move.fenAfter) && !isStalemate(move.fenAfter)) {
		const after = await safeEvaluate(move.fenAfter, { movetimeMs: EXPLAIN_MOVETIME_MS });
		if (!after.ok) return err(after.error.kind, after.error.message);
		replyLine = { cp: after.value.cp, pv: after.value.pv ?? [], moveUci: after.value.bestMoveUci };
	}
	onProgress?.(2, 2);

	const body: ReviewExplainRequest = {
		source: game.source,
		gameId: game.gameId,
		ply,
		fenBefore: move.fenBefore,
		playedUci: move.uci,
		bestLines,
		replyLine
	};

	let res: Response;
	try {
		res = await fetch('/api/review/explain', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch (e) {
		return err('coach_network', e instanceof Error ? e.message : String(e));
	}
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		return err('coach_http', `explain ${res.status}: ${detail.slice(0, 200)}`);
	}
	const data = (await res.json()) as { text: string };
	return ok({ text: data.text });
}
