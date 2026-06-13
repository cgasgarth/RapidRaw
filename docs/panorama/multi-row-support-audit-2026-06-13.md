# Panorama Multi-Row Support Audit

- Date: 2026-06-13
- Issue: #180 `panorama(multiraw): audit multi-row support`
- Milestone: 11: Panorama Stitching
- Scope: audit whether the current RapidRAW panorama stitcher can be treated as
  multi-row capable and define the next architecture boundary.

## Summary

The current RapidRAW stitcher should not be treated as a supported multi-row
panorama engine yet. It can build a connected graph from pairwise image matches,
but it does not model capture layout, rows, columns, focal length, field of
view, horizon, projection family, bundle adjustment, or manual match recovery.

That graph behavior is useful groundwork because it can exclude disconnected
images and avoid assuming a simple left-to-right sequence. It is not enough for
professional multi-row support, where a user expects stable geometry,
predictable projection, editable output, recoverable warnings, and validation
against known row/column layouts.

## Current Behavior

The current stitcher:

- compares every image pair;
- accepts pairwise matches that meet the inlier threshold;
- sorts match graph edges by inlier count;
- builds a strongest-edge spanning tree;
- traverses the connected component to compute global homographies;
- excludes images outside the selected connected component;
- warps the selected component into one output canvas.

This means a multi-row capture can sometimes produce an output if enough
overlapping pairs are found and the planar homography assumptions hold. That is
best described as opportunistic graph stitching, not supported multi-row
stitching.

## Missing Multi-Row Concepts

Professional multi-row support needs explicit model fields for:

- capture layout: unknown, single row, multi-row, grid, handheld freeform;
- optional row and column hints per source;
- source ordering and manual reorder overrides;
- focal length or field-of-view hints;
- lens correction and perspective preconditions;
- projection choice and effective projection;
- horizon/level policy;
- connected components and rejected edges;
- bundle or global optimization status;
- output bounds and crop confidence;
- validation metrics for row consistency and graph health.

## Risks In The Current Approach

### Geometry Overclaim

A connected pairwise graph can look successful even when geometry is poor.
Without reprojection RMS/p95, homography sanity checks, and output-bounds
validation, the app can overclaim support for captures with parallax,
wide-angle distortion, weak overlap, or repeated structures.

### No Capture Layout

The current graph does not know whether an image belongs to row 1, row 2, or an
unrelated branch. This makes UI diagnostics and manual recovery hard.

### Projection Ambiguity

Multi-row outputs usually need explicit projection assumptions. A planar
homography output can be acceptable for narrow scenes, but cylindrical or
spherical projections require additional camera and lens assumptions.

### Memory Growth

Multi-row captures increase source count and output canvas area. The current
full-float source and output allocation strategy can exceed memory quickly.

### Validation Gap

There are no synthetic or real fixture sets that prove row/column consistency,
disconnected-source handling, or output bounds for multi-row captures.

## Recommended V1 Boundary

V1 should introduce a multi-row capture model before claiming support:

- `captureLayout`: `unknown`, `single_row`, `multi_row`, `grid`, `freeform`;
- `sourceLayoutHints`: optional row, column, yaw/pitch order, and user sort
  index;
- `componentSelection`: selected connected component and excluded components;
- `globalOptimization`: `not_run`, `planned`, `bundle_adjustment_v1`;
- `projectionPreconditions`: focal length, lens correction, horizon policy,
  and field-of-view confidence;
- `validationMetrics`: graph connectivity, reprojection RMS/p95, output bounds,
  overlap coverage, and row consistency score.

Runtime can initially keep using the existing homography stitcher while marking
multi-row capture layout as `planned` or `low_confidence` when the required
metrics are missing.

## Recommended PR Order

1. Add multi-row layout fields to the panorama artifact schema.
2. Add a dry-run preflight that reports graph connectivity, components, and
   suspected layout without rendering the full output.
3. Add synthetic grid fixtures with known source row/column positions.
4. Add warnings for weak multi-row evidence, disconnected components, and
   geometry overclaim.
5. Add UI diagnostics showing selected component, excluded images, and layout
   confidence.
6. Add real projection/runtime changes only after fixture metrics can
   distinguish single-row, multi-row, and freeform captures.

## Validation

This audit is documentation-only. Required local checks for the PR:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
