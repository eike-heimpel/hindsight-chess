# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A standalone post-game chess review app — adult-facing, English UI. Pull real
games (chess.com), run Stockfish over every move (win% + chess.com-style
classification + accuracy), and on demand ask an LLM to explain a move, grounded
in the engine's lines + chess.js facts.

**Goal & feel — "Hindsight" (internal name).** The home you open _after_ a game
to see how you really played, judged against a better _you_ (not the engine).
Calm & premium on the surface, data-dense in the depth, dark-first; beachhead is
beginners (~500–900). Why & feel live in
[`docs/product-strategy/`](docs/product-strategy/README.md) and
[`docs/design/`](docs/design/CLAUDE.md) — read those before product/UI work.

The full design + module reference is [`docs/review.md`](docs/review.md) — read
it first for anything non-trivial. Code wins on any conflict with the doc.

## Layout

- **Shared primitives:** `src/lib/chess/` (chess.js wrapper), `src/lib/engine/` +
  `src/lib/client/engine.ts` (Engine interface + Stockfish browser/node impls),
  `src/lib/components/Board.svelte`, `src/lib/result.ts`,
  `src/lib/llm/openrouterClient.ts`, and the server infra
  `src/lib/server/{db,env,profiles}.ts`.
- **Identity seam:** `src/lib/server/auth.ts` is the single place a request's
  user is resolved (`getUser` / `requireUser` → `User { userId, reviewAccounts }`).
  Everything keys on `userId`; `profiles.ts` is the storage detail behind it.
  Single-user phase resolves the sole seeded user — **going multi-user means
  reimplementing `resolveUser` only**, not touching call sites or the data model.
- **The review feature:** everything under `src/lib/review/`, the review files
  in `src/lib/{server,client}/review*.ts`, and `src/routes/review` +
  `src/routes/api/review`.

## Going public — open decisions

Resolve before exposing this to strangers:

1. **Trust model.** Analysis runs in the browser and the server _trusts and
   stores whatever is POSTed_ (`/api/review/analyze`, `/api/review/explain`).
   Fine for one user; a hole for many. Re-derive or sign analysis server-side.
   Note: the game-keyed caches (`reviewGames`, `reviewAnalysis`,
   `reviewExplanations`) are deliberately global so engine/LLM cost dedupes
   across users — the fix is trusting _writes_, not per-user copies.
2. **Auth.** `auth.ts` is the seam; pick a provider and reimplement `resolveUser`
   (real signup/session). Library is deliberately deferred — see chat history.
3. **LLM cost.** Every "Explain this move" is an OpenRouter call. Caching by
   `{source,gameId,ply}` helps, but public traffic needs rate limiting / a per-
   user budget.
4. **chess.com ToS / rate limits** at multi-user scale.

## Open cleanup items

- **Env / DB.** Set `MONGO_*` + the OpenRouter key (see `.env.example`). A fresh
  DB self-seeds (`ensureSeed` runs lazily), so the app boots clean.
- `docs/review.md` still reads as a feature doc of a larger app, and `profiles.ts`
  still carries vestigial `name`/`emoji`/`role` fields from the seed-only model.
  Both fold into the auth redesign / doc reframe.

## Stack

SvelteKit + Svelte 5 (runes), Tailwind v4, chess.js, Stockfish (WASM browser /
npm node), OpenRouter for the explainer, MongoDB. Vitest (browser-mode via
Playwright) + Playwright E2E. Deploy target Vercel — the explain/analyze routes
must finish in <10s.

## Commands

```bash
npm run dev / build / check / lint
npm run test:unit
npm run calibrate:review -- <chesscom-user> [sampleSize]
```

## Code bar

- Fail fast — boundaries return `Result` (`src/lib/result.ts`), domain code
  throws. No fallback logic that hides errors.
- No abstractions/layers without a concrete need; no backwards-compat shims.
- Comments explain _why_, not _what_.
