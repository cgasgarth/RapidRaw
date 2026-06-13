# Panorama Artifact Schema

- Date: 2026-06-13
- Issue: #176 `panorama(schema): define panorama artifact schema`
- Milestone: 11: Panorama Stitching
- Scope: v1 schema contract for editable panorama artifacts.

## Purpose

The panorama artifact schema makes panorama outputs inspectable before the
runtime stitcher is upgraded. It captures source image references, projection
intent, boundary/crop policy, pairwise alignment evidence, exposure
normalization state, lens correction policy, seam policy, previews, output
artifacts, warnings, and validation metrics.

This is intentionally a contract PR. It does not change the current
`stitch_panorama` Rust command, add projection math, create tiled rendering, or
replace the current modal.

## V1 Boundaries

The v1 schema includes:

- source image references with RAW-default and lens-correction state;
- engine identity, quality tier, and capability flags;
- projection intent;
- boundary settings, boundary mode, and crop rectangle;
- pairwise homography summaries;
- exposure normalization status and overlap metrics;
- seam policy;
- output and preview artifact handles;
- provenance fields for command/app-server replay;
- warning codes for excluded sources, low inliers, memory risk, lens correction,
  exposure mismatch, and runtime-deferred controls;
- validation metrics for source count, stitched count, output dimensions,
  estimated peak memory, reprojection error, overlap coverage, and seam energy.

The v1 schema defers:

- runtime projection implementation beyond the current stitcher;
- tiled rendering;
- cancellation/job execution;
- UI controls;
- OpenCV/Hugin-grade optimizer integration;
- fixture-backed quality metrics beyond the schema sample.

## Validation

The schema is validated by:

- `packages/rawengine-schema/src/rawEngineSchemas.ts`
- `packages/rawengine-schema/src/samplePayloads.ts`
- `packages/rawengine-schema/scripts/check-samples.ts`
- `packages/rawengine-schema/scripts/check-sample-artifacts.mjs`
- `packages/rawengine-schema/samples/panorama-artifact-v1.json`

Required local checks:

- `bun run schema:check`
- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
