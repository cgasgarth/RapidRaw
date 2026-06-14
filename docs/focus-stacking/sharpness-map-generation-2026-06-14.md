# Focus Stack Sharpness Map Generation

Date: 2026-06-14
Scope: GitHub issue #189, focus stack sharpness map generation

## Purpose

The sharpness map decides which source slice contributes detail at each region
of a focus stack. It must favor true focus detail, avoid texture hallucination,
and expose enough artifacts for review, retouch, and future agent tooling. This
contract defines the first generation path before runtime kernels land.

## Inputs

Required inputs:

- aligned focus slices in a common preview coordinate space;
- source indexes preserved from the command envelope;
- source content hashes and graph revisions;
- output crop/bounds from alignment;
- optional focus distance metadata;
- working luminance in the linear preview pipeline.

Optional inputs:

- lens metadata for focus breathing diagnostics;
- user-provided preferred base slice;
- rejected-source list from alignment;
- per-source alignment confidence.

## Map Stages

### 1. Luminance Pyramid

Generate a luminance pyramid for each usable source slice. The first runtime
path should use preview-resolution data and record the scale level used for map
generation.

Rules:

- compute in a linear working space;
- avoid saturated pixels as strong sharpness evidence;
- clamp noisy low-signal regions before gradient evaluation;
- preserve per-source source index in every intermediate map.

### 2. Local Focus Measure

The initial focus measure should combine:

- Laplacian energy for edge acuity;
- gradient magnitude for broader texture;
- local contrast normalization to avoid favoring exposure differences;
- saturation and noise penalties.

The output is a per-source candidate sharpness map with confidence values from
0 to 1.

### 3. Winner Selection

Select the winning source per region by comparing normalized focus measures.
The map should store:

- winning source index;
- confidence margin over the second-best source;
- low-confidence regions;
- regions requiring retouch review.

Tie handling:

- prefer the nearest neighboring stable source region;
- prefer source order only as a final deterministic tie-breaker;
- mark low-confidence regions for review when tie area exceeds threshold.

### 4. Spatial Regularization

Regularization should remove isolated speckles without flattening real detail.

Allowed first-pass operations:

- small median filtering on winner IDs;
- edge-aware smoothing of confidence;
- morphology for tiny islands;
- connected-component cleanup below a documented area threshold.

Not allowed initially:

- neural detail synthesis;
- non-deterministic segmentation;
- regularization that changes source winners without retaining before/after map
  artifacts.

### 5. Retouch Seed Generation

When confidence is low near important edges, the map should seed a retouch layer
instead of silently blending. Retouch seeds should include:

- source index candidate;
- confidence;
- local reason code;
- preview mask artifact;
- recommended review priority.

## Artifact Outputs

Sharpness-map generation should produce these artifact handles when runtime
support lands:

- `sharpnessMapArtifact`: normalized focus-confidence map;
- `depthConfidenceMapArtifact`: winner/source-index confidence proxy;
- optional `retouchLayerArtifact`: editable corrections for ambiguous regions;
- preview overlay artifact for UI QA.

The focus stack artifact schema records these handles and validation metrics.

## Warning Codes

Sharpness-map warning conditions:

- low focus coverage;
- source order unverified;
- parallax detected near high-confidence boundaries;
- retouch layer required;
- high memory or runtime estimate;
- human review required.

Warnings must be stable across dry-run and apply for the same source hashes and
graph revisions.

## Validation Plan

Synthetic validation:

- three-slice chart with known foreground, midground, and background planes;
- low-texture area that should not create false winners;
- saturated highlight that should be penalized;
- repeated texture region to test tie behavior.

Real-photo validation:

- macro product label;
- natural texture with fine detail;
- parallax/motion stress bracket;
- high-ISO optional variant.

Metrics:

- focus coverage ratio;
- low-confidence area ratio;
- rejected-source count;
- retouch-required area;
- map stability under repeated runs;
- preview runtime and peak memory.

Review checks:

- sharpness overlay aligns with visible detail;
- winner transitions do not halo;
- retouch seeds appear only in ambiguous regions;
- no source is silently excluded.

## Out Of Scope

This document does not implement the focus measure, pyramid, GPU kernels,
runtime artifacts, UI overlays, or retouch editing. Those should land in later
PRs against this contract.
