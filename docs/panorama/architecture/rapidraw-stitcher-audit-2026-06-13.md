# RapidRAW Panorama Stitcher Audit

- Date: 2026-06-13
- Issue: #175 `panorama(audit): audit existing RapidRAW panorama stitcher`
- Milestone: 11: Panorama Stitching
- Scope: audit current RapidRAW panorama behavior and define implementation
  constraints for the RawEngine panorama roadmap.

## Summary

RapidRAW already has a real panorama path, not just a placeholder. The current
implementation can load two or more selected images, detect features, estimate
pairwise homographies, choose a connected stitching order, warp full-resolution
images into a combined canvas, blend overlaps with an adaptive seam, preview the
result in the UI, and save the in-memory output.

That makes it a useful starting point for RawEngine, but it is not yet a
Capture One or Lightroom-class panorama workflow. The current path creates a
single rendered result held in process memory. It does not produce an editable
derived artifact with a schema, does not expose projection or boundary controls,
does not normalize exposure/color between frames, does not provide a robust
large-file memory strategy, and does not have fixture-backed validation.

## RAW Corpus Placeholders

Issue #1898 reserves panorama RAW corpus slots:

- `real.panorama.overlap-urban-row.v0`
- `real.panorama.parallax-foreground.v0`
- `raw-evidence.panorama.urban-overlap-row.v1`

These entries are schema/metadata only. They do not add RAW sequences, stitched
outputs, seam masks, source hashes, or quality claims. A later PR must attach
approved rights, hashes, ordered-source metadata, render artifacts, and review
evidence before these entries can count as runtime panorama proof.

## Current Entry Points

Frontend entry points:

- `src/hooks/useAppContextMenus.ts` opens the panorama modal for eligible
  multi-selection context-menu actions.
- `src/components/modals/PanoramaModal.tsx` drives the user-facing stitch,
  preview, retry, open, and save controls.
- `src/hooks/useProductivityActions.ts` invokes `stitch_panorama` and
  `save_panorama`.
- `src/hooks/useTauriListeners.ts` consumes `panorama-progress`,
  `panorama-complete`, and `panorama-error` events.
- `src/store/useUIStore.ts` stores modal state, selected source paths, progress,
  final preview data, and error text.

Backend entry points:

- `src-tauri/src/lib.rs` registers the `stitch_panorama` and `save_panorama`
  Tauri commands.
- `src-tauri/src/app_state.rs` stores the latest stitched output in
  `panorama_result`.
- `src-tauri/src/merge/panorama_stitching.rs` owns the command flow, image loading,
  feature matching, homography graph, stitch ordering, preview creation, and
  save path.
- `src-tauri/src/panorama_utils/processing.rs` owns feature detection, BRIEF
  descriptors, descriptor matching, RANSAC, homography solving, and low-detail
  masks.
- `src-tauri/src/panorama_utils/stitching.rs` owns full-resolution warping,
  adaptive seam choice, and feathered blending.

## Current Pipeline

1. The frontend passes selected paths to `stitch_panorama`.
2. Rust parses virtual paths and runs the stitch work inside `spawn_blocking`.
3. Each source image is read from disk and decoded through
   `load_base_image_from_bytes`.
4. RAW sources receive default CPU RAW processing before stitching.
5. The full image is converted to `Rgb32FImage`.
6. A grayscale copy is downscaled to a maximum processing dimension of 1600 px.
7. FAST9 corners are detected, non-max suppression is applied, and BRIEF
   descriptors are generated with deterministic sample pairs.
8. Every image pair is compared in parallel.
9. Descriptor matches use a nearest/second-nearest ratio threshold.
10. RANSAC estimates a homography for each sufficiently connected pair.
11. The strongest pairwise graph edges are used to build a maximum spanning
    tree, then breadth-first traversal creates an ordered connected component.
12. Full-resolution source images are warped into a global panorama canvas.

## Feature Transform Proof

Issue #1886 adds an executable synthetic proof for the first alignment slice:

- `fixtures/panorama/panorama-feature-transform-fixtures.json`
- `docs/validation/proofs/panorama/panorama-feature-transform-proof-2026-06-18.json`
- `bun run check:panorama-feature-transform`

