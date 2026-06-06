# Guided-coach spike

A throwaway probe of a guided, dialogue-based game review for beginners. Built
to be deleted or rewired as one unit once we decide where it lands. This doc is
a handoff: what exists, why, and what's assumed. It does not prescribe next steps.

## What it does (observed behaviour)

1. Enter a chess.com username → fetch recent games (server-side).
2. Pick a game → Stockfish runs over every move in the browser → the app picks a
   few "turning points".
3. For each turning point, a short **guided conversation**: the coach sets the
   scene, asks "what were you thinking?" with grounded multiple-choice options,
   responds to the choice against the engine facts, optionally animates a line on
   the board, then wraps up with learnings tagged `tactical` / `principle` /
   `process`.
4. A final summary collects the learnings across all turning points.

## File map

Route (this tree):

- `+page.svelte` — the whole client UX + orchestration (fetch, analyze, select
  turning points, drive the conversation, board playback). State machine:
  `pick → analyzing → discuss → summary`.
- `game/+server.ts` — `GET ?user=&limit=` → recent games, normalized, newest
  first. Server-side because chess.com needs a real User-Agent and blocks browser
  CORS.
- `discuss/+server.ts` — `POST` one conversation turn → `DiscussResponse`.

Logic (isolated lib, also deletable as a unit):

- `src/lib/spike/coach/types.ts` — the contract (`TurningPointFacts`,
  `DiscussRequest`, `DiscussResponse`, `PrincipleSignal`, `Learning`).
- `src/lib/spike/coach/principles.ts` — deterministic beginner-principle
  _candidate_ detectors (development, castling, piece-moved-twice, king-wander,
  early-queen).
- `src/lib/spike/coach/facts.ts` — builds `TurningPointFacts` for one moment.
- `src/lib/spike/coach/prompt.ts` — system + user messages (grounding rules,
  guideline rubric, conversation-flow + JSON-output instructions).
- `src/lib/spike/coach/coach.ts` — the OpenRouter call + JSON parse → `Result`.

One edit outside the spike tree: `getCoachSpikeModel()` in `src/lib/server/env.ts`.

## Reuse (facts)

Reuses, unmodified: the browser engine (`$lib/client/engine`, `analyzeGame` +
`REVIEW_DEPTH` from `$lib/client/reviewAnalysis`), `Board.svelte`, the chess.js
fact derivation (`buildExplainFacts` in `$lib/review/explain`), `chess/rules`,
`winPercent`/`classify`, the OpenRouter client (`$lib/llm/openrouterClient`), and
the design tokens + `charts/palette`.

## Decisions and why (facts)

- **Not coupled to auth or Mongo.** The real review routes (`/api/review/*`) gate
  on `requireUser` and persist to Mongo. This spike does neither — it only needs
  `OPENROUTER_API_KEY`. Reason: keep it runnable/testable in isolation.
- **Turning points run in both directions.** A "moment" is either the player's
  own win-% drop (a mistake) or an opponent move that dropped the opponent's
  win-% (an opportunity, surfaced as the player's reply move with the opponent's
  blunder as `setup`). Reason: a win's instructive moments are often the
  opponent's blunder + the player's punishment, not the player's own slips.
- **The LLM only picks which precomputed line to show** (`show: 'best' |
'punish' | 'none'`); the client owns move legality and the actual frames.
  Reason: the model can't emit illegal UCI this way.
- **Principles are candidates, judged by the LLM.** `principles.ts` flags
  deterministic hints; the prompt also gives the model a full guideline rubric
  (develop / castle / don't-move-twice / early-queen / king-safety / don't-hang)
  and instructs it to treat them as guidelines that the engine facts override,
  to not raise ones the player followed, and on an opportunity to name the
  guideline the opponent broke. Reason: avoid blind box-checking; engine is
  ground truth.
- **Model: `google/gemini-3.5-flash`** (default; override `COACH_SPIKE_MODEL`).
  It mandates reasoning (cannot be disabled), so the call uses
  `reasoning: { effort: 'low' }` + `maxTokens: 3000` to stop the chain-of-thought
  truncating the JSON, and `timeoutMs: 25000`. The main review coach default is a
  different model (`~google/gemini-flash-latest`); this spike's choice was
  requested specifically.
- **Win % must not read as "nothing happened" on a found best move — but we do NOT
  fabricate a human counterfactual.** `winBefore` is the engine's _best move's_
  value: it presumes that move was found, so a move that IS the best shows
  `winBefore ≈ winAfter` ("76% → 76%") and reads as if it achieved nothing. Two
  things are honest here and one is not. Honest: (a) the player _found the best
  move_ — credit the find itself, not a delta; (b) the spread to the 2nd-best line
  (`winSecondBest`) gauges how **sharp the POSITION** was — did most alternatives
  lose ground, or was it forgiving. NOT honest (and explicitly forbidden in the
  prompt): treating the 2nd-best line as "the move a human would have played" — we
  have no rating-conditioned move model, so any "+X% over what you'd have done"
  claim is fabricated. So: the headline shows `best move · held 76% (sharp spot)`
  not a fake swing; the spread feeds the coach only as a position property; the
  _difficulty_ judgment is left to the dialogue. Lives in `facts.ts` / `prompt.ts`
  (`winChanceLines` + the WIN % system rule) / `+page.svelte` (`winLine`);
  `PRECISION_GAP = 12`% is the arbitrary sharpness threshold. A true human baseline
  (Maia-style) is the only thing that would license a real counterfactual; out of
  scope.
- **Facts are derived client-side and trusted by `discuss/+server.ts`.** The
  production `/api/review/explain` re-derives facts server-side for trust; this
  spike does not. Reason: fewer moving parts for a single-user probe.

## Assumptions (stated as assumptions)

- Assumes the entered username is one of the two players in the chosen game
  (it always is when picked from that user's own list); `sideFor` returns null
  otherwise and the run is refused.
- Assumes chess.com's public API is reachable and returns standard-chess PGNs
  with the metadata `normalize()` needs.
- Assumes the browser can run the Stockfish WASM and that a full-depth pass over
  every move is acceptable latency (no caching; recomputed each run).
- Assumes the LLM returns a single JSON object matching `DiscussResponse`;
  `coach.ts` tolerates ```fences and stray prose but otherwise fails with`coach_invalid_response`.
- Assumes `OPENROUTER_API_KEY` is present in the runtime env (via direnv).

## Arbitrary / unverified knobs (facts, not recommendations)

- Turning-point thresholds: player drop ≥ 8 win-%, opponent blunder ≥ 12 win-%,
  top 3 by magnitude, presented in game order. First guesses; not tuned against
  data.
- Analysis depth is `REVIEW_DEPTH` (16) for the per-move pass and depth 16 with
  `multiPv: 3` for the per-turning-point re-eval.
- Conversation is capped by the prompt to "at most one follow-up then wrap up";
  not enforced in code.
- Board line playback shows ≤ 6 reply plies / 8 best plies, 800 ms per step.

## Verification done

`npm run check` and eslint pass. Manually exercised against live Gemini 3.5
Flash: game fetch (`Timbolt123`), the first (scene-setting) turn, a reply turn
(with board `show` + learnings + done), and an opportunity turn (opponent
early-queen). Full in-browser click-through of the engine pass was not automated.
