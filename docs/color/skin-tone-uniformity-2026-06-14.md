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
```

The checker validates fixture shape with Zod and proves hue wraparound,
partial-uniformity, and full-target behavior.

## Validation Evidence

- `bun run check:skin-tone-uniformity`
- `bun run check:types`
- `bunx eslint src/utils/skinToneUniformity.ts scripts/check-skin-tone-uniformity.mjs --max-warnings 0`
- `bun run check:unsafe-casts`
- `bunx prettier --check src/utils/skinToneUniformity.ts scripts/check-skin-tone-uniformity.mjs fixtures/color/skin-tone-uniformity-fixtures.json docs/color/skin-tone-uniformity-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