The proof performs deterministic descriptor matching and translation-model
RANSAC over one overlap fixture, emits transform/provenance metadata, and
verifies a bounded `insufficient_inlier_matches` failure. It is runtime
alignment evidence only; projection, warping, seam blending, exposure
normalization, and real RAW stitch E2E proof remain separate issues. 13. Overlapping regions use an adaptive vertical or horizontal seam. 14. Low-detail regions widen the feather width to reduce visible banding. 15. A preview is downscaled to 800 px on the long side and emitted as PNG data
URL. 16. The full stitched `DynamicImage` is stored in `AppState.panorama_result`. 17. `save_panorama` writes a TIFF for `Rgb32FImage` outputs, otherwise PNG, and
writes a sidecar using the first source image as the metadata seed.

## Feature Transform Proof

Issue #1886 adds an executable synthetic proof for the first alignment slice:

- `fixtures/panorama/panorama-feature-transform-fixtures.json`
- `docs/validation/proofs/panorama/panorama-feature-transform-proof-2026-06-18.json`
- `bun run check:panorama-feature-transform`

The proof performs deterministic descriptor matching and translation-model
RANSAC over one overlap fixture, emits transform/provenance metadata, and
verifies a bounded `insufficient_inlier_matches` failure. It is runtime
alignment evidence only; projection, warping, seam blending, exposure
normalization, and real RAW stitch E2E proof remain separate issues.

Issue #1887 adds the next executable projection/crop metadata proof:

- `docs/validation/proofs/panorama/panorama-projection-crop-proof-2026-06-18.json`
- `bun run check:panorama-projection-crop`

That proof consumes the alignment report, serializes requested/effective
projection metadata, computes full-canvas and auto-crop rectangles, and records
that preview/export parity is deferred to #1888.

Issue #1888 adds the first executable blend/exposure pixel artifact proof:

- `docs/validation/proofs/panorama/panorama-blend-exposure-proof-2026-06-18.json`
- `bun run check:panorama-blend-exposure`

That proof consumes the projection/crop report, applies a deterministic exposure
gain to an overlap fixture, feather-blends overlap pixels, records changed-pixel
counts and output hash, and labels the artifact risk as synthetic
low-resolution only.

## Strengths To Preserve

- The implementation is local-first and does not require external stitcher
  binaries.
- Expensive image loading, feature detection, pairwise matching, and warping
  already use Rayon or blocking Rust work instead of blocking the React thread.
- The matching flow is deterministic enough to become fixture-testable because
  BRIEF sample pair generation uses a fixed seed.
- The algorithm can accept RAW and non-RAW inputs through the existing image
  loading path.
- The progressive event model is already usable by the modal and future
  app-server progress streams.
- Pairwise graph matching allows disconnected images to be excluded instead of
  forcing a single brittle sequence.
- The current blend path is better than a hard overwrite because it has
  adaptive seam selection, cosine feathering, and low-detail-aware feather
  widening.
- Output is kept as float RGB until final save, which is preferable to doing all
  stitch math in 8-bit display space.

## Gaps Against The RawEngine Target

### Editable Artifact Model

The current result is an anonymous rendered image held in `panorama_result`.
RawEngine needs a first-class panorama artifact with source references,
operation parameters, warnings, preview handles, invalidation rules, and a
stable schema. Saving should create or update a derived artifact node rather
than only writing a flattened image beside the first source file.

### Projection Controls

The stitcher uses planar homographies and one implicit projection. Professional
workflow needs explicit projection modes, at minimum rectilinear, cylindrical,
spherical, and perspective/planar where appropriate. The schema should preserve
the projection choice even before every projection is implemented.

### Boundary And Crop Controls

The output canvas is computed from transformed source corners, but the user has
no boundary fill, auto-crop, manual crop, or transparent edge policy. Future
controls need deterministic crop metadata and preview/runtime parity.

### Exposure And Color Matching

There is no per-frame exposure, white balance, vignette, or color normalization
before blending. This will create visible seams across real RAW brackets and
handheld captures. RawEngine should add a separate exposure normalization stage
before seam selection so the seam cost is not trying to hide preventable
tonal/color discontinuities.

