# Focus Stack RAW Normalization And Color Policy

Date: 2026-06-14
Issue: #1057 `docs(focus): define RAW normalization and color policy`
Scope: focus stack source normalization, working pixels, focus scoring, and
validation expectations before runtime focus-map work consumes decoded images.

## Purpose

Focus stacking should choose source slices because the subject detail is in
focus, not because one slice is brighter, noisier, warmer, more saturated, or
more clipped than another. This policy defines the pixel state that focus-stack
alignment and sharpness-map generation may consume.

The policy is intentionally conservative. It does not claim final Capture
One-class RAW development quality; it defines a repeatable input contract so
future runtime PRs can prove that focus scores are based on focus evidence.

## Pipeline Position

Focus stack analysis runs after source discovery and before user-visible
creative rendering.

Required order:

1. Load source refs and verify source hashes, graph revisions, orientation, and
   source roles.
2. Decode each source into a common analysis state using the same RAW defaults
   and preprocessing policy.
3. Normalize exposure and neutral balance only for analysis.
4. Build alignment luminance and sharpness luminance from the normalized
   linear data.
5. Produce dry-run artifacts, warnings, block reasons, and provenance.
6. Apply only from an accepted dry-run plan whose source hashes and graph
   revisions still match.

Creative color edits, film looks, LUTs, display transforms, output profiles,
vignettes, grain, halation, and local adjustment layers are not focus-scoring
inputs. They may render after the derived focus-stack artifact enters the normal
non-destructive graph.

## Source Eligibility

Every source slice used for focus analysis must provide:

- stable source index from the command envelope;
- immutable content hash or equivalent source identity;
- current graph revision for source settings that affect decoded pixels;
- normalized orientation and crop basis;
- source role `focus_slice`;
- decode/preprocess settings recorded in provenance;
- output bounds and preview scale for analysis artifacts.

Block apply when:

- source roles are mixed;
- fewer than two usable focus slices remain;
- source graph revisions change after dry-run acceptance;
- source dimensions or orientation cannot be reconciled;
- RAW preprocessing policy differs between slices without an explicit, recorded
  reason;
- a required input profile or demosaic/decode setting is missing from
  provenance.

## Working Data State

The first focus runtime path should operate on preview-resolution linear RGB in
a documented scene-referred working space. The exact future project working
space may change, but each runtime result must record:

- decoder and version;
- demosaic path or non-RAW decode path;
- input profile or camera profile identifier when available;
- white-balance source;
- exposure normalization values;
- preview scale and dimensions;
- working-space identifier;
- clipping thresholds;
- noise and saturation penalty parameters.

Do not score focus from display-referred sRGB, tone-mapped previews, gamma-coded
JPEG thumbnails, or post-creative rendered pixels unless the command explicitly
marks the source as a non-RAW fallback and the dry run reports that limitation.

## Exposure Policy

Exposure differences across slices can bias gradients and Laplacian energy. The
focus analysis path should normalize exposure before focus scoring.

Required behavior:

- estimate an analysis exposure offset per source from robust midtone
  statistics, not highlights;
- ignore clipped pixels while estimating exposure offsets;
- keep the original source exposure values in provenance;
- store the analysis exposure offset separately from user-visible edit
  exposure;
- cap automatic exposure correction and warn when correction exceeds the cap.

Exposure normalization is analysis-only. It must not silently change source
edits or the rendered output look.

Warnings:

- `focus_exposure_mismatch`
- `focus_exposure_normalization_capped`
- `focus_low_midtone_support`

## White Balance And Neutral Policy

White balance should not decide focus winners. The analysis path should compare
slices in a neutralized luminance basis.

Required behavior:

- prefer consistent camera/as-shot white balance across all slices when present;
- when white balance differs, derive a neutral analysis transform and record it;
- compute focus luminance from normalized linear RGB after neutral balance;
- warn when neutral balance estimates disagree materially across slices;
- never apply analysis white-balance normalization as a user-visible edit.

Warnings:

- `focus_white_balance_mismatch`
- `focus_neutral_balance_low_confidence`
- `focus_mixed_illuminant_risk`

## Luminance Policy

Alignment and sharpness maps should use luminance derived from normalized linear
RGB. The first implementation may use a simple documented luminance transform,
but the transform must be stable and recorded in runtime metadata.

