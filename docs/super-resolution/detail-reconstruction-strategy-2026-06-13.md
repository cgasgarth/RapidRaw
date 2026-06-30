# Super-Resolution Detail Reconstruction Strategy

- Date: 2026-06-13
- Issue: #200 `sr(detail): add detail reconstruction strategy`
- Milestone: 13: Super-Resolution
- Scope: conservative detail reconstruction contract after alignment.

## Decision

RawEngine super-resolution detail reconstruction must separate supported
sampling improvement from synthetic detail. The conservative path can increase
useful resolution only where source evidence, alignment confidence, and fixture
validation support it. It must degrade to lower scale, warn, or block when the
requested scale would require invented content.

This strategy is downstream of the multi-image alignment path. Reconstruction
must consume an accepted dry-run plan with accepted/rejected frames, resolved
alignment mode, confidence metrics, and memory estimates before it writes a
durable artifact.

## Reconstruction Tiers

### Conservative

Allowed:

- multi-frame sample accumulation from accepted aligned frames;
- demosaic-aware or edge-aware resampling;
- modest deconvolution or sharpening bounded by chart/real-photo gates;
- noise-aware detail preservation where source support is present;
- local fallback to baseline upscale where support is weak.

Forbidden:

- semantic hallucination;
- model fallback;
- invented text, product markings, skin pores, eyelashes, foliage, fabric weave,
  license plates, or periodic chart structure;
- applying aggressive detail behavior through missing or unknown settings.

### Standard

Allowed only after conservative gates exist:

- stronger local reconstruction when confidence and support maps agree;
- learned priors if visibly labeled and recorded;
- higher review burden for text, faces, product surfaces, and repeating
  patterns.

### Aggressive

Aggressive reconstruction is creative/restoration output. Until a separate apply
contract exists, it remains preview-only and must not write a final derived
asset.

## Reconstruction Inputs

The reconstruction stage requires:

- accepted dry-run plan ID and hash;
- effective policy/detail mode;
- output scale requested and output scale effective;
- selected reference frame;
- accepted source frames and rejected source frames;
- per-frame transforms or flow references;
- local confidence/support map when produced;
- source color, RAW default, and lens-correction assumptions;
- memory and runtime budget.

If any required input changed since dry-run, apply must block and request a new
dry-run.

## Local Support Rules

The conservative renderer should classify output regions:

- `supported`: enough aligned samples and texture evidence for reconstruction.
- `weak_support`: use safer scale, baseline upscale, or reduced sharpening.
- `motion_rejected`: avoid accumulating moving subject detail.
- `edge_risk`: avoid overshoot, ringing, doubled edges, and false text.
- `flat_or_noise`: preserve natural noise/tonality without inventing texture.

Local support classification should be persisted as metrics or artifact handles
so UI review, sidecars, and app-server tools can explain why a result was
accepted, downgraded, warned, or blocked.

## Detail Controls

The first user/API controls should be limited:

- policy mode;
- requested scale;
- quality preference;
- alignment mode;
- conservative detail strength, if exposed, with a narrow bounded range;
- fallback behavior for weak regions.

Advanced model or hallucination-oriented controls are out of scope for the
conservative path.

## Validation Gates

Detail reconstruction changes must include:

- chart fixture comparison against baseline upscale;
- false-detail review on line-pair, Siemens star/radial, text, checkerboard,
  diagonal, moire, and flat/noise regions;
- real-photo crop comparisons for skin/hair, foliage, fabric, architecture/text,
  high ISO noise, and motion;
- 100 percent and 200 percent crop sheets;
- support/confidence overlay or equivalent artifact;
- memory/time estimate and observed runtime when runtime exists;
- sidecar roundtrip preserving effective scale, mode, reconstruction method, and
  validation summary.

Conservative reconstruction should fail closed when apparent detail gain is
mostly sharpening halo, aliasing, ringing, or repeated invented structure.

## Artifact Fields

Future `SuperResolutionArtifactV1` records should include:

- reconstruction method and version;
- requested/effective scale;
- requested/effective detail mode;
- local support artifact handles;
- contribution map or accepted-frame map when available;
- detail strength settings;
- false-detail metric summary;
- downgrade reason when effective scale is lower than requested;
- model provenance fields when any non-conservative model path is used.

## Deferred Work

This document does not implement the renderer, GPU path, model path, UI review
pane, or app-server tools. It defines the reconstruction contract that those
future PRs should preserve.

## Validation Commands

Required local checks for this slice:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`

Issue #1940 adds `bun run check:sr-alignment-detail-proof`, which records
declared pixel-shift alignment, before/after dimensions, MAE/detail deltas, and
the synthetic report hash at
`docs/validation/proofs/super-resolution/super-resolution-alignment-detail-proof-2026-06-18.json`.
