# Panorama Exposure Normalization

- Date: 2026-06-13
- Issue: #179 `panorama(exposure): add exposure normalization`
- Milestone: 11: Panorama Stitching
- Scope: exposure normalization contract and validation metrics for panorama
  artifacts.

## Purpose

Exposure and white-balance mismatches create visible panorama seams. The
contract must distinguish planned normalization from implemented normalization
and must capture measurable overlap metrics before runtime behavior changes.

## V1 Contract

The v1 schema records:

- mode: `none`, `planned`, or `gain_offset_v1`;
- support: implemented by the current engine or schema-only/deferred;
- deferred reason when normalization is not implemented;
- optional per-source exposure, temperature, and tint corrections;
- optional overlap metrics for median log-luminance delta, channel-ratio delta,
  and clipping increase;
- skipped reason when overlap or alignment quality is insufficient.

## Runtime Boundary

This contract does not modify the current stitcher. The first runtime
implementation should prove improvement with fixture metrics before enabling
automatic correction in normal editing flows.

## Validation

Required local checks:

- `bun run schema:check`
- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`

Issue #1929 adds `bun run check:panorama-seam-exposure-proof`, which records
seam delta, overlap size, exposure compensation residual, and output hashes at
`docs/validation/proofs/panorama-extra/panorama-seam-exposure-proof-2026-06-18.json`.
