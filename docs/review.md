# Game Review

Adult-facing (Papa profile) post-game review tool. This doubles as the module reference and the design rationale: the architecture/decisions sections explain _why_; concrete values (win-% model, classification thresholds, engine depth, accuracy aggregation) live in code and are referenced by symbol — code wins on any conflict (see the doc conventions in `CLAUDE.md`).

Built scope: ingestion (chess.com) + replay, the analysis spine (per-move win% + classification + accuracy, calibrated against chess.com's own numbers), and the on-demand grounded explainer. Open items are in **Deferred / open** below. Not yet exercised end-to-end against a live Mongo + logged-in parent, and the explainer prompt is untested against the live model.

### Files

| Piece                      | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | State            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Domain types               | `src/lib/review/types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | done             |
| Ingestion seam             | `src/lib/review/source.ts`, `src/lib/review/sources/chesscom.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | done (chess.com) |
| Normalizer                 | `src/lib/review/normalize.ts` (+ `normalize.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | done, tested     |
| Games store                | `src/lib/server/reviewGames.ts` (`upsertGames`, `listRecentGames`, `listStoredGameIds`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | done             |
| List route + account links | `src/routes/review/+page.{server.ts,svelte}` (`?/sync` incremental, `?/syncAll` full back-fill, `?/addAccount`, `?/removeAccount`; defaults to the profile's linked account)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | done             |
| Replay route               | `src/routes/review/[source]/[gameId]/+page.{server.ts,svelte}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | replay done      |
| Home entry link            | `src/routes/+page.svelte`, `T.homeOpenReview` in `src/lib/i18n/de.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | done             |
| Win% / classify / accuracy | `src/lib/review/winPercent.ts`, `classify.ts`, `accuracy.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | done, tested     |
| Analysis core (pure)       | `src/lib/review/analysis.ts` (`buildAnalysis`, types) (+ `analysis.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | done, tested     |
| Browser engine pass        | `src/lib/client/reviewAnalysis.ts` (`analyzeGame`, `REVIEW_DEPTH=16`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | done             |
| Analysis cache + API       | `src/lib/server/reviewAnalysis.ts`, `src/routes/api/review/analyze/+server.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | done             |
| Analysis in replay UI      | `src/routes/review/[source]/[gameId]/+page.svelte`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | done             |
| Engine PV + multiPV        | `src/lib/engine/engine.ts` (`EngineLine`, `pv`/`lines`, `multiPv`), `uci-parse.ts` (`parsePv`/`parseMultipv`/`buildPvAndLines` + `uci-parse.test.ts`), `stockfish-browser.ts`, `stockfish-node.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | done, tested     |
| Explainer core (pure)      | `src/lib/review/explain.ts` (`buildExplainFacts`, `ReviewExplainRequest`/`Facts`), `explainPrompt.ts`, `explainer.ts`, `openrouterExplainer.ts`, `stubExplainer.ts` (+ `explain.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | done, tested     |
| Explain cache + factory    | `src/lib/server/reviewExplanations.ts`, `src/lib/server/review-explainer-factory.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | done             |
| Explain route              | `src/routes/api/review/explain/+server.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | done             |
| Explain client + UI        | `src/lib/client/reviewExplain.ts` (`explainMove`), replay page "Explain this move"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | done             |
| Calibration harness        | `scripts/calibrate-review.ts` (`npm run calibrate:review`), `gameAccuracy()` in `accuracy.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | done             |
| Cross-game stats core      | `src/lib/review/stats/` — `types.ts` (`ReviewStats`, `PerspectiveGame`, `WinnableCandidate`, `TIME_CLASSES`), `perspective.ts` (`toPerspective()`), `compute.ts` (`computeReviewStats()`), `trend.ts` (`windowTrend()`/`recentMean()`), `winnable.ts` (`buildCandidate()`/`classifyWinnable()`), `blunders.ts` (`collectBlunders()`), `robustness.ts` (`longestRunAtOrAbove()`/`sustainedLoss()` — shared "did I hold this, or was it a spike?" math); `src/lib/review/material.ts` (`materialBalance()`/`materialLead()`) (+ `compute.test.ts`, `trend.test.ts`, `winnable.test.ts`, `blunders.test.ts`, `robustness.test.ts`, `material.test.ts`) | done, tested     |
| Stats charts               | `src/lib/review/charts/` — `scale.ts`, `palette.ts` (colour tokens), `LineChart.svelte`, `BarChart.svelte`, `SegmentedBar.svelte` (hand-built, no library)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | done             |
| Stats server + batch       | `listGamesForAccounts()`/`getAnalysesByIds()` stores, `src/lib/client/reviewStats.ts` (`batchAnalyze()`), `GET /api/review/game/[source]/[gameId]`, `/review/stats/+page.{server,svelte}`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | done             |
| Blunder trainer            | `src/lib/review/stats/blunders.ts` (`collectBlunders()`) (+ `blunders.test.ts`), `src/routes/review/blunders/+page.{server,svelte}` (board-centric drill; reuses `Board`, `uciSquares()`, `explainMove()`, cached-explanation seeding)                                                                                                                                                                                                                                                                                                                                                                                                              | done, tested     |

### Replay UI — as built (task #9, done)

`src/routes/review/[source]/[gameId]/+page.svelte` now consumes `data.analysis`
(seeded from the cached server load) and computes it on demand in-browser:

- **Analyze button** when no analysis yet → `analyzeGame(game, onProgress)`
  (`src/lib/client/reviewAnalysis.ts`) with a progress bar; on `ok` it sets local
  analysis state **and** POSTs to `/api/review/analyze` to cache (a non-fatal
  note if the cache write fails); on `err` it shows the message.
- **Eval bar** beside the board, white-POV win% synced to the current ply (ply 0
  = `moves[0].winBefore`; ply p = that move's `winAfter` flipped for black).
- **Per-move classification dots** in the move list, looked up by `ply`
  (emerald/stone/amber/orange/rose for best/good/inaccuracy/mistake/blunder).
- **Per-side accuracy** badge next to each player name.
- **Engine best-move arrow** for the shown position via `Board`'s `opponentArrow`
  prop + `uciSquares()`.

### Grounded explainer — as built (slice 3)

On-demand "Explain this move" on the replay page, per move. Adult-facing English
prose (no kid-voice rules), hard-grounded in engine lines + chess.js facts.

- **Engine plumbing.** `EngineEval` gained optional `pv` and `lines: EngineLine[]`;
  `EvaluateOptions` gained `multiPv`. Both Stockfish impls capture the last
  scored `info` line per `multipv` index and reset `MultiPV` to 1 every call
  (sticky, like `UCI_LimitStrength`). Parsing + line assembly is shared in
  `uci-parse.ts` (`parsePv`, `parseMultipv`, `buildPvAndLines`).
- **Browser-computed, server-trusted** (same posture as analysis). On click,
  `explainMove()` (`src/lib/client/reviewExplain.ts`) runs two `movetime` evals —
  top-3 lines from `fenBefore`, and the engine's single best reply to the move
  played (skipped if the move ended the game) — and POSTs the lines.
- **Server re-derives the chess.js facts canonically.** `POST /api/review/explain`
  ignores any client-side interpretation: it rebuilds `ReviewExplainFacts` from
  `fenBefore` + `playedUci` via `buildExplainFacts()` (SAN-ifies each PV, derives
  the played move's piece/capture/attackers/defenders, mover-POV evals, win% and
  classification), then calls the explainer. Hard-grounded prompt in
  `explainPrompt.ts`, **coached for an improving beginner (~500–1000)**: for a
  mistake/blunder it leads with the engine's reply line (the punishment the move
  _allows_) and names the recurring pattern, rather than reciting the engine's
  deep optimal line — so a hung back-rank mate reads as "you allowed Qe1#", not
  "you missed a mate-in-5". The audience level is isolated in `AUDIENCE` for a
  future per-Elo knob.
- **Cached** by `{source, gameId, ply}` in the `reviewExplanations` collection;
  a repeat ask re-serves the text (no LLM call). The replay loader seeds the page
  with `listExplanations()`.
- **`movetime`, not fixed depth** (unlike analysis): the prose is cached as text,
  so reproducibility doesn't matter and bounded latency does. `MoveAnalysis.pv`
  stays unused — the explainer does its own focused eval rather than bloating the
  analysis cache.

### Cross-game stats — as built

`/review/stats` — a parent-only dashboard aggregating a person's games across the
profile's linked accounts. The "second-screen payoff": queries over the two
collections, no new persistence.

**Two axes that shape everything:**

- **Person = a set of accounts.** The aggregation unit is the active `Profile`,
  which already owns `reviewAccounts` (lowercased usernames). Stats fold over
  `listGamesForAccounts()` (`reviewGames.ts`). Decision: keyed to `Profile`, not
  a new "reviewer identity" — it already holds the accounts and the review tool
  stays separable (nothing in the kid app imports the stats layer). _Extension
  path_ when a second platform lands: accounts become `(source, username)` pairs
  and `source` becomes a second axis, shown side-by-side, **never pooled** (a
  different engine/calibration per platform).
- **Segmented by time class, never pooled.** `computeReviewStats()` returns one
  `ReviewStats` per time class (bullet/blitz/rapid/daily), ordered most-played
  first. Pooling accuracy across time classes is meaningless, so the UI is tabbed
  by class rather than offering an "all" total.

**Pure core (`src/lib/review/stats/`).** Same posture as `analysis.ts` — pure,
testable, no engine/Mongo:

- `perspective.ts` — `toPerspective(game, analysis, accounts)` resolves which side
  the person played, the outcome, and their own moves enriched with
  classification / clock / phase / SAN / material lead, plus a my-POV win-%
  `winTimeline`. The single place that reasons about "me"; every stat builds on
  it. Phase is a ply-based heuristic (`PHASE_BOUNDS`, no material count).
- `compute.ts` — `computeReviewStats({ games, analyses, accounts })` folds
  `PerspectiveGame[]` into `ReviewStats` per class. Adding a stat = add a field to
  `ReviewStats` (`types.ts`) and a reducer here. Cheap stats (record, win rate,
  rating trend, openings, color, opponent-strength bands, terminations) cover
  **every** game; analysis-derived stats (accuracy, blunders, move-class mix,
  slips-by-phase, slip-rate-vs-time, winnable-loss candidates) cover **analyzed**
  games only.

**Computed server-side.** Stats are pure over already-stored games + cached
analyses, so the `/review/stats` loader computes them in `+page.server.ts` and
ships only the results (+ a list of un-analyzed game _ids_, not full games).

**Batch analyze (browser).** Coverage is shown up front (`analyzed / total`).
Per the existing constraint, analysis runs in the browser; "Analyze remaining"
drives `batchAnalyze()` (`src/lib/client/reviewStats.ts`), which fetches each
pending game via `GET /api/review/game/[source]/[gameId]`, runs the same
`analyzeGame()` pass the replay page uses, POSTs to the analysis cache, then
`invalidateAll()` recomputes the stats. Sequential (one Web Worker); a single
game failing is reported, not hidden.

**Charts are hand-built (`src/lib/review/charts/`), no library.** `LineChart`
(SVG sparkline — smoothed path + gradient fill, no axes; just min/max endpoint
labels, with a pointer/tap tooltip) for trends; pass `smoothWindow` to foreground
a centered moving-average of a noisy per-game series and draw the raw points
faintly behind it. `BarChart` (optional `baseline` reference + `tone='scale'`
that colours win-rate bars by value) and `SegmentedBar` (pure HTML/CSS) for
distributions and part-of-whole breakdowns. `scale.ts` holds the shared `linear`
/ `ticks` / `polyline` / `smoothPath` / `movingAverage` helpers; `palette.ts`
holds the one deliberate colour system (good=emerald, bad=rose, neutral=indigo/
stone, plus a monotonic move-quality ramp) so charts read as a designed set.
Kept under `review/` so extraction stays a folder move.

**"Am I improving?" trend cards answer _trend_, not endpoints.** The badge is a
windowed comparison — recent third vs first third (`windowTrend()` in
`stats/trend.ts`), so a single flukey first/last game can't flip the direction;
it's hidden below ~6 games. The headline is per-stat: rating shows its exact
most-recent value (it's already a smoothed Glicko number), while accuracy and
blunders/game — noisy per-game samples — show a recent-form average
(`recentMean()`) and a smoothed sparkline, since one game is mostly noise.

**Page layout.** One server load (all stats per time class), then a purely
client-side two-axis nav: a segmented control picks the **time class** (primary)
and a tab bar swaps the **view** — Overview (win-rate hero + "am I improving?"
trend cards), Mistakes (move-quality mix, slips by phase, slip-rate vs time, +a
teaser into the winnable-losses deep dive), Matchups (by colour, opponent
strength, openings, terminations). The base views need no extra routes; the
winnable-losses dive is its own page (below).

**Winnable losses (`/review/stats/winnable`).** A dedicated deep dive into "I was
winning and lost — was it a real chance I blew, or engine-vision I never had?"
The discriminator is **robustness, not material** (adult tool — material-counting
would be a beginner crutch): a mate-in-12 / deep-tactic spike is winning for one
ply at the tip of a forced line and you never held it; a real winnable position
stays winning across several of your own moves. So a loss qualifies only when
your win-% was ≥ a `floor` for a _sustained run_ of your own moves and you then
conceded it (`classifyWinnable()` in `winnable.ts`). The "give-back" is your
biggest win-% drop in that winning zone; its classification tiers a coachable
own-blunder (**thrown**) from getting out-resourced (**outplayed**). The page is
**lever-driven and reactive**: `compute.ts` ships raw `WinnableCandidate`s (any
non-won analyzed game that ever reached `CANDIDATE_FLOOR`, with my-moves +
timeline), and the page re-tiers client-side as you move three controls — winning
floor (70/80/90%), held-for (2/3/4 moves), and an optional material edge (off by
default; `material.ts` is a context badge, never the gate). Each card draws the
my-POV win-% sparkline with the floor as a threshold line and the give-back move
marked, a one-line narrative, and an on-demand **"Explain what went wrong"** that
reuses the grounded move explainer (`explainMove()`) on the give-back ply (cached
by `{source, gameId, ply}` — no new LLM plumbing). The headline shows how many
candidates were dropped as spikes, so the lever's effect on the cut is visible.

**Blunder trainer (`/review/blunders`).** A board-centric drill over **every** one
of your own blunders, across all stored + analyzed games, in one flat queue,
ordered by **`sustainedLoss`** — how far below your _previously-held_ win-% the
move left you, not the raw win-% drop. That down-ranks engine spikes (a deep
forced line that appeared on the opponent's move and that you merely failed to
find scores ~0 here), so the queue leads with blunders you could realistically
have avoided. The held-vs-spike reasoning is shared with the winnable dive via
`robustness.ts` (`longestRunAtOrAbove()` for the winnable sustain gate,
`sustainedLoss()` for the trainer order). `collectBlunders()` in `blunders.ts`
joins, per blunder, the raw game move (for the FENs, which aren't on
`PerspectiveMove`), the `MoveAnalysis` (best move + my-POV win-% swing), and
game-level context into a `BlunderEntry`; it reuses `sideFor()` / `phaseOf()` from
`perspective.ts` rather than re-deriving "me". One blunder shows at a time on a
read-only `Board` at the **decision position** (`fenBefore`): the move you played
is the highlight, the engine's better move is the arrow, oriented to your side.
`Prev`/`Next` (and `←`/`→`) step across game boundaries; **Open in full replay**
deep-links `/review/{source}/{gameId}?orient&ply` into the refutation line. Unlike
the stats dashboard's never-pool rule (about _accuracy_ being apples-to-oranges
across time classes), time classes are **pooled by default** here — a blunder is a
blunder and the trainer wants volume + continuity; a filter narrows the queue.
**Explain** reuses the grounded move explainer (`explainMove()`, cached by
`{source, gameId, ply}` — no new LLM plumbing); the loader seeds already-cached
prose via `listExplanations()` (one call per game with blunders), so a revisit is
instant, while a first-time explain runs the on-demand browser engine pass.

### Calibration harness

`scripts/calibrate-review.ts` (`npm run calibrate:review -- <user> [sampleSize]`)
fetches a sample of an account's **reviewed** chess.com games (only those carry
chess.com's own `accuracies` — fetched straight from the month JSON, not via
`RawGame`), runs `StockfishNodeEngine` at `REVIEW_DEPTH`, and prints per-side
accuracy vs chess.com plus mean abs / signed error and our move-class
distribution. No Mongo.

**What it found and fixed.** A plain mean over per-move accuracies ran
systematically high vs chess.com. The cause was **not** `CLASS_THRESHOLDS` —
accuracy never touches them; chess.com's public API gives per-game accuracies but
no per-move classes, so the thresholds can't be fit against it (the printed class
distribution is for eyeballing only). The bias was the aggregation, so
`gameAccuracy()` (`accuracy.ts`) now ports lichess' `AccuracyPercent.gameAccuracy`:
per-move accuracy with the uncertainty bonus, then the mean of a volatility-weighted
mean and the harmonic mean of the move accuracies. A small residual offset remains
and is **not** chased further — we approximate chess.com's CAPS2 with the lichess
model and a shallower lite-WASM engine, so a small offset (not exact agreement) is
the realistic floor.

### Decisions already made (don't re-litigate without reason)

- `ReviewGame.rated` is optional, set only from the source (PGN can't express
  it). `timeClass` is **derived** from the time control (base + 40·inc), not
  taken from the source — uniform across platforms.
- Analysis runs in the **browser** (Vercel can't do 40+ evals < 10s) and is
  POSTed to the server, which trusts and stores it. Fine for a single-user
  parent tool; revisit if it ever goes multi-user.
- Engine depth fixed at `REVIEW_DEPTH` (`src/lib/client/reviewAnalysis.ts`) so cached analyses are reproducible.
- `CLASS_THRESHOLDS` (`classify.ts`) are uncalibrated starting values — see the calibration note above on why chess.com's API can't fit them.
- All `/review` routes are parent-only + `useMongo()`-gated (503 without Mongo),
  mirroring `/train/auswahl`. The feature has **no no-DB fallback** — it needs
  Mongo.
- English UI throughout `/review`; the only German is the home-page link label
  `T.homeOpenReview` ('Partie-Analyse').

### Pre-existing repo issue (flagged, not from this work)

`npm run lint` (`eslint .`) errors on the committed, non-gitignored minified
`static/stockfish/stockfish-18-lite-single.js` — independent of the review
feature. Fix is to add `static/stockfish/**` to the eslint ignores; left as a
separate call.

## What this is

An adult-facing post-game review tool: pull your real games (chess.com first),
run our own Stockfish over them, classify each move (chess.com-style, win-%
based), and — **on demand** — ask an LLM to explain a move in plain English,
grounded in what the engine actually sees. Built to grow into a "second-screen"
companion with personal history + stats.

This is **for the developer (Papa profile), not the kid.** None of the kid
pedagogy rules (no scores, intrinsic-only) apply here — accuracy %, move
classifications and stats are all wanted.

### Non-goals (for now)

- Not in the kid's learning section. Separate room.
- No stats/history screens yet — but we **persist the data** so they're later
  just queries.
- No `Brilliant / Great / Miss / Book` classes yet (need sacrifice / only-move /
  theory detection). Five buckets only.
- No live-game / board-editor analysis. Review of _finished_ games only.

## Product stance: separable, not separated

We want to be able to rip this out into a standalone product later **without
paying for that option now**. The cheap way to buy it:

- All code under `src/lib/review/` and routes under `/review`.
- **One-way dependency:** `review` may import shared primitives (`Engine`,
  `src/lib/chess/rules.ts`, `Result`); **nothing in the kid app imports from
  `review`.**
- Own Mongo collections (`reviewGames`, `reviewAnalysis`), own English strings
  file. No entry in `src/lib/i18n/de.ts`.

Extraction later = move a folder + its routes + collections into a fresh
SvelteKit app. We do **not** build packages, plugin systems, or a second deploy
now. (That would be the overengineering we're avoiding.)

## Language

English UI. (The kid app's German-only hard rule is scoped to _her_ product.)
If we later want a kid-friendly translation, that's an additive concern.

---

## Architecture / pieces

```
username / PGN
      │
      ▼
┌──────────────┐   PGN    ┌──────────────┐  ReviewGame  ┌──────────────┐
│  GameSource  │ ───────▶ │  normalize() │ ───────────▶ │  reviewGames │  (Mongo)
│  (adapters)  │          │  (chess.js)  │              │  collection  │
└──────────────┘          └──────────────┘              └──────────────┘
                                                                │
                                  on demand                     ▼
┌──────────────┐  per-ply cp   ┌──────────────┐  analysis  ┌──────────────┐
│   Engine     │ ◀──────────── │   analyze()  │ ─────────▶ │ reviewAnalysis│ (Mongo)
│  (Stockfish) │ ──────────────▶  win% + class │            │  collection   │
└──────────────┘               └──────────────┘            └──────────────┘
                                                                │
                          click "explain this move"             ▼
                                              ┌──────────────────────────┐
                                              │  explainer (LLM, grounded │
                                              │  in engine PV + facts)    │
                                              └──────────────────────────┘
```

### 1. GameSource (ingestion)

A small seam so the rest of the app is platform-blind. The `GameSource` interface
and `RawGame` shape (`src/lib/review/source.ts`) carry only raw PGN + minimal
metadata; `ReviewSource` (`types.ts`) is the platform tag. Everything downstream
speaks `ReviewGame`. `ChessComSource` (`sources/chesscom.ts`) is the one built
adapter; `listGames(account, opts)` walks chess.com newest-first.

Build order: **chesscom adapter now**, `upload` (paste PGN — trivial once the
normalizer exists), `lichess` later (bonus: it can hand us precomputed evals so
we skip the engine pass for those games).

**chess.com adapter facts (validated against `Timbolt123`):**

- Public API, no auth. Lowercase the username.
- `GET /pub/player/{user}/games/archives` → list of monthly archive URLs.
- `GET /pub/player/{user}/games/{YYYY}/{MM}` → `{ games: [...] }`, each with
  `pgn`, `url`, `time_class`, `time_control`, `rated`, `eco` (opening URL),
  `end_time`, `white/black {username, rating, result}`, and `accuracies`
  (chess.com's own numbers, present when the game was reviewed).
- Send a descriptive `User-Agent`.
- PGN embeds `{[%clk h:mm:ss.s]}` per move (→ per-move time). **No engine evals**
  in the PGN — we compute our own.

### 2. normalize() — PGN → ReviewGame

`normalize(raw)` (`src/lib/review/normalize.ts`) parses PGN incl. `%clk` comments
with chess.js and walks the mainline to capture `fenBefore`/`fenAfter` and SAN/UCI
per ply. Output shapes — `ReviewGame`, `ReviewMove`, `PlayerRef`, `GameResult` —
are defined in `src/lib/review/types.ts`. Notable derivations done here: `timeClass`
from the time control (not taken from the source — see decisions), `opening` from
the ECO url slug, `playedAt` from `end_time`.

### 3. Persistence (Mongo)

- `reviewGames` — normalized games. Key `{ source, gameId }` (unique), plus a
  lowercased `accounts` array for "games for this player" lookups
  (`listRecentGames`, `listStoredGameIds`).
- `reviewAnalysis` — analysis results, separate so ingest stays cheap and
  analysis is lazy/on-demand. Key `{ source, gameId }` (+ engine depth, so a
  deeper re-analysis is a distinct doc).

Storing the data is the entire "ready for stats" investment — future
history/stats screens are queries over these two collections.

**Account linking + incremental sync.** A profile owns chess.com accounts via
`Profile.reviewAccounts` (`src/lib/server/profiles.ts` — plain `string[]`, so
the kid-app profiles module never imports from `review/`; Papa seeds with
`timbolt123`). `/review` defaults to the active profile's first linked account
and lists its **stored** games — opening the page does no network call. Sync is
manual (the ↻ on an account chip): `?/sync` passes the account's
`listStoredGameIds()` into `ChessComSource.listGames({ knownGameIds })`, which
walks chess.com newest-first and **stops at the first already-stored game**, so
a repeat sync pulls only the handful of new games (capped at `SYNC_LIMIT` for a
first sync). Because it walks newest-first and stops at a known game, incremental
sync **only reaches games newer than the newest stored one** — it never
back-fills older history. The ⤓ All button (`?/syncAll`) covers that case: it
omits `knownGameIds` and uses `BACKFILL_LIMIT`, walking the full archive and
re-upserting everything (idempotent). `?/addAccount` / `?/removeAccount` edit the
link on the profile.

### 4. analyze() — engine pass

For an N-move game we evaluate each **position once** (N+1 evals), not twice:
the eval of the position _after_ move `i` is the eval _before_ move `i+1`. So:

- `cpBefore(i)` = eval of `fenBefore(i)`, side-to-move POV (= best play available)
- `cpAfter(i)` = `-eval(fenBefore(i+1))` (next position, flipped to mover POV)

Reuses the existing `Engine` interface and the per-position pattern in
`evaluateKidMoves()` (`src/lib/client/openingReplay.ts`). Browser WASM at a
moderate fixed depth, sequential, with a progress indicator; cache the result in
`reviewAnalysis` so a game is only analyzed once. (Whole-history batch analysis
for stats is a later concern.)

`buildAnalysis()` (`src/lib/review/analysis.ts`) is the pure core; output shapes
`MoveAnalysis` (per-ply `cpBefore`/`cpAfter` mover-POV, `winBefore`/`winAfter`,
`delta`, `classification`, best move, optional `pv` for the explainer) and
`GameAnalysis` (the move list + `engineDepth` + per-side `accuracy`) are defined
there. `MoveClass` is in `classify.ts`. We classify **both** sides' moves (same
cost); the UI/stats foreground the account's.

### 5. Win % + classification + accuracy

**Win % from centipawns** — `winPercent(cp)` (`src/lib/review/winPercent.ts`),
the lichess sigmoid, clamped to [0, 100]; mate scores map to 0/100.

**Classification** — `classifyMove({ delta, isBest })` (`src/lib/review/classify.ts`)
on the win-% drop `delta = winBefore − winAfter` (mover POV). Win-% based (not raw
cp) so it behaves in already-winning/losing positions. Bucket boundaries are
`CLASS_THRESHOLDS` in the same file (uncalibrated starting values — see the
calibration note above).

**Accuracy % per game** — `moveAccuracy(winDrop)` is the lichess per-move curve;
`gameAccuracy()` aggregates per side (volatility-weighted + harmonic mean, ported
from lichess — see calibration). Both in `src/lib/review/accuracy.ts`.

**Calibration loop:** chess.com gives us its own `accuracies` per game for
free. We tune accuracy aggregation until our numbers land close to theirs on the
same games — a built-in validation harness, not guesswork. See the calibration
harness section above.

### 6. Grounded explainer (on-demand LLM)

Default review is **deterministic only** — no LLM on render. The LLM is a leaf
action the user triggers on one move ("explain this move" / "why does the engine
play this?"). This is the wedge feature: explain the _alien_ engine move using
what Stockfish actually sees, in plain English.

Mirrors the existing **spotlight** pattern (`pickSpotlight()`,
`classifyAlternative()`, `extractFacts()`, hard-grounded prompt in
`spotlightPrompt.ts`) — generalized from the opening recap to any position. The
LLM is **hard-grounded** in engine + rules facts; it does not free-associate.

Grounding payload:

- FEN + the move in question.
- Engine **top-N lines** with evals and the **principal variation a few plies
  deep** (the "what it sees ahead").
- Derived facts from `rules.ts` (`describeMove()`, `Threat`, board census): what
  the move attacks / pins, resulting threats.
- Eval delta vs. the move actually played.

**Enabling plumbing (built — see the slice-3 as-built notes above):** `EngineEval`
(`src/lib/engine/engine.ts`) gained optional `pv` + `lines: EngineLine[]`, and
`EvaluateOptions` gained `multiPv`; both Stockfish engines parse them (`MockEngine`
just passes through whatever a test registers). Server route `POST
/api/review/explain` re-derives the grounded facts canonically and calls the
explainer (reuses `chatCompletion()` / OpenRouter), cached by `{ source, gameId,
ply }`.

### 7. UI

- `/review` — Papa-only route (redirect child profiles, like `/train/auswahl`).
  Username input + recent-games list (result, opening, ratings, date, our
  accuracy once analyzed).
- Game view — replay on `Board.svelte` (reused) with prev/next, move list with
  classification badges, eval/win-% bar, clocks. "Explain this move" button →
  calls the explainer, shows the grounded text + the engine line (and we can
  reuse `Board.svelte`'s `opponentArrow` overlay to draw the PV's first move).

---

## Build slices (each visible on its own)

**Slice 1 — Ingestion + replay (no engine, no LLM).** GameSource + chess.com
adapter, normalize(), `reviewGames` persistence, `/review` route with username
fetch + game list, replay UI with clocks. Proves the data path end-to-end.

**Slice 2 — Analysis spine.** analyze() engine pass (one eval per position,
cached), win% + 5-bucket classification + accuracy, `reviewAnalysis`
persistence, classification overlay + eval bar in the UI. Calibrate thresholds
against chess.com's `accuracies`.

**Slice 3 — Grounded explainer (done).** Extended `EngineEval` with PV + multiPv
(browser, node, mock). Explainer module + grounded English prompt. `POST
/api/review/explain` plus on-demand "Explain this move" UI. See the slice-3
as-built notes in the status section.

## Deferred / open

- ~~Stats + history screens (the "second-screen" payoff)~~ — **done**, see
  _Cross-game stats — as built_ above.
- lichess GameSource (+ its precomputed evals → skip engine pass).
- PGN upload source.
- `Brilliant / Great / Miss / Book` classes.
- Whole-history batch analysis + caching strategy.
- Win-% formula choice (lichess vs chess.com sigmoid) — settle during calibration.
