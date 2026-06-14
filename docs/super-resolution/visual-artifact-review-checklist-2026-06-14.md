# Super-Resolution Visual Artifact Review Checklist

Date: 2026-06-14
Scope: GitHub issue #206, visual artifact review checklist

## Purpose

Super-resolution validation must catch local failures that whole-image sharpness
metrics hide. This checklist defines the review evidence future SR runtime PRs
must capture before claiming professional output quality.

## Required Review Artifacts

Each runtime PR that changes SR output quality should attach or generate:

- source manifest with file IDs, source hashes, source graph revisions, capture
  notes, and selected frames;
- dry-run summary with requested/effective scale, detail policy, alignment mode,
  warning codes, block codes, and validation summary;
- final output dimensions, output artifact hash, and output color space;
- 100 percent crop sheet comparing source, baseline upscale, SR output, and
  optional confidence/support overlay;
- 200 percent crop sheet for edge inspection;
- full-frame downscaled overview with crop locations marked;
- local confidence/support map when the algorithm produces one;
- rejected-frame or low-contribution-frame list when applicable;
- timing and peak-memory notes once runtime measurement exists.

## Crop Categories

Minimum crop categories:

- resolution chart line pairs, Siemens star/radial wedges, slanted edges, and
  checkerboard regions;
- text, signs, labels, repeated architectural detail, and diagonal edges;
- skin, hair, fabric, foliage, grass, bark, and other natural textures;
- high-ISO noise, flat gradients, shadow detail, and low-contrast texture;
- motion boundaries, parallax boundaries, moving subjects, and frame edges;
- saturated highlights, clipped channels, chromatic edges, and demosaic stress
  regions.

## Failure Modes To Mark

Reviewers must explicitly mark whether each category shows:

- invented repeated structure or hallucinated texture;
- sharpening halos, ringing, stair stepping, zippering, or aliasing;
- moire amplification or false color;
- ghosting, doubled edges, misregistration, or local warping;
- texture plasticity, waxy skin, smeared foliage, or fabric pattern collapse;
- noise clumping, denoise-overdetail tradeoff, or chroma speckle amplification;
- seam artifacts, crop-boundary artifacts, or stretched edge content;
- preview/final mismatch that would mislead the user.

## Pass And Block Rules

Pass:

- conservative mode improves or preserves detail without invented structure;
- warnings are visible and stable;
- rejected frames or downgraded scale are explained by the dry-run summary;
- source hashes, graph revisions, scale, mode, alignment, engine version, and
  output artifact provenance match the applied result.

Block:

- text, line pairs, repeated texture, or facial detail contains invented
  structure in professional/conservative output;
- alignment confidence is low and no downgrade or block reason is shown;
- aggressive/model-backed detail reaches final apply without explicit user
  intent, model provenance, and visible disclosure;
- source state changed after dry-run and apply still succeeds;
- final output lacks durable artifact provenance or stale-state behavior.

## Evidence Template

Use this template in PR descriptions or linked review artifacts:

```markdown
## SR Visual Review Evidence

- Mode:
- Detail policy:
- Requested scale:
- Effective scale:
- Source count:
- Source manifest:
- Dry-run plan ID/hash:
- Output dimensions:
- Output artifact hash:
- Crop sheet:
- Confidence/support map:
- Rejected or downgraded frames:
- Warnings/block codes:
- Runtime/peak memory:
- Reviewer:
- Result: pass / blocked / needs follow-up
- Notes:
```

## Current Status

This checklist does not add image fixtures, runtime SR processing, or CI image
comparison jobs. It defines the review contract that those future PRs must
populate.