Rules:

- use the same luminance transform for every source in a stack;
- compute gradients and focus measures from linear luminance;
- avoid hue or saturation as focus evidence;
- preserve per-source indexes through every intermediate map;
- report the preview scale used for each map.

If runtime later adds a perceptual or opponent-space focus measure, it must land
behind a separate validation issue with CPU/GPU parity and fixture evidence.

## Saturation And Clipping Policy

Saturated pixels are poor focus evidence because sharp clipped edges can score
high while containing no recoverable texture.

Required behavior:

- detect per-channel and luminance clipping before focus scoring;
- reduce focus confidence in clipped regions;
- avoid selecting winners based solely on clipped specular highlights;
- expose clipped-region overlays or artifact handles when clipping affects a
  material part of the image;
- warn or block when clipped area makes focus confidence unreliable.

Warnings:

- `focus_saturation_penalty_applied`
- `focus_clipped_highlight_risk`
- `focus_clipped_shadow_risk`

## Noise Policy

Noise can produce false high-frequency energy. Focus scoring must penalize
low-signal and high-noise regions.

Required behavior:

- estimate local signal level before gradient or Laplacian scoring;
- suppress focus evidence in very dark low-signal regions;
- avoid aggressive denoise that changes true edge ordering;
- record noise penalty parameters in dry-run metadata;
- flag high-ISO or underexposed slices when metadata or statistics show risk.

Warnings:

- `focus_noise_penalty_applied`
- `focus_low_signal_region`
- `focus_high_iso_risk`

## Confidence Maps Are Not Metric Depth Maps

Focus confidence maps are source-winner and confidence artifacts. They are not
metric depth maps, physical distance maps, or guaranteed subject segmentation.

UI, API, and agent language must use terms such as:

- focus confidence;
- source winner;
- slice confidence;
- ambiguous region;
- retouch review region.

Avoid user-visible claims such as:

- depth map;
- distance map;
- subject depth;
- geometry reconstruction.

The schema may keep planned `depth_map` blend options, but apply-ready depth-map
behavior stays gated until real fixture validation proves stable behavior across
macro/product, natural texture, and parallax stress cases.

## Provenance Requirements

Dry-run and apply results should preserve:

- source refs, source hashes, and graph revisions;
- decode and profile settings;
- analysis exposure and neutral-balance offsets;
- luminance transform identifier;
- clipping and noise penalty settings;
- rejected source list and reasons;
- warning/block codes;
- preview dimensions and map scale;
- dry-run plan id and hash;
- runtime/backend version when implemented.

Any runtime artifact that omits these values is review-only and must not be used
as an apply-ready quality claim.

## Validation Requirements

Tier 0 documentation and schema validation:

- docs link validation;
- plan/index breadcrumb updated;
- no runtime quality claim.

Tier 1 deterministic fixture validation:

- generated three-slice fixture with known foreground, midground, and
  background winners;
- exposure mismatch variant that does not change winners after normalization;
- white-balance mismatch variant that does not change winners after
  neutralization;
- clipped highlight region that is penalized;
- low-signal noisy region that is penalized.

Tier 2 real fixture validation:

- macro/product bracket with labels or fine texture;
- real RAW-derived sources with consistent camera metadata;
- high-ISO or underexposed optional stress;
- specular highlight stress;
- manual review of focus confidence overlays and final blend crops.

Tier 3 promotion requirements:

- CPU/GPU parity for luminance, penalties, and focus scores;
- stable warning codes for repeated dry runs;
- peak memory and runtime reporting;
- documented behavior for non-RAW fallback sources.

## Implementation Notes

- The plan-only preflight issue should emit the policy fields before running a
  real focus kernel.
- The synthetic fixture generator should include exposure, white-balance,
  clipping, and noise variants.
- The first sharpness smoke should prove winner stability before any UI claims
  that the stack is all-in-focus.
- App-server focus tools should surface policy warnings in dry-run output and
  require an accepted dry-run plan before apply.

## Out Of Scope

This document does not implement RAW decoding, demosaic selection, camera
profiles, focus kernels, GPU shaders, fixture downloads, UI overlays, or
renderer changes. Those should land in follow-up PRs against this policy.
