# Glossary

Domain terms used across the docs and code. Define a term here once and link to
it rather than redefining inline. The code is the source of truth for exact
thresholds and shapes — this names the concepts.

## Win% (win percentage)

A position's value expressed as a 0–100 win chance from the **mover's** point of
view, converted from the engine's centipawn eval (`winPercent` in
`review/winPercent.ts`). Used instead of raw centipawns because it is more
intuitive and compresses lopsided positions. Signs never flip on the viewer's
colour — see [perspective](#perspective).

## Classification

The chess.com-style label for a move's quality (best / good / inaccuracy /
mistake / blunder, etc.), derived from the win% swing the move caused
(`MoveClass` and the bucketing in `review/classify.ts`). Distinct from the
coach's [moment](#moment-momentkind), which is about _why we're discussing_ a
move, not how good it was.

## Turning point

A move flagged as worth reviewing — a large win% swing, surfaced as a candidate
for explanation or coaching. The "full coach" walk visits a game's turning
points in turn.

## Moment (MomentKind)

Why the coach is discussing a position — not how good the move was. One of
`mistake` (the player's own slip), `opportunity` (the opponent just blundered
and it's the player's turn to punish), `chosen` (a quiet move the player picked
to ask about), `opponent` (a move the opponent made, discussed in the third
person), or `explore` (a hypothetical "what if" line, not something that
happened). Derived server-side in the `discuss` route's `deriveMoment`; defined
in `coach/types.ts`.

## Subject

What a coach conversation is anchored to — either a **real game move** or an
**explored "what if" line** the player played out on the analysis board. One
conversation primitive serves both; the [MoveRef](#moveref) identifies which.
Lives in `coachThread.svelte.ts`.

## MoveRef

The identity of a touched move: `{ source, gameId, ply, line? }`. A real move
omits `line`; an explored alternative carries the UCI `line` played out from the
`ply` branch point (so `ply` may be 0, the start). The key every per-user facet
is stored under. Defined in `userMoveState.ts`.

## Facet

One feature's slice of a single move record — `mark`, `note`, `snapshot`, or
`thread`. No feature owns the move; features own facets, all on the same
[MoveRef](#moveref)-keyed record. See [`persistence.md`](persistence.md).

## Perspective

The viewer's colour (`'w'`/`'b'`), always derived server-side from the user's
linked accounts via `ownedSide` — never trusted from the request body. Drives
voice (own moves read "you played…", the opponent's are neutral third person)
and keys the explanation cache so the two readings never collide. Engine evals
stay [win%](#win-win-percentage) from the mover's POV regardless, so signs never
flip.

## The gate

The deterministic chess.js verifier that guarantees the LLM never states a board
claim it can't prove (`explainGate.ts` for explanations, coach `gate.ts` for the
coach). Stockfish is the oracle of truth; the gate is the verifier; the LLM is
the tutor. See [`learning-model.md`](learning-model.md).
