# Selective Color Falloff

- Issue: #97 `color(selective): add range smoothness and falloff controls`
- Scope: reusable falloff model and fixture validation for current shader behavior.
- Runtime status: default falloff math is available to TypeScript; UI controls
  for user-adjustable smoothness remain future work.

## Purpose

The renderer currently uses a Gaussian-style influence curve for HSL range
selection. RawEngine needs this behavior documented and testable before exposing
professional range smoothness controls.

## Validation

Run:

```sh
bun run check:selective-color-falloff
```

The checker validates fixture shape with Zod, confirms the shader default
smoothness constant, verifies TypeScript influence output for center,
wraparound, wide-range, and edge falloff cases, and writes the #1876 runtime
apply report:

`docs/validation/proofs/color-selective/selective-color-apply-proof-2026-06-18.json`

That report records targeted RGB output deltas and an off-target guard case
where a red-range edit must leave a blue patch unchanged within tolerance.

## Validation Evidence

- `bun run check:selective-color-falloff`
- `bun run check:types`
- `bunx eslint src/utils/selectiveColorFalloff.ts tests/integration/checks/check-selective-color-falloff.ts --max-warnings 0`
- `bun run check:unsafe-casts`
- `bunx prettier --check src/utils/selectiveColorFalloff.ts tests/integration/checks/check-selective-color-falloff.ts fixtures/color/selective-color/selective-color-falloff-fixtures.json docs/color/selective-color/selective-color-falloff-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
