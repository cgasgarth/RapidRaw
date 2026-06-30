# Focus Stack Alignment Path

Date: 2026-06-14
Scope: GitHub issue #188, focus stack alignment path

## Purpose

Focus stack alignment must correct small camera movement and focus breathing
without inventing detail, hiding parallax failures, or making apply decisions
that cannot be reproduced later. This contract defines the staged alignment
path that runtime, UI, API, and agent work should implement against.

## Alignment Stages

### 1. Source Normalization

Source normalization must follow the
[Focus Stack RAW normalization and color policy](raw-normalization-color-policy-2026-06-14.md)
before alignment features are detected.

Inputs:

- ordered focus slices with stable source indexes;
- source content hashes and graph revisions;
- lens/camera metadata when available;
- preview-resolution linear working pixels;
- optional focus distance metadata.

Required behavior:

- reject mixed source roles before alignment;
- preserve original slice order separately from any rejected-source list;
- normalize orientation, crop basis, raw default state, and working color space;
- keep focus distance as advisory metadata only.

### 2. Global Registration

Default path:

- detect multi-scale features on preview-resolution luminance;
- estimate translation first;
- promote to homography only when feature coverage is broad enough;
- keep the chosen transform per source and per preview scale;
- report alignment confidence from inlier ratio, feature coverage, and residual
  error.

Fallback behavior:

- allow `none` only for tripod-controlled brackets or explicit user override;
- downgrade to translation when homography support is weak;
- block apply when residual error exceeds the artifact policy threshold.

### 3. Focus Breathing Compensation

Focus breathing can shift scale and field of view across slices. The first
implementation should treat breathing as a constrained geometric correction:

- estimate small scale changes around the image center;
- prefer crop-preserving transforms over content filling;
- expose warning codes when compensation reduces usable output bounds;
- avoid non-rigid warps until a dedicated validation suite exists.

### 4. Local Alignment Readiness

Local alignment is schema-planned but not apply-ready in the first runtime
slice. It becomes eligible only after fixtures prove:

- boundary stability on macro/product brackets;
- texture preservation on natural detail;
- parallax warnings on foreground/background stress scenes;
- deterministic rejected-source decisions;
- no false sharpness introduced near high-contrast edges.

### 5. Rejected Source Handling

Sources may be excluded from the blend when alignment cannot be trusted. A
rejected source must record:

- source index;
- reason code;
- measured confidence or residual when available;
- whether the source is excluded from final blend, preview only, or requires
  user review.

Rejected sources must never be silently dropped from provenance.

## Warning And Block Codes

Alignment warnings:

- `alignment_low_confidence`
- `parallax_detected`
- `source_order_unverified`
- `high_memory_estimate`
- `runtime_estimate_high`

Initial block reasons:

- missing source hashes;
- mixed source roles;
- duplicate source indexes;
- insufficient overlap;
- high residual error after registration;
- rejected-source count leaves fewer than two usable slices;
- stale source graph revision after accepted dry run.

## Artifact Requirements

The focus stack artifact must preserve:

- requested and resolved alignment mode;
- source image refs;
- source content hashes and graph revisions;
- rejected source indexes;
- focus coverage ratio;
- parallax risk;
- alignment confidence when measured;
- output, preview, sharpness-map, confidence-map, and optional retouch-layer
  artifacts.

The artifact schema is the contract boundary for UI, API, sidecar persistence,
and agent tool calls.

## Validation Plan

Fast validation:

- schema samples for focus stack source-state coverage;
- fixture manifest checks for source count and provenance;
- dry-run command validation for `focus_slice` roles;
- stale-source negative tests once apply commands exist.

Runtime validation:

- synthetic three-slice translation fixture;
- macro bracket with small focus breathing;
- natural texture bracket for false sharpness;
- parallax/motion stress fixture that requires warnings or apply blocking.

Issue #1938 adds `bun run check:focus-alignment-sharpness-proof`, which combines
the translation alignment smoke with the sharpness-map artifact report and
persists hashes at
`docs/validation/proofs/focus/focus-alignment-sharpness-proof-2026-06-18.json`.

Manual QA:

- overlay before/after alignment;
- inspect rejected-source explanations;
- inspect sharpness map boundaries;
- verify retouch layer presence when policy requests one;
- confirm output crop and bounds remain explainable.

## Out Of Scope

This document does not implement image registration, GPU kernels, optical-flow
alignment, fixture downloads, or UI controls. Those should land as separate PRs
after the artifact schema and fixture policy are merged.
