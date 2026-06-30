# Selective Color Ranges

- Issue: #96 `color(selective): add advanced selective color ranges`
- Scope: shared TypeScript range contract plus WGSL parity validation.

## Purpose

The color mixer UI and WGPU renderer must target the same hue centers and range
widths. This change moves the UI off duplicated approximate hue values and onto
a shared range contract that is validated against the shader's `HSL_RANGES`.

## Covered Ranges

The checked ranges are red, orange, yellow, green, aqua, blue, purple, and
magenta. Each range has:

- stable key;
- localized label key;
- UI swatch color;
- center hue in degrees;
- renderer range width in degrees.

## Validation

Run:

```sh
bun run check:selective-color-ranges
```

The checker validates the fixture with Zod, compares TypeScript range metadata,
and parses `src-tauri/src/shaders/shader.wgsl` so UI and renderer hue ranges
cannot drift silently.

## Validation Evidence

- `bun run check:selective-color-ranges`
- `bun run check:types`
- `bunx eslint src/utils/selectiveColorRanges.ts src/components/adjustments/Color.tsx tests/integration/checks/selective-color/check-selective-color-ranges.ts --max-warnings 0`
- `bun run check:unsafe-casts`
- `bunx prettier --check src/utils/selectiveColorRanges.ts src/components/adjustments/Color.tsx tests/integration/checks/selective-color/check-selective-color-ranges.ts fixtures/color/selective-color/selective-color-ranges.json docs/color/selective-color/selective-color-ranges-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
