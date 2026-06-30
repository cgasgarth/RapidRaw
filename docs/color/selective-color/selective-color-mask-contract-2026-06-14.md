# Selective Color Mask Contract

- Issue: #99 `color(mask): create color masks from selected ranges`
- Scope: typed conversion from selected color range to color range-mask
  selection.
- Runtime status: contract utility is available; full UI command wiring remains
  future work.

## Purpose

Professional color workflows need a direct path from a selected mixer range to a
maskable color range. This contract maps the checked selective color ranges into
the existing color range-mask shape with deterministic defaults for saturation,
luma, feather, and hue tolerance.

## Validation

Run:

```sh
bun run check:selective-color-mask
```

The checker validates fixture shape with Zod and verifies default, constrained,
and clamped range-mask conversion cases.

## Validation Evidence

- `bun run check:selective-color-mask`
- `bun run check:types`
- `bunx eslint src/utils/selectiveColorMask.ts tests/integration/checks/check-selective-color-mask-fixtures.ts --max-warnings 0`
- `bun run check:unsafe-casts`
- `bunx prettier --check src/utils/selectiveColorMask.ts tests/integration/checks/check-selective-color-mask-fixtures.ts fixtures/color/selective-color-mask-fixtures.json docs/color/selective-color/selective-color-mask-contract-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
