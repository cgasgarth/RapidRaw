# RapidRAW Image Pipeline Baseline

- Snapshot date: 2026-06-13
- Issue: #58 `audit(pipeline): document current image pipeline`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-image-pipeline-audit`
- Branch: `codex/image-pipeline-audit`

## Purpose

This document records the current RapidRAW image pipeline before RawEngine changes
RAW development, color, layers, masks, export, HDR, panorama, focus stacking, or
super-resolution behavior. It is a static audit of the existing pipeline, not a
target architecture.

## Inspected Surface

Primary backend files:

- `src-tauri/src/io/image_loader.rs`
- `src-tauri/src/raw/raw_processing.rs`
- `src-tauri/src/render/image_processing.rs`
- `src-tauri/src/gpu/gpu_processing.rs`
- `src-tauri/src/io/cache_utils.rs`
- `src-tauri/src/library/file_management.rs`
- `src-tauri/src/export/export_processing.rs`
- `src-tauri/src/render/mask_generation.rs`
- `src-tauri/src/app_state.rs`
- `src-tauri/src/lib.rs`

Primary frontend files:

- `src/hooks/useImageLoader.ts`
- `src/hooks/useImageProcessing.ts`
- `src/hooks/useTauriListeners.ts`
- `src/hooks/useThumbnails.ts`
- `src/hooks/useExportSettings.ts`
- `src/store/useEditorStore.ts`
- `src/store/useProcessStore.ts`
- `src/components/panel/Editor.tsx`
- `src/components/panel/editor/ImageCanvas.tsx`
- `src/components/panel/right/ControlsPanel.tsx`
- `src/components/panel/right/ExportPanel.tsx`

Related baseline docs:

- `docs/baseline/rapidraw-architecture-baseline-2026-06-11.md`
- `docs/baseline/rapidraw-gpu-shader-baseline-2026-06-11.md`
- `docs/baseline/rapidraw-sidecar-format-baseline-2026-06-11.md`

## Pipeline Summary

RapidRAW's current edit pipeline is centered on a selected source image stored in
`AppState.original_image`, a frontend-owned adjustment JSON object, and a GPU
preview renderer. The pipeline is not yet a versioned edit graph. Most adjustment
state is persisted as unversioned JSON in `.rrdata` sidecars, then parsed by Rust
at render time.

High-level flow:

1. Frontend selection loads metadata early from the sidecar.
2. Backend `load_image` decodes the physical source image, stores it in
   `AppState.original_image`, and returns dimensions, EXIF, metadata, and raw
   status.
3. Frontend controls mutate `useEditorStore.adjustments`.
4. `useImageProcessing` serializes the adjustment payload and calls
   `apply_adjustments`.
5. Rust coalesces preview work through a single preview worker and renders the
   latest job.
6. GPU compute applies adjustment shaders to a transformed preview base.
7. The frontend receives either a JPEG buffer, an interactive ROI JPEG patch, or
   the `WGPU_RENDER` sentinel for direct WGPU display.
8. Histogram and waveform analytics are emitted as Tauri events.
9. Debounced saves persist adjustment JSON and refresh thumbnails.
10. Export reloads or reuses source data, applies the same adjustment payload, and
    writes encoded output files.

## Load And Decode

Frontend image loading is split into metadata and pixel loading in
`useImageLoader`.

Metadata phase:

- clears session caches through `clear_session_caches`;
- invokes `load_metadata`;
- normalizes sidecar adjustments with `normalizeLoadedAdjustments`;
- resets frontend edit history to the loaded adjustment snapshot.

Pixel phase:

- invokes `load_image`;
- stores source dimensions and preview target size in `useEditorStore`;
- updates selected-image readiness, EXIF, metadata, dimensions, and raw flag;
- initializes `aspectRatio` when no crop/aspect data exists.

Backend `load_image` behavior:

- increments `load_image_generation` so stale loads can be cancelled;
- clears selected-image caches, including original image, preview cache, GPU image
  cache, transformed/warped caches, mask cache, patch cache, geometry cache, and
  modal result caches;
- parses virtual-copy paths into physical source and sidecar paths;
- loads `.rrdata` metadata from the sidecar path;
- reads the physical source through memory mapping, with normal file read as a
  fallback;
- decodes the image on a blocking task;
- reads EXIF from the same byte source;
- inserts decoded image and EXIF into `decoded_image_cache`;
- stores `LoadedImage { path, image, is_raw }` in `AppState.original_image`.