### Lens And Geometry Preconditions

The stitch path does not explicitly model lens correction, chromatic aberration
correction, profile choice, or horizon/level constraints before matching. The
professional path should define whether lens correction is required,
recommended, or disabled per source, and should persist that decision into the
artifact provenance.

### Multi-Row And Disconnected Components

The maximum spanning tree can connect arbitrary pair graphs, but there is no
explicit multi-row capture model, row/column layout, field-of-view estimate, or
UI for manually reordering/matching images. Multi-row support needs its own
audit and should not be inferred as complete from graph traversal alone.

### Memory And Tiling

The current path allocates full-resolution float source images, a full output
float canvas, a full mask, seam matrices, and preview buffers in memory. This is
reasonable for small panoramas but unsafe for large stitched outputs. RawEngine
needs preflight cost estimation, hard memory budgets, tiling, cancellation, and
recoverable failure states before this can be a required quality gate.

### Cancellation And Job Model

`stitch_panorama` emits progress but does not expose cancellation, job IDs,
durable logs, resumability, or dry-run estimates. The app-server and API surface
should treat panorama creation as an expensive job with plan/apply phases and
progress events.

### Validation

There are no panorama fixture sets, golden metadata artifacts, seam-quality
checks, projection tests, memory budget tests, or UI screenshot tests tied to
this path. A professional gate needs synthetic and public fixtures with known
overlap, expected output bounds, and deterministic failure cases.

## Required Schema Fields

The first panorama artifact schema should include:

- `schemaVersion`
- `artifactId`
- `sourceImageRefs`
- `createdAt`
- `operationId`
- `operationVersion`
- `projection`
- `boundaryMode`
- `crop`
- `alignment`
- `pairwiseMatches`
- `excludedSources`
- `exposureNormalization`
- `lensCorrectionPolicy`
- `seamPolicy`
- `previewArtifacts`
- `outputColorSpace`
- `warnings`
- `validationMetrics`
- `provenance`

The schema should allow the UI and app-server agent to inspect what happened
without loading the full stitched image.

## Recommended PR Order

1. `panorama(schema): define panorama artifact schema`
   - Add Zod schema and valid/rejected samples for a panorama artifact,
     dry-run plan, and command result.
   - Keep runtime stitch behavior unchanged.
2. `panorama(projection): add projection options`
   - Add typed projection selection and preserve the selected value in the
     artifact contract.
   - It is acceptable for non-current projections to be schema-visible but
     runtime-deferred if the UI labels them clearly.
3. `panorama(boundary): add auto crop and boundary controls`
   - Add boundary/crop data model before visual UI polish.
4. `panorama(exposure): add exposure normalization`
   - Implement pre-blend tonal normalization with before/after validation
     metrics.
5. `panorama(multiraw): audit multi-row support`
   - Decide whether to extend the current graph approach or introduce an
     explicit capture-layout model.
6. `panorama(tiling): add large panorama tiling strategy`
   - Add preflight memory estimates, hard limits, and tile-backed render plan.
7. `validation(panorama): add panorama fixture set`
   - Add deterministic fixture contracts before making this a required runtime
     gate.
8. `ui(panorama): add panorama UI`
   - Add projection, crop, preview diagnostics, warnings, and retry controls.
9. `api(panorama): add panorama API tools`
   - Expose dry-run and create operations with job IDs and typed results.
10. `validation(panorama): add panorama performance tests`
    - Add stress/performance coverage for large files and memory caps.

## Acceptance Criteria For The Next Implementation PR

- The current stitcher remains available through the existing modal.
- New schema/docs work does not claim unsupported projection, tiling,
  cancellation, or editable artifact behavior as implemented.
- Any new panorama command schema supports dry-run planning before apply.
- Warnings distinguish excluded images, low inlier counts, high estimated memory
  cost, missing lens correction, and exposure mismatch.
- CI includes docs, formatting, type/schema checks as applicable, and the unsafe
  cast ban remains green.

## Validation Evidence

This audit is documentation-only. Runtime panorama behavior was inspected from
source code paths listed above. Required local checks for the PR:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
