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

Spec only — not yet implemented in `src/routes/layout.css`. Migrating the token
layer in (and porting `palette.ts` onto it) is the next step once these are
approved.
