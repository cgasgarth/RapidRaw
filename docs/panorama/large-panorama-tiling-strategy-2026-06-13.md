# Large Panorama Tiling Strategy

- Date: 2026-06-13
- Issue: #181 `panorama(tiling): add large panorama tiling strategy`
- Milestone: 11: Panorama Stitching
- Scope: tiling and memory strategy for large professional panorama outputs.

## Summary

The current stitcher renders into full in-memory float images. That is a good
prototype path, but large RAW panoramas need a preflight and tile-backed render
plan before RawEngine can claim bounded memory behavior.

Tiling should be introduced as a planned execution strategy before replacing
the current stitcher. The first PRs should add cost estimates, hard guardrails,
and artifact metadata. Runtime tiling should follow once fixture and
performance tests can prove identical or acceptable output behavior.

## Current Memory Risk

The current path can hold:

- decoded full-resolution source images as `Rgb32FImage`;
- grayscale/downscaled matching images;
- low-detail masks;
- the full output `Rgb32FImage`;
- the full output mask;
- seam cost/path matrices for overlap regions;
- preview PNG buffers.

For a 3-channel 32-bit float image, each pixel costs about 12 bytes before
masks, metadata, and allocator overhead. A 100 MP output can therefore need
roughly 1.2 GB for the panorama canvas alone. Multiple source images and seam
workspaces can push real peak memory much higher.

## Required Preflight Estimates

Before rendering, dry-run should estimate:

- source decode bytes;
- output canvas bytes;
- output mask bytes;
- low-detail mask bytes;
- seam workspace bytes;
- preview bytes;
- total estimated peak bytes;
- source count and pixel count;
- projected output dimensions;
- tile count if tiled render is selected.

Preflight should produce warnings before apply:

- `high_memory_estimate`
- `memory_budget_exceeded`
- `tiled_render_required`
- `tile_runtime_deferred`

## Dry-Run Schema Contract

The computational merge dry-run result now carries a strict preflight contract
for panorama planning:

- `parameters.memoryBudgetBytes` lets tests, app-server tools, and future UI
  flows use deterministic budgets instead of host RAM.
- `mergePlan.preflight.status` distinguishes accepted plans, warning plans,
  plan-only blocked cases, and tile-runtime-deferred blocked cases.
- `mergePlan.preflight.executionMode` records whether the plan uses the legacy
  full-frame path, plan-only metadata, or a future tile-backed render.
- `mergePlan.preflight.geometryEstimate` reports source count, source pixel
  count, output pixel count, and projected output bounds. Schema validation
  requires source count, output pixels, and projected bounds to stay consistent
  with the selected sources and output dimensions.
- `mergePlan.preflight.memoryComponents` records source decode, output canvas,
  output mask, low-detail mask, seam workspace, preview, overhead, and total
  estimated peak bytes. Schema validation requires the total to equal the
  component sum.
- `mergePlan.preflight.engineCapabilities` reports whether plan-only, legacy
  full-frame, and tile-backed render paths are available for the selected plan.
- `mergePlan.preflight.warningCodes` provides machine-readable warnings for
  the user-facing strings in `mergePlan.warnings`.
- `mergePlan.preflight.blockedReasons` must be empty for accepted plans and
  non-empty for blocked plans.

## Proposed Execution Modes

### Full Frame Legacy

Use the current full-frame stitcher only when estimated memory is below the
configured budget and output dimensions are modest.

### Plan Only

Generate artifact metadata, warnings, and preview estimates without rendering
the full output. This mode is useful for app-server dry runs and large captures
that would exceed the memory budget.

### Tile Backed Render

Render bounded output tiles with overlap padding. Each tile should know:

- tile index;
- output rectangle;
- padded source rectangle;
- participating source image refs;
- seam/feather region;
- temporary artifact handle;
- retry state.

The final panorama artifact should reference the tile manifest until the tiles
are flattened or exported.

## Initial Budget Policy

Use conservative defaults until real benchmark data exists:

- warn when estimated peak memory exceeds 25 percent of available memory;
- block full-frame render above a project-configured hard limit;
- require plan-only or tile-backed execution for very large outputs;
- keep the user-visible error recoverable, not a crash or silent cancellation.

The exact thresholds should be configurable in test fixtures so CI can validate
the policy without depending on a specific runner memory size.

## Validation Strategy

Add validation before runtime tiling:

1. Metadata-only preflight tests for large synthetic dimensions.
2. Tests that verify warnings and blocked reasons at specific budget
   thresholds.
3. Tile manifest schema sample and drift checks.
4. Small synthetic tiled render parity test against full-frame render.
5. Performance test for a generated large canvas that does not require checked
   in giant image assets.

## Runtime Boundary

This strategy does not implement tile rendering. It defines the execution modes,
budget policy, and validation order needed before large panorama rendering
becomes a required quality gate.

## Validation

This strategy is documentation-only. Required local checks for the PR:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
