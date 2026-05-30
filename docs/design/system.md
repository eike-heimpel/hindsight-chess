# System — the mechanics

> **Design set:** [Index](./CLAUDE.md) · [Brand](./brand.md) · **System**
> Concrete tokens that deliver the brand feel. Values are a tunable v0.

Stack reality: Tailwind v4, CSS-first (`@import 'tailwindcss'` + `@theme` in
`src/routes/layout.css`, no `tailwind.config`). Today the domain colors are
hardcoded light-mode hex in `src/lib/review/charts/palette.ts` — those move onto
the semantic tokens below.

## Token architecture (the rule that prevents the refactor)

Two layers, never mixed:

1. **Primitives** — raw scales (a color ramp, the spacing steps, the type sizes).
   Theme-agnostic. Live in `@theme`.
2. **Semantic tokens** — role-named (`--bg`, `--surface-1`, `--text`, `--brand`,
   `--good`). These are what components reference, _never_ a raw hex or a
   primitive. Defined under `:root` (dark, the default) and overridden under
   `[data-theme='light']`. Swapping the theme = swapping this layer only.

Components and charts reference **semantic tokens only**. That is the single
discipline that keeps dark/light and re-skins free.

```css
/* layer 2: semantic, dark default */
:root {
	--bg: #0a0b0d;
	--surface-1: #141619;
	--surface-2: #1c1f23;
	--surface-3: #24272c;
	--border: #2a2e34;
	--border-strong: #3a3f47;
	--text: #f2f3f5;
	--text-2: #a8adb5;
	--text-muted: #6b7178;
	--brand: #8b7bf2;
	--brand-hover: #9d8ff5;
	--brand-tint: #1b1830;
	--good: #34d399;
	--bad: #fb7185;
	--draw: #9aa0a8;
}
[data-theme='light'] {
	--bg: #fafaf9;
	--surface-1: #ffffff;
	--surface-2: #f5f5f4;
	--surface-3: #ffffff;
	--border: #e7e5e4;
	--border-strong: #d6d3d1;
	--text: #1c1917;
	--text-2: #57534e;
	--text-muted: #a8a29e;
	--brand: #6d5fe0;
	--brand-hover: #5a4dd0;
	--brand-tint: #efedfb;
	--good: #059669;
	--bad: #e11d48;
	--draw: #d6d3d1;
}
/* expose to Tailwind so `bg-surface-1`, `text-text-2`, etc. auto-swap */
@theme inline {
	--color-bg: var(--bg);
	--color-surface-1: var(--surface-1);
	--color-surface-2: var(--surface-2);
	--color-surface-3: var(--surface-3);
	--color-border: var(--border);
	--color-text: var(--text);
	--color-text-2: var(--text-2);
	--color-text-muted: var(--text-muted);
	--color-brand: var(--brand);
	--color-good: var(--good);
	--color-bad: var(--bad);
	--color-draw: var(--draw);
}
```

## Color — domain (chess-specific, the part that matters most)

These are semantic too — define dark + light values, reference by role.

**Result:** `--good` = win, `--bad` = loss, `--draw` = draw. (Locks the universal
green/red; never repurpose them for brand.)

**Move-class ramp** — monotonic good→bad, one scale not five hues. Dark values
run lighter than the current light `-600`s for contrast:

| Class      | Dark                  | Light (current) |
| ---------- | --------------------- | --------------- |
| best       | `#34d399` emerald-400 | `#059669`       |
| good       | `#a3e635` lime-400    | `#65a30d`       |
| inaccuracy | `#facc15` yellow-400  | `#ca8a04`       |
| mistake    | `#fb923c` orange-400  | `#ea580c`       |
| blunder    | `#fb7185` rose-400    | `#e11d48`       |

**Win% scale** — continuous bad↔draw↔good interpolation for win-% marks/sparklines
(supersedes `winRateColor`'s hard 50% split where a gradient reads better).

**Board & analysis:** `--board-light`, `--board-dark`, `--board-last` (last move),
`--board-select`, `--board-check`, `--arrow-best` (= `--good`), `--arrow-played`.
**Eval bar:** `--eval-white`, `--eval-black`. Starting board (cool, premium):
light `#b9c0c9` / dark `#566070` in dark theme — tunable.

**Brand accent** is violet (`--brand`), deliberately a _third_ hue so it never
collides with win/loss semantics. It's the single easiest token to retune.

## Type

- **`--font-sans`**: Inter (UI). **`--font-mono`**: a clean mono for SAN notation
  and raw figures (e.g. IBM Plex Mono). Optionally `--font-display` = sans.
- **Tabular figures everywhere numbers align**: `font-variant-numeric:
tabular-nums` on all stats/tables. Non-negotiable for an analyst-grade feel.
- Scale (rem, 16px root): `xs .75` · `sm .8125` · `base .9375` · `md 1` ·
  `lg 1.125` · `xl 1.375` · `2xl 1.75` · `3xl 2.25` · `display 3rem`.
  UI base is 15px (`.9375`) — dense enough for data, calm enough to read.
- Weights: 400 body, 500 labels/UI, 600 headings. Avoid hairline weights on dark
  (they shimmer).

## Space, radius, elevation, motion

- **Space** (4px base): `1`=4 `2`=8 `3`=12 `4`=16 `5`=20 `6`=24 `8`=32 `10`=40
  `12`=48 `16`=64.
- **Radius:** `sm` 6 · `md` 10 · `lg` 14 · `xl` 20 · `full`. Cards default `md`
  /`lg`. No pill-rounded surfaces (reads playful).
- **Elevation (dark):** lift via _surface lightness step + hairline border_, not
  heavy shadow (shadows barely register on dark). Shadows are a faint finishing
  touch: `--shadow-1` subtle, `--shadow-2` for popovers/modals only.
- **Motion:** `--ease` `cubic-bezier(.2,.8,.2,1)`; durations `--dur-fast` 120ms ·
  `--dur` 180ms · `--dur-slow` 280ms. No bounce by default (the existing `bob`
  keyframe is playful — reserve for an explicitly celebratory, earned moment).

## Density (the two-layer rule, mechanized)

- **Surface views:** comfortable — `space-4`/`space-6` rhythm, larger type, few
  numbers per card.
- **Depth views:** compact — `space-2`/`space-3`, `sm`/`xs` type, tabular grids,
  hairline dividers. This is where data density is _welcome_.

## Migration (so nothing gets refactored twice)

1. Add the semantic + `@theme inline` layers to `layout.css`; default dark.
2. Port `palette.ts` to read the tokens (charts are SVG — fills reference
   `var(--good)` etc., or the `C`/`CLASS_COLOR` maps are rebuilt from CSS vars)
   so charts theme automatically. Delete the hardcoded light hex.
3. Build all new UI against semantic tokens + Tailwind utilities only — never a
   raw hex in a component.
