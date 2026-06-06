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
  `src/lib/server/{db,env}.ts`.
- **App shell:** `/` is the home (post-game dashboard); `/login` is magic-link
  sign-in. Auth infra is `src/lib/server/{auth,betterAuth,email}.ts`.
- **Identity seam:** `src/lib/server/auth.ts` is the single place a request's
  user is resolved (`getUser` / `requireUser` → `User { userId, reviewAccounts }`).
  Better Auth resolves the session in `hooks.server.ts` and populates
  `locals.user`; the seam maps that to the app `User`, and `reviewAccounts.ts` is
  the storage detail behind the linked chess.com usernames. Everything keys on
  `userId`; call sites never touch the auth storage shape.
- **The review feature:** everything under `src/lib/review/`, the review files
  in `src/lib/{server,client}/review*.ts`, and `src/routes/review` +
  `src/routes/api/review`.

## Going public — open decisions

Resolve before exposing this to strangers:

1. **Trust model.** Analysis runs in the browser, so routes that write the
   global game-keyed caches must re-derive from server-stored games rather than
   trust the POST body — the browser sends only engine numbers. `analyze` and
   `coach/discuss` already follow this pattern; the remaining gap is `explain`,
   which still trusts what's POSTed. The work is making _all_ such routes
   re-derive. Note: the game-keyed caches (`reviewGames`, `reviewAnalysis`,
   `reviewExplanations`) are deliberately global so engine/LLM cost dedupes
   across users — the fix is trusting _writes_, not per-user copies.
2. **Auth — wired.** Better Auth with magic-link email (Postmark) is live;
   `auth.ts` maps the session to `User`, and multi-user works. Still open for
   strangers: sign-in rate-limiting / abuse, and whether sign-up is open or
   invite-gated.
3. **LLM cost.** Every "Explain this move" is an OpenRouter call. Caching by
   `{source,gameId,ply}` helps, but public traffic needs rate limiting / a per-
   user budget.
4. **chess.com ToS / rate limits** at multi-user scale.

## Open cleanup items

- **Env / DB.** Set `MONGODB_URI` / `MONGODB_DB_NAME`, the OpenRouter key, and the Better Auth +
  Postmark vars (see `.env.example`). No seeding — Better Auth creates users on
  first sign-in.
- `docs/review.md` still reads as a feature doc of a larger app — folds into a
  doc reframe.

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
  throws. No fallback logic that hides errors. A `try/catch` that swallows is a
  smell: rely on the `Result` for _expected_ failures and let _unexpected_ ones
  surface (see `api/review/sync`).
- No abstractions/layers without a concrete need; no backwards-compat shims.
- Comments explain _why_, not _what_.

### Svelte 5

- `$effect` is for side effects (DOM, network, storage) — **never** to copy
  `data`/props into local `$state`. Reset-on-navigation belongs in `{#key}` (or
  a fresh mount); a state change in response to another state change belongs in
  the **event handler** that caused it, not an effect (`RecencyFilter.onChange`
  is the pattern). An effect that reads a value only to re-derive another is a
  `$derived`.
- A one-shot, non-reactive browser action (localStorage read, clock) is
  `onMount`, not a dependency-less `$effect`.
- Events are callback props (`onClick`, `onChange`) — no `createEventDispatcher`.
  Slots are `{#snippet}`/`{@render}`.
- A route component over ~250 lines doing async orchestration extracts that into
  a `.svelte.ts` rune module — `recapQueue.svelte.ts` (the home reveal queue,
  with an injected `RecapEngine`) and `exploreLine.svelte.ts` (the review board's
  "play it out from here" branch, with an injected `evaluate`) are the pattern to
  follow. The `review/[source]/[gameId]/+page.svelte` route still owns its
  analyze/explain orchestration inline — the remaining extraction candidate.

### Trust + mobile

- API routes that write the **global** game-keyed caches (`reviewGames`,
  `reviewAnalysis`, `reviewExplanations`) must re-derive from server-stored data,
  not trust the POST body. The browser sends only engine numbers (evals/lines);
  the server re-runs the pure builder against its own stored game. `analyze` and
  `explain` are the references.
- Mobile-first: base styles target small screens, `sm:`/`md:`/`lg:` scale up.
  Use `min-h-dvh`, never `min-h-screen`/`100vh`. Interactive elements clear ~44px
  at `@media (pointer: coarse)`. Honour `env(safe-area-inset-*)`.
