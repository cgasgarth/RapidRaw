# Mask Refinement Controls

- Issue: #1245 `masks(ui): expose mask refinement controls`
- Status: runtime-backed UI controls

## Scope

The masks panel now exposes renderer-backed submask refinement controls:

- Density
- Feather Px
- Edge Shift Px
- Edge Contrast
- Smoothness

These controls write directly to each selected submask parameter bag. The Rust
mask renderer already consumes the same `density`, `featherPx`, `edgeShiftPx`,
`edgeContrast`, and `smoothness` keys when generating live overlays and render
masks.

## Validation

`tests/integration/checks/masks/check-mask-refinement-controls.ts` verifies that the controls remain
wired to the masks panel and that all runtime-backed refinement keys are present.

This is UI-to-runtime plumbing. Pixel-quality tuning remains iterative and must
use real image fixtures before claiming final Capture One-class mask refinement
quality.
