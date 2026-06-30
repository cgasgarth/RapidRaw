# Color Editor Runtime Status UI

- Issue: #1262 `color(ui): professional color editor polish pass`
- Scope: compact color-panel runtime status rail.
- Runtime status: UI proof only; this does not add new color algorithms.

The color panel now starts with a dense status rail for core implementation
coverage:

- `GPU`: preview/export path exists for the bounded advanced color slice;
- `API`: typed command/API coverage exists for color routes;
- `UI`: the color workflow visual smoke covers the status rail.

This keeps runtime coverage visible while preserving the existing editor
controls. The proof is `bun run check:color-workflow-smoke`.

## Validation

- `bun run check:color-workflow-smoke`
- `bun run check:types`
- `bun run check:lint -- src/components/adjustments/Color.tsx scripts/proofs/capture-visual-smoke.ts`
- `bun run docs:links`
