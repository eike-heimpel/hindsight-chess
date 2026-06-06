# Docs — the map

The depth behind the root [`CLAUDE.md`](../CLAUDE.md). Conventions for writing
docs (code wins, no line numbers, single-topic, reference don't embed) live in
that file's **Documentation** section — follow them here. Domain terms live in
[`glossary.md`](glossary.md); link to it instead of redefining inline.

Two kinds of doc: the **why** (product/design intent) and the **reference** (how
the code works). Read the why before product/UI work; read the reference before
non-trivial feature work.

## Reference — how the code works

| Doc                                      | Covers                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`review.md`](review.md)                 | The review feature: design + module reference. The first read for anything non-trivial.                                                                                                                              |
| [`learning-model.md`](learning-model.md) | The _why_ behind review + coach — the Predict→Reveal→Reconcile→Abstract loop, the Stockfish/chess.js/LLM role split, the monetization seam. Read before changing how explanations, the coach, or persistence behave. |
| [`persistence.md`](persistence.md)       | The per-user move-state layer — the move-as-atom model, facets, trust boundaries, delivery phases.                                                                                                                   |

## Why — who it's for and how it feels

| Set                                               | Covers                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`product-strategy/`](product-strategy/README.md) | Audience, positioning, vision — who it's for and why it wins. Has its own index. |
| [`design/`](design/CLAUDE.md)                     | The visual language — brand (soul) + system (tokens). Has its own index.         |

## Known reframes (tracked, not yet done)

- `review.md` still reads as a feature doc of a larger app and is long for a
  single-topic file — folds into a doc reframe (also tracked in the root
  CLAUDE.md cleanup list).
- `persistence.md` was written as a pre-build design doc; several phases have
  since shipped, so its framing leads with "design" while marking built phases
  inline. A pass to reframe it as built-reality + a short build log is pending.
