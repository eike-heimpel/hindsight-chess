# Hindsight

**[hindsight-chess.vercel.app](https://hindsight-chess.vercel.app)**

The screen you open _after_ a chess game to see how you actually played — judged
against a better version of you, not against a 3500-rated engine.

Hindsight pulls your real games from chess.com or Lichess, runs Stockfish over
every move to produce win-probability deltas and chess.com-style move
classifications, and then — on demand — explains a move in plain English and
coaches you through it in conversation.

Built for beginners and improvers (~500–900), where "the engine says -2.3" is
useless feedback and "you stopped watching that bishop" is the thing that
actually transfers to the next game.

## The interesting problem: an LLM that cannot lie about the board

Language models are fluent about chess and confidently wrong about specific
positions. They hallucinate pieces, invent moves, and mix up who is winning —
which is fatal for a teaching tool, because a beginner cannot tell the
difference.

Hindsight separates the three roles so no single component is trusted with
something it is bad at:

| Role         | Component                                    | Responsibility                                                                                                  |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Oracle**   | Stockfish                                    | All evaluation. Every number shown comes from the engine, never the LLM.                                        |
| **Verifier** | chess.js (`explainGate.ts`, coach `gate.ts`) | Deterministic gate. Extracts board claims from the model's output and rejects any the rules engine can't prove. |
| **Tutor**    | LLM (via OpenRouter)                         | Language only. Explains and asks questions — never grades, never invents a line.                                |

The LLM receives a pre-built `FACTS` block (what moved, what hangs, what the
engine prefers) and is constrained to talk _about_ those facts. The gate is the
guarantee: the app never states a board claim it can't back with chess.js.

The reasoning behind this — and why improvement comes from _thinking_, not from
memorising engine moves — is in [`docs/learning-model.md`](docs/learning-model.md).

## Engineering notes

A few decisions a reviewer might find worth a look:

- **Analysis runs in the browser.** Stockfish WASM in a Web Worker means
  unlimited free compute at any depth, and no serverless timeout. The tradeoff
  is trust, handled explicitly below.
- **The trust seam.** Because the client does the analysis, API routes that
  write the shared caches never trust the request body: they re-derive from the
  server's own stored game, validate `fenBefore`/`playedUci` against the stored
  move, and resolve the viewer's colour server-side. Shared base in
  `review/explainRequest.ts`; see the "Going public" section of
  [`CLAUDE.md`](CLAUDE.md) for what is still trusted and why.
- **Caches are global, keyed by `{source, gameId, ply, perspective}`.** Engine
  and LLM cost dedupes across users, while `perspective` keeps "you played
  Nxd5" and "White played Nxd5" from ever colliding.
- **Svelte 5 runes, with orchestration extracted.** Async page logic lives in
  `.svelte.ts` rune modules with injected dependencies
  (`client/reviewSession.svelte.ts`, `client/coachThread.svelte.ts`,
  `client/recapQueue.svelte.ts`) — testable without mounting a component.
- **Boundaries return `Result`, domain code throws.** No `try/catch` that
  swallows; expected failures are typed, unexpected ones surface.

Architecture and module reference: [`docs/review.md`](docs/review.md).
Docs map: [`docs/CLAUDE.md`](docs/CLAUDE.md).

## Stack

SvelteKit · Svelte 5 (runes) · TypeScript · Tailwind v4 · chess.js ·
Stockfish (WASM in-browser / npm in Node) · MongoDB · Better Auth (magic link,
Postmark) · OpenRouter · Vitest (browser mode via Playwright) · Playwright E2E ·
deployed on Vercel

## Running it

```bash
npm install          # also syncs the Stockfish WASM into static/
cp .env.example .env # fill in MONGODB_URI at minimum
npm run dev
```

Without an `OPENROUTER_API_KEY` the app uses a deterministic stub explainer
(`useRealCoach` in `server/env.ts`), so the flow is explorable without LLM
spend. Mongo is required for game import, history, and the caches.

```bash
npm run check        # svelte-check
npm run lint         # prettier + eslint
npm run test:unit    # vitest
npm run calibrate:review -- <chesscom-user> [sampleSize]   # accuracy vs chess.com
```

## Status

Working software, pre-launch. Auth, game import, full-game analysis, the grounded
move explainer, and the multi-turn coach are all live; per-user move-state
persistence (marks, notes, snapshots) is built. Not yet hardened for public
traffic — rate limiting and a per-user LLM budget are the known gaps, tracked in
[`CLAUDE.md`](CLAUDE.md).

Development was AI-assisted (Claude Code), which the commit history reflects
openly.
