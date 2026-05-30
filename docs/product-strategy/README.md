# Product strategy

The product-level "why" for chess-review. Engineering/architecture lives in
[`../review.md`](../review.md); this set is about who it's for and why it wins.

## The set

One concept per file. They interlock but are meant to evolve independently, so
each opens with a **reference header** linking the others.

| File                               | Concept      | One line                                      |
| ---------------------------------- | ------------ | --------------------------------------------- |
| [vision.md](./vision.md)           | North star   | What this is and the feeling it optimizes for |
| [audience.md](./audience.md)       | Who it's for | Beachhead, segmentation, the funnel, ambition |
| [positioning.md](./positioning.md) | Why it wins  | Competition, the moat, the acquisition angle  |

## Decided so far

- **Beachhead:** beginner-first (≈500–900 rating), built for the player Eike is
  — ruthless dogfooding. Architected to not break as a user climbs toward ~1500.
- **North star:** "Strava for chess" — the place you go _after_ every game.
- **Nested model:** Strava _shape_ → "see how you really played" _hook_ → honest-
  coach _moat_. (See vision.md.)
- **Ambition:** an amazing, beloved core loop first; small revenue second; a
  chess.com-style acquisition is a valid upside, not the plan.

## Not here yet

Product pillars / roadmap / monetization mechanics — deliberately deferred so the
strategy concepts stay clean. Next conversation.
