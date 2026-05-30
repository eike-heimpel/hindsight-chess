# chess-review

Post-game chess review: pull your real games (chess.com), run Stockfish over
every move (accuracy + chess.com-style move classification), and — on demand —
ask an LLM to explain a move in plain English, grounded in what the engine
actually sees.

The full design and module reference lives in [`docs/review.md`](docs/review.md).

## Stack

- SvelteKit + Svelte 5 (runes), Tailwind v4
- chess.js for rules; Stockfish (WASM in browser via Web Worker; npm `stockfish` in Node)
- OpenRouter for the on-demand move explainer
- MongoDB for games, analysis and explanation caches

## Commands

```bash
npm install              # also syncs the Stockfish WASM into static/
npm run dev              # vite dev server
npm run build            # production build
npm run check            # svelte-check
npm run lint             # prettier + eslint
npm run test:unit        # vitest
npm run calibrate:review -- <chesscom-user> [sampleSize]   # accuracy calibration vs chess.com
```

Set the environment from `.env.example` (MongoDB URI + OpenRouter key).
