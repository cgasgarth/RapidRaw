# Panorama Projection Options

- Date: 2026-06-13
- Issue: #177 `panorama(projection): add projection options`
- Milestone: 11: Panorama Stitching
- Scope: projection option contract for panorama artifacts and future UI/API
  controls.

## Purpose

Projection options need to be visible in the artifact contract before the
runtime stitcher implements every projection. This prevents the UI, app-server
agent, and sidecar metadata from treating deferred projections as rendered
features.

## V1 Projection Choices

The v1 schema names these projection intents:

- `rectilinear`
- `cylindrical`
- `spherical`
- `planar`

Each artifact records:

- `requestedProjection`: what the user or API requested;
- `effectiveProjection`: what the current engine actually rendered or planned;
- `support`: whether the projection is implemented by the current engine or
  schema-only/deferred;
- optional field-of-view and focal-length hints;
- `deferredReason` when a requested projection is not implemented by the current
  engine.

## Runtime Boundary

This contract does not add cylindrical or spherical projection math. The current
RapidRAW stitcher remains a homography/seam engine. Runtime projection work
should land only after preflight metrics, output bounds, lens-correction policy,
and fixtures can validate the result.

## Validation

Required local checks:

- `bun run schema:check`
- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
