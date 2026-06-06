# The learning model — why this product is shaped the way it is

This is the _why_ behind the review + coach features. Read it before changing how
explanations, the coach, or persistence behave. It is deliberately conceptual;
the code is the source of truth for _how_.

## The goal

Help a player **improve** — get better at understanding positions, thinking
through them, and theorycrafting. Improvement in chess is well-studied and it is
**not** "knowing the engine's best move." Two facts shape everything:

1. **Skill is pattern recognition.** The classic expertise research (de Groot;
   Chase & Simon) showed masters don't calculate more — they _recognise_ the
   position as familiar chunks. So "getting better" means **acquiring patterns
   and habits of thought**, not memorising moves.
2. **Beginners (~500–900) lose to a small set of recurring _thinking_ failures**,
   not to a missing engine move: not checking the opponent's reply (hanging
   pieces), no plan, not calculating forcing moves, misjudging trades/structure.
   The lesson of a bad move is almost always the **thinking error behind it**,
   not the engine line that refutes it.

## The core problem

We own a perfect oracle of answers (Stockfish). **But answers are not learning —
and handing someone the answer destroys the thinking that would have produced the
learning.** A move grade plus "best was Nxc3" is feedback with the cognitive work
removed: the player never committed to a prediction, so there is no gap to
reconcile, nothing to encode. It is watching someone else solve the puzzle.

A second trap: the engine's eval assumes _perfect play by both sides_. A
"−1.4 blunder" can be something no 700-rated opponent would ever punish. Engine
severity ≠ practical severity. Calibrating alarm to the engine teaches fear of the
wrong things.

## The loop

The product's job is to convert _answers_ into _thinking_. The mechanism is one
loop — retrieval practice applied to the player's own games:

| Stage         | What happens                                                                                                            | Where it lives in the code                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Predict**   | Before the answer, the player commits: why this move? what's the threat? what would you play?                           | coach `intent:'open'` (scene + ask, no explanation); variant B stays silent until the player speaks. The per-move "What were you thinking?" note. |
| **Reveal**    | _Now_ show the truth (eval, best line) — the commitment makes the gap visible.                                          | The review **explanation** (`/api/review/explain`), grounded + gated.                                                                             |
| **Reconcile** | Work the gap **Socratically** — never lecture. "You wanted to attack; the engine prefers Nxc3 — what's the difference?" | coach `intent:'answer'` / `'guide'` (a hint, never the full answer); multi-turn `coach/discuss`.                                                  |
| **Abstract**  | Name the transferable pattern so it generalises.                                                                        | `Learning { level: 'tactical' \| 'principle' \| 'process' }`.                                                                                     |
| **Aggregate** | Track patterns across games; resurface them (spaced). _"Third game you've hung a piece while attacking."_               | `thread.learnings` rollup — **Phase 5 / deferred** (substrate built, analytics not).                                                              |

The Reveal and the loop are **two steps of the same thing**, on **one
conversation primitive**. The explanation is the answer; the coach is the
thinking. A player reviews a move, sees the truth, and can open a coach
conversation on it. The "full coach" walk is the same engine applied across a
game's turning points instead of one move.

## The role split (what makes it honest _and_ pedagogical)

| Component                  | Job                                                                                                    | Must never                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Stockfish**              | the oracle: what is best, how good (truth under perfect play)                                          | explain, plan, or judge what a human could find          |
| **chess.js** (the gate)    | the verifier: guarantees no claim contradicts the board (`explainGate.ts`, coach `gate.ts`)            | reason or teach                                          |
| **LLM**                    | the tutor: elicit thinking, run the Socratic gap-work, name patterns — grounded only in verified facts | grade, invent moves, or hand over the answer prematurely |
| **the player's reasoning** | the raw material the tutor teaches against (notes, free-text turns)                                    | —                                                        |

The engine knows the truth, the gate guarantees we never lie about it, the LLM
turns truth into thinking, and the player's own prediction is what makes it stick.

## Monetization seam (built, not enforced)

The likely model: **the loop is the value, and the meterable unit is "a move you
open a coach conversation on."** Free might be ~1 move/day; the rest premium.

So there is **one** natural gate — opening a coach conversation on a move
(`assertCanDiscuss` in `coachEntitlement.ts`, called by `/api/review/coach/discuss`).
Today it allows everything. When monetization lands it counts distinct
`(userId, day)` moves and enforces the tier. The explanation (Reveal) stays free —
it is the hook that makes the Reconcile worth paying for. We build the seam now so
the architecture is correct; we do not build the paywall.

## Status

- **Built:** grounded + gated explanations (Reveal); the coach loop
  (Predict/Reconcile/Abstract); per-move coach thread persistence + resume
  (Phase 4); the entitlement seam (allow-all). The coach is now **inline on the
  review page** — `/review/[source]/[gameId]` is the single learning surface;
  "Talk it through" opens the conversation on the move in place (voice-first
  variant 'B'). There is no separate coach route.
- **Deferred (intentionally):** cross-game pattern Aggregate / weakness analytics
  - SRS (Phase 5); the actual paywall (the `coachEntitlement` seam is where it
    lands); surfacing variant 'A' (conversation-first) as a user-selectable style.
