# Design

The visual language and design-system foundation. The product "why" lives in
[`../product-strategy/`](../product-strategy/README.md); this set is about how it
**looks and feels**.

## The set

One concept per file, each with a reference header linking the others.

| File                     | Concept       | One line                                                       |
| ------------------------ | ------------- | -------------------------------------------------------------- |
| [brand.md](./brand.md)   | The soul      | Personality, mood, voice & tone                                |
| [system.md](./system.md) | The mechanics | Tokens: color, type, space, motion, dark/light, chess-specific |

## The one-line feel

> **Calm & premium on the surface; data-dense & sharp in the depth. Warmth lives
> in the words, not the pixels. Dark-first.**

## Decided

- **Mood:** calm & premium surface, data-dense depth-on-demand.
- **Theme:** dark-first; light is a first-class second via semantic tokens.
- **Density:** approachable by default, richness revealed when you dig in.

## Open / tunable (deliberately)

- The **brand accent hue** — set as a single token, swap it without refactoring.
- **Board colors**, **fonts** — starting values in system.md, easy to retune.
- **Name / wordmark** — not decided; out of scope for now.

## Status

Implemented. The token layer (primitives + semantic dark/light) lives in
`src/routes/layout.css`, and `src/lib/review/charts/palette.ts` reads the
semantic tokens (`var(--…)`), so charts theme automatically. The dark neutral
ramp is a warm stone family (see system.md); board/eval tokens stay cool, and
`--arrow-best` is the brand violet.