RAW files are detected by extension through `formats::is_raw_file`. RAW decode
uses `raw_processing::develop_raw_image`, which wraps `rawler`, reads decoder
metadata, applies orientation, supports a fast demosaic mode, applies highlight
compression and linear-mode choices, and checks the load-generation cancellation
token between major stages.

Non-RAW files are decoded with the `image` crate and orientation handling.
Optional preprocessing can also run on non-RAW files when settings request it.

## Adjustment Payload

The frontend adjustment object is the current source of truth. Rust does not
persist a separately versioned adjustment schema for the app's native sidecar
format.

Adjustment payload preparation:

- `useImageProcessing` calls `prepareAdjustmentPayloadForBackend` before
  rendering;
- AI patch payloads are deduplicated with `patchesSentToBackend`;
- full adjustment objects are sent for preview rendering;
- debounced saves call `save_metadata_and_update_thumbnail`;
- multi-selected edits use adjustment deltas through `apply_adjustments_to_paths`.

The backend converts known adjustment keys into render structs. Unknown or absent
keys generally fall back to defaults, which makes current behavior tolerant but
also weakens migration guarantees.

## Preview Worker

`apply_adjustments` creates a `PreviewJob` with:

- adjustment JSON;
- `is_interactive`;
- optional target preview resolution;
- optional normalized ROI;
- waveform options;
- a one-shot responder.

The preview worker is a single background thread. It drains queued jobs before
processing so only the latest pending preview job renders. This keeps slider
interaction responsive but means intermediate preview states are intentionally
dropped.

Preview render inputs are derived from:

- `AppState.original_image`;
- app settings for preview resolution, live quality, WGPU display, and RAW
  behavior;
- cached transformed preview bases;
- visible mask and AI patch state;
- parsed LUT data when `lutPath` is present;
- ROI supplied by the frontend during zoomed interactive edits.

## Transform And Cache Hashes

`cache_utils.rs` separates several cache keys:

- `calculate_geometry_hash` covers geometric/lens/patch inputs.
- `calculate_visual_hash` covers non-geometric visual adjustments.
- `calculate_transform_hash` covers orientation, crop, rotation, flip, lens
  transform keys, and AI patch identity/visibility/data length.

Important caches in `AppState`:

- `decoded_image_cache`: decoded source images and EXIF by physical path.
- `cached_preview`: transformed preview base plus small interactive variant.
- `gpu_image_cache`: uploaded `Rgba16Float` input texture for a transform hash.
- `gpu_processor`: reusable WGPU processor sized upward to image bounds.
- `full_warped_cache` and `full_transformed_cache`: CPU-side full-resolution
  transform caches.
- `mask_cache`: generated mask bitmaps by mask definition/render geometry.
- `patch_cache`: AI patch data sent separately from adjustment references.
- `geometry_cache` and `thumbnail_geometry_cache`: transformed image helpers for
  preview and thumbnail paths.

Loading a new selected image clears most selected-image caches. Dedicated cache
commands clear narrower sets, but there is not yet a unified cache lifecycle
contract for RawEngine feature work.

## GPU Adjustment Rendering

The current primary preview path is GPU compute, not CPU-first rendering.

`gpu_processing::process_and_get_dynamic_image_with_analytics`:

- creates or reuses a `GpuProcessor`;
- rounds processor allocation up to 256-pixel boundaries;
- uploads the transformed base image as `Rgba16Float` when the transform hash or
  dimensions change;
- dispatches shader work in tiles;
- optionally limits work to an interactive ROI;
- copies tile output into a final CPU buffer unless direct WGPU display skips CPU
  readback;
- emits analytics readback when histogram/waveform data is requested.

If image dimensions exceed WGPU texture limits, the function currently logs a
warning and returns an unprocessed clone of the base image. That protects against
crashes but is not a color- or quality-preserving fallback.

Direct WGPU display returns a `WGPU_RENDER` sentinel to the frontend and emits
`wgpu-frame-ready`. Non-WGPU full renders return JPEG bytes. Non-WGPU interactive
renders prepend a 24-byte ROI header followed by a JPEG patch.

## ROI And Interactive Preview

Frontend ROI calculation happens in `useImageProcessing` from the current zoom,
pan, rendered image bounds, and container size.

ROI is omitted when:

- the transform wrapper state is unavailable;
- base render dimensions are missing;
- scale is near 1.0;
- the visible intersection is empty;
- the clamped ROI effectively covers the whole image.

