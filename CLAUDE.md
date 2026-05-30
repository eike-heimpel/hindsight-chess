# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A standalone post-game chess review app — adult-facing, English UI. Pull real
games (chess.com), run Stockfish over every move (win% + chess.com-style
classification + accuracy), and on demand ask an LLM to explain a move, grounded
in the engine's lines + chess.js facts. None of the "kid pedagogy" rules apply
here (accuracy %, classifications, stats are all wanted).

The full design + module reference is [`docs/review.md`](docs/review.md) — read
it first for anything non-trivial. Code wins on any conflict with the doc.

## Provenance — extracted from a private kid trainer

This was carved out of a private SvelteKit chess trainer where it lived as the
`/review` feature, deliberately built "separable, not separated." Extraction was
a mechanical folder move plus vendored copies of shared primitives:

- **Vendored from the kid app (shared, keep in sync mentally):** `src/lib/chess/`
  (chess.js wrapper), `src/lib/engine/` + `src/lib/client/engine.ts` (Engine
  interface + Stockfish browser/node impls), `src/lib/components/Board.svelte`,
  `src/lib/result.ts`, `src/lib/llm/openrouterClient.ts`, and the server infra
  `src/lib/server/{db,env,profiles,profileSession}.ts`.
- **The review feature** is everything under `src/lib/review/`, the review files
  in `src/lib/{server,client}/review*.ts`, and `src/routes/review` +
  `src/routes/api/review`.
- `src/lib/server/profiles.ts` still carries dead kid knobs (`openingElo`,
  `ratingMin`, ply limits) and a two-profile seed (child/parent). The opening
  constants were inlined to drop the kid `opening/` dependency. This whole
  profile/auth model is the **first thing to redesign** — see below.

## Going public — the dedicated decisions this extraction unblocks

These were single-user assumptions in the kid app. They must be resolved before
this is exposed to strangers:

1. **Trust model.** Analysis runs in the browser and the server _trusts and
   stores whatever is POSTed_ (`/api/review/analyze`, `/api/review/explain`).
   Fine for one user; a hole for many. Re-derive or sign analysis server-side,
   and scope caches so one user can't poison another's.
2. **Auth / accounts.** Today it's a parent-only profile gate (`profileSession`,
   `requireParentProfile`) over a hard-coded two-profile seed. Public needs real
   signup + per-user account linking + per-user game scoping.
3. **LLM cost.** Every "Explain this move" is an OpenRouter call. Caching by
   `{source,gameId,ply}` helps, but public traffic needs rate limiting / a per-
   user budget.
4. **chess.com ToS / rate limits** at multi-user scale.

## Immediate cleanup (carried-over kid-app cruft)

Small, do-before-public items — distinct from the design decisions above:

- **Scrub the hardcoded real account.** `profiles.ts` hardcodes the chess.com
  username `timbolt123` (the `papa` seed + a leftover one-time migration `$set`).
  It's a real person's account and it's already in git history — remove it and
  the migration block; the account should be linked at runtime, not seeded.
- **Drop the `child` seed.** `ensureSeed()` seeds `lia` (child) + `papa`
  (parent); a review-only app has no child. Collapse to whatever the redesigned
  auth (above) needs.
- **Env / DB.** Only `.env.example` came over — set `MONGO_*` + the OpenRouter
  key. A fresh DB self-seeds (`ensureSeed` runs lazily), so the app boots clean.
  Pointing at the kid app's existing DB also works (reuses already-analyzed
  games) but shares collections — fine for dev, give it its own DB for public.
- **Deploy adapter.** `adapter-auto` can't detect a target on plain build; set
  the real adapter (e.g. `@sveltejs/adapter-vercel`) when wiring deploy.
- `docs/review.md` still reads as a _feature doc_ of the parent app ("separate
  room", "Papa profile"). Reframe to a standalone-app doc when convenient.

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
