# Super-Resolution Mode Taxonomy

Date: 2026-06-14
Scope: GitHub issue #197, single-image and multi-image mode definition

## Goals

RawEngine supports super-resolution as a professional computational photography
feature, not as an unbounded generative enhancement. Modes must make their source
evidence, detail policy, provenance, and validation expectations explicit so UI,
app-server tools, and future runtime backends cannot silently diverge.

## Mode Families

### Multi-Image Burst SR

Multi-image burst SR is the default professional mode.

Inputs:

- Two or more related source frames with `sr_frame` source roles.
- Source image references, content hashes, source graph revisions, RAW defaults
  state, and optional virtual-copy IDs.
- Alignment mode, requested/effective scale, detail policy, quality preference,
  and memory budget.

Behavior:

- Dry-run estimates alignment, overlap, expected detail gain, output dimensions,
  memory, runtime, warning codes, and block codes.
- Apply requires an accepted dry-run plan ID and hash, approved edit-apply
  approval, unchanged source hashes/revisions, and durable derived artifact
  provenance.
- Conservative mode reconstructs detail only from source evidence and fails
  closed when alignment, texture, or provenance is weak.

Validation:

- Resolution chart crops, real-photo crops, confidence/support map, source
  manifest, output dimensions, 100 percent and 200 percent comparisons, and
  timing/memory observations once runtime exists.

### Panorama-Style SR

Panorama-style SR uses overlapping shifted frames where the output may increase
detail and field of view.

Inputs:

- Source frames with meaningful overlap and known source indexes.
- Alignment mode capable of perspective or local deformation where appropriate.
- Boundary/crop strategy once runtime supports output bounds.

Behavior:

- Dry-run must separate detail-gain confidence from field-of-view expansion.
- Apply must record the accepted crop/output bounds, rejected-frame reasons,
  overlap coverage, alignment confidence, and source-state provenance.
- If the runtime cannot distinguish panorama expansion from true detail gain, it
  must downgrade to a conservative output or block apply.

Validation:

- Same evidence as multi-image burst SR, plus overlap/bounds review and artifact
  notes for seams, warped edges, repeated texture, and parallax failures.

### Single-Image SR

Single-image SR is deferred until RawEngine has an explicit model-backed or
deterministic upscale strategy with visible labeling and provenance.

Inputs:

- One source image and its source content hash/graph revision.
- Explicit mode that distinguishes deterministic upscale from generated-detail
  restoration.

Behavior:

- Deterministic upscaling may be previewed as a non-mutating operation but must
  not be presented as measured photographic detail gain.
- Model-backed or generated-detail output requires explicit user intent, model
  ID/version, backend provenance, warnings, review status, and a detail policy
  that cannot be selected accidentally.
- Single-image generated detail is not eligible for the default professional SR
  apply path.

Validation:

- Before final apply is allowed, single-image SR needs false-detail review,
  model/provider provenance, user-visible disclosure, and fixtures that catch
  hallucinated edges, text, skin/hair, foliage, fabric, and repeated structure.

## Mode Selection Rules

- Default to multi-image burst SR when two or more related frames are selected.
- Use panorama-style SR only when overlap/output-bounds behavior is explicit.
- Treat single-image SR as unavailable for final professional output until a
  dedicated backend, disclosure, and validation issue lands.
- Never infer aggressive/model-backed detail from missing settings.
- Never apply a plan after source files, sidecars, virtual copies, graph
  revisions, alignment settings, detail policy, scale, engine version, model
  version, or output artifact assumptions change.

## Schema Mapping

- `computationalMerge.createSuperResolution` is the command family for current
  multi-image SR work.
- `SuperResolutionDryRunSummaryV1` records mode decision status, warning/block
  codes, source state, effective scale, and validation summary.
- `SuperResolutionArtifactV1` records final derived artifact provenance, source
  hashes/revisions, engine/model provenance, stale state, and invalidation
  reasons.
- Future single-image SR should use a dedicated schema addition or explicit mode
  field before any final apply path is exposed.

## Non-Goals

- This document does not implement image synthesis, GPU kernels, model
  inference, UI apply, sidecar writes, or real fixture assets.
- This document does not rename existing schema vocabulary such as `balanced`.
- This document does not claim Capture One/Lightroom-quality output; it defines
  the mode boundaries needed to validate that quality later.
