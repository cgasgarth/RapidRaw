# RapidRAW Layer And Mask Model Audit

- Issue: #61
- Scope: current inherited layer, mask, AI patch, and renderer model.
- Runtime status: audit only. This document records current behavior and gaps; it
  does not add graph-native layers.

## Current State Shape

`Adjustments` owns both `masks` and `aiPatches` in
`src/utils/adjustments.ts`.

`MaskContainer` is the current local-adjustment layer stand-in:

- `id`
- `name`
- `visible`
- `invert`
- `opacity`
- `subMasks`
- `adjustments`

`MaskAdjustments` stores layer-scoped adjustment values for exposure, contrast,
color, detail, effects, curves, and section visibility. It still includes a
legacy index signature for preset and copy/paste compatibility.

`AiPatch` is separate from normal masks. It stores prompt, patch data, loading
state, visibility, invert, and its own `subMasks`.

## Current UI Model

`src/components/panel/right/layers/MasksPanel.tsx` owns the main mask workflow.
It can create mask containers, add submasks, duplicate, invert, copy, paste,
delete, rename, select, and apply mask-scoped adjustments.

`src/components/panel/right/layers/LayerStackPanel.tsx` presents the current
mask containers as layers. It includes a base RAW row and supports visibility,
opacity, move up/down, duplicate, delete, and selection. The blend mode menu is
presentational only today: current `MaskContainer` does not persist blend mode.

`src/utils/layers/layerStack.ts` contains pure helpers for visibility, opacity,
delete, duplicate, and reorder. `src/utils/layers/layerAdjustments.ts` contains pure
helpers for clamped per-layer scalar adjustments.

## Current Renderer Model

`src-tauri/src/render/mask_generation.rs` renders each visible `MaskDefinition` into a
grayscale bitmap. Each `SubMask` has a type, visibility, invert, opacity, mode,
and dynamic parameter payload.

Current render composition supports:

- additive via max;
- subtractive via saturating subtraction;
- intersect via min;
- container invert;
- container opacity;
- submask invert;
- submask opacity;
- renderer-applied mask refinement and overlay rendering.

Supported renderer mask types include radial, linear, brush, flow, color,
luminance, AI subject, AI foreground, AI sky, AI depth, quick eraser, and all.

## Main Gaps

- Layers are still represented by mask containers rather than graph-native layer
  nodes.
- Blend mode is not persisted or rendered.
- `SubMask.parameters`, `Adjustments`, and `MaskAdjustments` still contain
  legacy dynamic bags.
- Layer operations are not yet routed through the versioned command bus.
- AI patches are separate from normal layers and need a shared artifact/layer
  model before app-server editing can be complete.
- Sidecar, API, and command replay must converge on the schema package contract.

## Next Implementation Work

- Replace mask-container-only layers with graph-native layer records.
- Persist and render blend modes with a declared color-space policy.
- Replace dynamic parameter bags with discriminated schemas at UI boundaries.
- Route representative layer and mask operations through command envelopes.
- Add runtime/browser evidence for user-visible layer operations.
