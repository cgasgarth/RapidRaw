# Current Color Pipeline Audit

Issue: #83 `color(audit): audit current RapidRAW color pipeline`

Runtime status: audit-only. This PR documents current behavior and adds a doc
guard; it does not change preview pixels, export pixels, RAW development, WGSL,
or color-science math.

## Sources Audited

- `src-tauri/src/raw_processing.rs`
- `src-tauri/src/image_loader.rs`
- `src-tauri/src/image_processing.rs`
- `src-tauri/src/gpu_processing.rs`
- `src-tauri/src/export_processing.rs`
- `src-tauri/src/shaders/shader.wgsl`
- `src/utils/adjustments.ts`
- `src/components/adjustments/Color.tsx`

## Current Runtime Flow

1. RAW load enters `develop_raw_image` in `raw_processing.rs`, decodes through
   `rawler`, removes the `SRgb` develop step, optionally uses fast demosaic, and
   emits `DynamicImage::ImageRgba32F`.
2. RAW levels are rescaled from camera black/white levels, with highlight
   compression above `1.0` when fast demosaic is disabled.
3. The editor maps UI JSON into `GlobalAdjustments`, `MaskAdjustments`, and
   `AllAdjustments` in `image_processing.rs`.
4. GPU preview/export processing sends those adjustment structs into
   `shader.wgsl`.
5. WGSL applies local/creative effects, white balance, brightness, tonal
   controls, highlight recovery, color calibration, HSL, creative color, color
   grading, masks, vignette, tone mapping, curves, LUT, clipping overlay, and
   dither.
6. Export uses the same GPU adjustment path through
   `process_image_for_export_pipeline`, then encodes with image/JXL/WebP
   encoders.

## Current Strengths

- RAW data is kept as floating-point image data before the GPU path.
- Preview and export share the `get_all_adjustments_from_json` mapping and
  `process_and_get_dynamic_image` path.
- `is_raw_image` reaches the shader, allowing RAW-specific tone behavior.
- AgX matrices exist on both CPU and WGSL sides and now have fixture-backed
  drift checks.
- Current color UI already covers white balance, HSL, color grading, color
  calibration, tone curves, LUTs, camera profile selection, channel mixer, RGB
  balance, black-and-white mixer, and profile tone controls.

## Gaps

- The working color space is not enforced at runtime as an explicit typed
  artifact boundary; the plan now names `acescg_linear_v1`, but the live
  pipeline still relies on implicit RGB buffers.
- Camera profile handling is not yet a verified matrix/profile conversion stage
  from camera colorimetry into the working space.
- White balance is a channel multiplier, not a measured illuminant/CAT stage in
  the runtime shader.
- Display/output profile handling is not yet a complete ICC/CMM pipeline;
  export encoders receive rendered image data without a proven profile transform
  or embedded-profile contract.
- Gamut mapping is not runtime-applied; #94 adds only schema/fixture policy.
- Preview/export parity is structurally likely for shared paths, but still needs
  runtime image fixtures that compare pixels through representative recipes.
- CPU/GPU parity currently covers selected shader functions and does not yet
  prove full-pipeline parity.
- Wide-gamut macOS display behavior is not proven by visual artifacts.

## Required Follow-Up Order

1. Extend the initial camera profile matrix-transform proof into real RAW
   decoder/profile integration and preview/export parity.
2. Promote chromatic adaptation from schema/fixture plan to runtime math.
3. Add CPU reference color pipeline for representative patches.
4. Add preview/export parity fixtures for full rendered recipes.
5. Add gamut warning and clipping overlays tied to the gamut policy.
6. Add ICC/profile embedding and soft-proof contracts for export.
7. Add live GPU readback parity for full pipeline checkpoints.

## Validation

- `bun run check:color-pipeline-audit`
- `bun run docs:check`
- `bun run check:unsafe-casts`
- `bunx prettier --check docs/color/architecture/current-color-pipeline-audit-2026-06-15.md tests/integration/checks/check-color-pipeline-audit.ts docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `git diff --check`
