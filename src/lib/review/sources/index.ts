/**
 * Adapter registry — maps a `ReviewSource` to its `GameSource` implementation.
 * The one place that knows which platforms can be imported; callers stay
 * platform-blind. Fails fast for a source with no adapter (e.g. `upload`).
 */
import type { GameSource } from '../source';
import type { ReviewSource } from '../types';
import { ChessComSource } from './chesscom';
import { LichessSource } from './lichess';

const adapters: Partial<Record<ReviewSource, () => GameSource>> = {
	chesscom: () => new ChessComSource(),
	lichess: () => new LichessSource()
};

export function sourceFor(source: ReviewSource): GameSource {
	const make = adapters[source];
	if (!make) throw new Error(`no game-source adapter for "${source}"`);
	return make();
}

// Re-exported for server callers that already import it from here; the source of
// truth is `types.ts` so browser code can use it without dragging in adapters.
export { IMPORTABLE_SOURCES } from '../types';