Interactive render behavior:

- up to three interactive jobs can be in flight;
- pending interactive state is coalesced;
- non-WGPU interactive responses update `interactivePatch`;
- full non-interactive responses replace `finalPreviewUrl`;
- old blob URLs are revoked after short delays;
- `WGPU_RENDER` responses clear interactive patch state and rely on native
  surface presentation.

## Analytics

Histogram and waveform output are backend-to-frontend events:

- `histogram-update`
- `waveform-update`

The frontend listener applies updates only when the payload path matches the
currently selected image. Analytics are skipped for interactive ROI jobs. When
direct WGPU display avoids normal CPU readback, the backend can still perform a
separate readback for analytics.

## Thumbnails

Thumbnail generation is separate from selected-image preview rendering.

Current behavior:

- frontend `useThumbnails` updates the backend thumbnail queue;
- backend `ThumbnailManager` tracks queue, condition variable, and currently
  processing paths;
- thumbnail generation uses `generate_thumbnail_data`;
- generated thumbnails are emitted through `thumbnail-generated`;
- progress uses `thumbnail-progress` and `thumbnail-generation-complete`;
- frontend listener batches thumbnail/rating/edit-status updates into animation
  frames before touching stores.

Thumbnails can use cached decoded images and GPU context. The thumbnail path also
has geometry cache behavior, which means future geometry/layer changes need
thumbnail-specific invalidation tests.

## Export Pipeline

Export is owned by `export_processing.rs`.

`export_images`:

- rejects concurrent exports through `export_task_handle`;
- expands selected physical and virtual-copy paths;
- resolves output file names, folders, and duplicate appearances;
- loads sidecar metadata and adjustment JSON;
- can export LUTs from adjustments;
- processes the main output image through `process_image_for_export`;
- optionally exports masks through `export_masks_for_image`;
- writes progress and completion events.

`process_image_for_export_pipeline` reloads/decodes the source, applies current
adjustments, encodes output bytes, optionally embeds or strips metadata/GPS, and
applies resize/watermark behavior. Export uses the same broad adjustment payload
as preview, but it is a separate path with its own IO, naming, metadata, and
progress behavior.

Frontend export progress and completion are surfaced through:

- `batch-export-progress`
- `export-complete`
- `export-complete-with-errors`
- `export-error`
- `export-cancelled`

## Current Strengths

- Selected-image load cancellation prevents stale decodes from winning after a
  new selection.
- Preview worker coalescing avoids wasting GPU work on superseded slider states.
- ROI patch rendering reduces work during zoomed interactive edits.
- GPU processor and texture caches avoid repeated large allocations for stable
  transforms.
- Sidecar-based adjustment persistence is simple and inspectable.
- Export and preview share major adjustment concepts, reducing obvious drift.

## Current Risks

- Adjustment state is not a versioned native schema, so migrations and replay are
  weak.
- GPU compute is the main preview path; CPU fallback behavior is incomplete for
  normal adjustment rendering.
- Returning an unprocessed image when texture limits are exceeded is safe for
  stability but risky for user trust.
- Preview, thumbnail, and export paths share concepts but do not have a single
  declared render contract or parity test suite.
- Cache invalidation is spread across load, explicit cache commands, hash
  helpers, preview generation, thumbnails, masks, patches, and export.
- JPEG preview transport is display-referred and lossy; it is useful for UI but
  not a reliable validation artifact for color-critical changes.
- Histogram/waveform analytics are event-driven and path-checked, but not yet
  fixture-validated against known images.
- RAW preprocessing settings materially affect decoded source pixels before
  normal adjustments, which must be made explicit in future RawEngine provenance.

## RawEngine Follow-Up Requirements

- Define a versioned render contract spanning preview, thumbnail, export, and
  future edit-graph replay.
- Add fixture tests that compare preview/export parity for deterministic
  adjustment payloads.
- Add CPU/GPU parity tests for core color operations before claiming
  Capture One-class color quality.
- Add explicit provenance for RAW development settings, preprocessing choices,
  LUTs, masks, AI patches, and export settings.
- Replace the unprocessed oversized-image fallback with an explicit tiled or
  CPU/reference path.
- Document and test cache invalidation for layer, mask, HDR, panorama, focus
  stack, super-resolution, and negative-lab outputs.
- Promote histogram/waveform validation into image-quality fixtures after
  public fixture policy and golden render commands are in place.
