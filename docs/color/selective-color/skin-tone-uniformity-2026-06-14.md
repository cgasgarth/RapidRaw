# Skin-Tone Uniformity

- Issue: #98 `color(skin): add skin tone uniformity controls`
- Scope: TypeScript uniformity math and fixture validation.
- Runtime status: math contract is available; full UI and renderer integration
  remain future work.

## Purpose

Capture One-style skin work needs controllable convergence for hue, saturation,
and lightness without hiding what changed. This first implementation adds a
small deterministic model that moves skin-like patch metadata toward target
values with independent uniformity amounts.

## Validation

Run:

```sh
bun run check:skin-tone-uniformity
bun run check:hue-memory-color
```

The checker validates fixture shape with Zod and proves hue wraparound,
partial-uniformity, full-target behavior, target-distance improvement, and the
runtime/UI proof artifact:

`docs/validation/proofs/color-selective/skin-tone-uniformity-runtime-ui-proof-2026-06-18.json`

The UI proof is covered by `bun run check:color-workflow-smoke`, which renders a
skin-tone uniformity output marker inside the color workflow validation surface.

## Hue And Memory-Color Gate

Issue #1932 adds a deterministic synthetic gate for hue linearity, neutral RGB
drift, and memory-color movement toward target values. The committed review
artifact is `docs/validation/proofs/color/color-hue-memory-gate-2026-06-18.json`.

- Per-case HSL/RGB tolerance must stay at or below `0.001`.
- Neutral RGB drift must stay at or below `1e-12`.
- Memory-color cases must reduce distance to the declared target; subjective
  review alone is not enough to pass this gate.

## Validation Evidence

- `bun run check:skin-tone-uniformity`
- `bun run check:hue-memory-color`
- `bun run check:types`
- `bunx eslint src/utils/skinToneUniformity.ts tests/integration/checks/check-skin-tone-uniformity.ts --max-warnings 0`
- `bun run check:unsafe-casts`
- `bunx prettier --check src/utils/skinToneUniformity.ts tests/integration/checks/check-skin-tone-uniformity.ts fixtures/color/selective-color/skin-tone-uniformity-fixtures.json docs/color/selective-color/skin-tone-uniformity-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
