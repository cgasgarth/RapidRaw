# Mask Overlay Runtime Modes

- Issue: #118
- Scope: preview overlay mode schema, fixture validation, and live overlay command
  rendering.
- Runtime status: `generate_mask_overlay` accepts typed overlay settings and
  renders rubylith, green, blue, white, black, grayscale, inverse, edge, and
  hidden modes. User-facing mode controls remain future work.

## Runtime Contract

`src/schemas/maskOverlaySchemas.ts` defines the TypeScript-facing Zod schema.
`src/utils/mask/maskOverlayModes.ts` normalizes partial settings and evaluates the
same preview color contract used by fixtures.

`src-tauri/src/mask_generation.rs` now mirrors that contract with
`MaskOverlaySettings`, `MaskOverlayMode`, and `mask_overlay_pixel`. The Tauri
`generate_mask_overlay` command accepts optional `overlaySettings`; omitted
settings preserve the previous rubylith overlay behavior.

## Validation

`tests/integration/checks/masks/check-mask-overlay-modes.ts` verifies:

- valid overlay fixture normalization and color output;
- invalid fixture rejection through the Zod schema;
- Rust runtime coverage for the command argument, settings struct, and all mode
  branches.

Rust unit tests cover default rubylith behavior plus hidden, grayscale, inverse,
and edge rendering.

## Remaining Work

- Add visible mask overlay mode and opacity controls in the masking UI.
- Persist per-session or per-user overlay preferences.
- Add browser evidence once controls are user-facing.
