# Layer Runtime Parent Status

Issue #1248 is ready to close from runtime evidence, not UI-only proof.

The runtime children cover normal opacity, multiply/screen, overlay/soft-light,
stack order replay, and preview/export parity through focused fixtures. The
remaining real RAW mask refinement path is tracked separately by #1247.

Validation:

- `bun run check:layer-runtime-parent-status`
- `bun run check:layer-normal-opacity-runtime`
- `bun run check:layer-multiply-screen-runtime`
- `bun run check:layer-overlay-soft-light-runtime`
- `bun run check:layer-opacity-order-runtime`
- `bun run check:layer-preview-export-parity`
