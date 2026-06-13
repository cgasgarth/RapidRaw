# Panorama Boundary Controls

- Date: 2026-06-13
- Issue: #178 `panorama(boundary): add auto crop and boundary controls`
- Milestone: 11: Panorama Stitching
- Scope: boundary/crop control contract for panorama artifacts and future UI/API
  controls.

## Purpose

Boundary controls determine what happens to empty canvas areas created by
warped panorama sources. The current stitcher computes an output canvas and can
record an auto crop, but professional editing needs explicit requested and
effective boundary behavior.

## V1 Boundary Choices

The v1 schema names these boundary modes:

- `auto_crop`
- `transparent`
- `manual_crop`
- `deferred_fill`

Each artifact records:

- `requestedMode`: what the user or API requested;
- `effectiveMode`: what the current engine actually planned or rendered;
- `support`: whether the current engine implements the mode or the mode is
  schema-only/deferred;
- `crop`: the authoritative crop rectangle;
- optional RGBA `fillColor`;
- `deferredReason` when requested behavior is not implemented.

## Runtime Boundary

This contract does not implement content-aware fill, tile-backed boundary fill,
or new crop UI. Runtime work should land after output bounds and memory
preflight metrics are fixture-tested.

## Validation

Required local checks:

- `bun run schema:check`
- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
