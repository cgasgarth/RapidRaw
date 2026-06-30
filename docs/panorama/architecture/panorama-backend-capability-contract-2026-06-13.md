# Panorama Backend Capability Contract

- Date: 2026-06-13
- Issue: #993 `panorama(adapter): define backend capability contract`
- Milestone: 11: Panorama Stitching
- Scope: typed capability report for panorama backends.

## Summary

RawEngine needs one panorama capability vocabulary for UI, API, app-server
tools, artifacts, and validation. The app should not expose OpenCV, Hugin, or
legacy RapidRaw implementation structs directly to higher layers.

This contract adds `PanoramaBackendCapabilityReportV1`, a Zod schema that
describes backend support in RawEngine terms before any backend-specific
adapter is promoted.

## Contract Shape

The report records:

- backend ID and version;
- current status, quality tier, and macOS packaging status;
- supported projections, boundary modes, seam methods, blend modes, and
  exposure modes;
- the existing core `PanoramaEngineCapabilitiesV1` boolean matrix;
- conservative source, memory, and output-pixel limits;
- runtime external-library requirements;
- required-CI eligibility and blockers;
- schema-boundary guarantees that backend types do not leak into artifacts.

## Boundary Rules

Backends must translate their native capabilities into RawEngine names:

- OpenCV `cv::Mat`, Stitcher, Blender, SeamFinder, and ExposureCompensator
  types stay inside an OpenCV adapter.
- Hugin or Panorama Tools concepts stay inside a future reference adapter.
- UI and app-server tools only consume RawEngine enum values from this schema.
- Derived panorama artifacts continue to use RawEngine artifact fields and
  never store backend-native structs.

## CI And Packaging Invariants

The schema rejects:

- reports where backend-native types are allowed to leak into artifacts;
- external-library backends that fail to name their libraries;
- external-library backends that claim no macOS packaging work is required;
- external-library backends promoted into required CI before bundled packaging
  proof exists;
- default-enabled backends that are not allowed in required CI.

This keeps OpenCV and other future backends behind a clear opt-in path until
their packaging and validation evidence is strong enough.

## Validation

The contract is validated by:

- `packages/rawengine-schema/src/rawEngineSchemas.ts`
- `packages/rawengine-schema/src/samplePayloads.ts`
- `packages/rawengine-schema/scripts/check-samples.ts`
- `packages/rawengine-schema/scripts/check-sample-artifacts.ts`
- `packages/rawengine-schema/samples/panorama/panorama-backend-capability-report-v1.json`

Required local checks:

- `bun run schema:check`
- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
