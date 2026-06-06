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

**The _why_ behind review + coach is [`docs/learning-model.md`](docs/learning-model.md)
— read it before changing how explanations, the coach, or persistence behave.** In
short: improvement = thinking + pattern recognition, not move recall; the
explanation is the _reveal_ step and the coach is the _predict→reconcile→abstract_
loop, two steps of one conversation primitive. Stockfish is the oracle, chess.js
(`explainGate.ts` / coach `gate.ts`) is the verifier that guarantees we never state
a board claim it can't prove, and the LLM is the tutor — it never grades or invents.

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
  `src/routes/api/review`. `/review/[source]/[gameId]` is the **single learning
  surface**: board + engine verdicts, the move's "what happened" explanation, and
  the per-move coach conversation (`coachThread.svelte.ts` + `CoachPanel`, voice-
  first variant 'B') all live on it — there is no separate coach route. Opening a
  conversation passes through the `coachEntitlement.ts` seam (allow-all today; the
  one place a premium gate lands). Variant 'A' (`CoachConversation.svelte`) is kept
  dormant for a future style toggle. `coach/discuss` is an API path, not a route.

## Going public — open decisions

Resolve before exposing this to strangers:

1. **Trust model.** Analysis runs in the browser, so routes that write the
   global game-keyed caches re-derive from server-stored games rather than trust
   the POST body — `analyze`, `explain`, and `coach/discuss` all validate
   `fenBefore`/`playedUci` against their stored move, derive the viewer's side
   from their linked accounts (`ownedSide`, never a body field), and rebuild the
   facts server-side (shared request base in `explainRequest.ts`). What's still
   trusted is the _engine numbers_ themselves (evals/lines): a client can still
   POST misleading evals for the real move, so closing the hole fully means re-
   running or signing the engine server-side. Note: the game-keyed caches
   (`reviewGames`, `reviewAnalysis`, `reviewExplanations`) stay global so
   engine/LLM cost dedupes across users — the fix is trusting _writes_, not per-
   user copies. `reviewExplanations` additionally keys on the viewer's
   _perspective_ (their colour): the same move reads "you played Nxd5" to the
   mover and "White played Nxd5" to the opponent, so the two never share an entry
   (still global — cost dedupes across the game's two players).
2. **Auth — wired.** Better Auth with magic-link email (Postmark) is live;
   `auth.ts` maps the session to `User`, and multi-user works. Still open for
   strangers: sign-in rate-limiting / abuse, and whether sign-up is open or
   invite-gated.
3. **LLM cost.** Every "Explain this move" is an OpenRouter call. Caching by
   `{source,gameId,ply,perspective}` helps, but public traffic needs rate
   limiting / a per-user budget.
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
- **Pre-production — no users, no data to preserve.** Build the thing it should
  be: refactor freely, rename, change schemas in place, delete superseded code
  and routes. NEVER add backwards-compatibility shims, migrations, deprecation
  paths, or dual-read/dual-write fallbacks. If an old shape is wrong, replace it.
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
  a `.svelte.ts` rune module — `recapQueue.svelte.ts` (the home reveal queue, with
  an injected `RecapEngine`), `exploreLine.svelte.ts` (the review board's "play it
  out from here" branch, with an injected `evaluate`), `coachThread.svelte.ts` (the
  per-move coach conversation, with injected `discuss`/`evaluate`), and
  `reviewSession.svelte.ts` (the review page's analyze/explain orchestration) are
  the pattern to follow.

### Trust + mobile

- API routes that write the **global** game-keyed caches (`reviewGames`,
  `reviewAnalysis`, `reviewExplanations`) must re-derive from server-stored data,
  not trust the POST body. The browser sends only engine numbers (evals/lines);
  the server re-runs the pure builder against its own stored game, validating
  `fenBefore`/`playedUci` against the stored move first (shared request base in
  `explainRequest.ts`). `analyze`, `explain`, and `coach/discuss` are the references.
- Mobile-first: base styles target small screens, `sm:`/`md:`/`lg:` scale up.
  Use `min-h-dvh`, never `min-h-screen`/`100vh`. Interactive elements clear ~44px
  at `@media (pointer: coarse)`. Honour `env(safe-area-inset-*)`.

## Documentation

Docs live in `docs/`; [`docs/CLAUDE.md`](docs/CLAUDE.md) is the map. Conventions:

- **Code wins.** On any conflict between a doc and the code, the code is right —
  fix the doc.
- **Reference, don't duplicate** — link between docs (`see docs/persistence.md`),
  don't repeat content.
- **Reference code, don't embed** — point to a file path + symbol name
  (`buildTurningPointFacts` in `coach/facts.ts`), never paste source. An
  illustrative shape (a type sketch, an ASCII diagram) is fine; a copy of a real
  definition drifts.
- **No line numbers** — `foo.ts:42` rots on the next edit; name the
  function/type/constant instead, it's greppable and stable.
- **No hardcoded values that live in code** — don't write "a slip is ≥8 win%"
  when it's `PLAYER_MISTAKE_DELTA`; reference the symbol.
- **No runtime metrics** — nothing that goes stale ("197 tests", "two accounts").
- **Single-topic files** — one concern per doc; a new concern is a new file plus
  a line in `docs/CLAUDE.md`, not a section bolted onto an unrelated doc.
- **Domain terms in one place** — define them in [`docs/glossary.md`](docs/glossary.md)
  and link, rather than redefining inline.
