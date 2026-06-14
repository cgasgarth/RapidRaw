# Super-Resolution Visual Artifact Review Checklist

- Date: 2026-06-14
- Issue: #206 `validation(sr): add visual artifact review checklist`
- Milestone: 13: Super-Resolution
- Scope: manual and automated review evidence required before SR output can be described as professional quality.

## Purpose

Super-resolution output must remain photographically honest. This checklist defines the visual review evidence required before a super-resolution implementation, preset, backend, model, or policy change can claim apply-ready output.

The checklist is intentionally stricter for final apply than for preview. Preview can expose risk; final apply must prove the result is supported by source evidence, provenance, and human-visible review.

## Required Inputs

Each review packet must include:

- source manifest with image paths or stable IDs;
- source content hashes when available;
- source edit graph revisions or explicit `rawDefaultsApplied` state;
- selected SR mode: `single_image`, `multi_image`, or documented future mode;
- requested and effective scale;
- detail policy;
- alignment mode;
- quality preference;
- output dimensions;
- backend/engine version;
- model ID and model version when model-backed;
- dry-run plan ID and hash for apply review;
- warning codes and block codes;
- stale-state decision;
- reviewer name or automation identity;
- review timestamp.

## Crop Set

Every review packet must include paired source/output crops at:

- 100 percent output zoom;
- 200 percent output zoom;
- high-contrast edge;
- fine repeated texture;
- low-texture region;
- shadow region;
- highlight region;
- subject-critical region.

Use the same crop coordinates for source and output where possible. For multi-image and panorama-style SR, include the aligned source frame or reference frame used for the comparison.

## Artifact Categories

Reviewers must mark each category as `pass`, `warn`, `block`, or `not_applicable`.

### Edge Integrity

Check:

- halos around high-contrast edges;
- double edges from registration mismatch;
- stair-stepping or zippering on diagonals;
- warped straight lines;
- false outlines around subject boundaries.

Block final apply when edge artifacts change subject shape, text, product markings, architecture lines, or facial features.

### Texture Honesty

Check:

- waxy skin;
- invented pores, hair, fabric weave, foliage, or grain;
- checkerboard texture;
- repetitive synthetic patterning;
- smeared detail in low-texture regions;
- sharpened noise presented as detail.

Block final apply when texture is semantically invented or when model/detail policy is mislabeled as conservative.

### Alignment And Motion

Check:

- local ghosting;
- parallax mismatch;
- moving subject artifacts;
- warped backgrounds;
- repeated objects;
- incomplete overlap support.

Warn for localized recoverable artifacts. Block final apply when alignment errors affect the primary subject or more than one review crop.

### Text And Symbols

Check:

- signs;
- labels;
- license plates;
- UI screenshots;
- product marks;
- serial numbers;
- small typography.

Block final apply when text or symbols become more specific than the source evidence supports.

### Color And Tone Stability

Check:

- color shifts between source and output;
- channel fringing;
- amplified chroma noise;
- clipped highlights;
- crushed shadows;
- changed white balance;
- hue changes in skin, foliage, sky, and neutral gray patches.

Warn for small global changes if the SR step is explicitly allowed to alter tone. Block if SR changes color in a way that cannot be explained by the editing graph.

### Noise And Grain

Check:

- noise clumping;
- denoise smearing;
- fake grain;
- high ISO texture amplification;
- inconsistent grain across aligned frames;
- noise that tracks edges unnaturally.

Block final apply when noise becomes structured false detail.

### Boundary And Crop Behavior

Check:

- black/transparent borders;
- stretched edges;
- repeated border pixels;
- crop mismatch;
- panorama-style expansion accidentally treated as detail gain;
- missing output bounds provenance.

Block final apply when output bounds are ambiguous or crop decisions are not recorded.

## Mode-Specific Gates

### Single-Image SR

Final apply remains blocked until a dedicated backend, disclosure, and validation issue allows it.

Review must additionally check:

- model/provider provenance;
- generated-detail disclosure;
- false detail on faces, hair, text, foliage, fabric, and product marks;
- whether deterministic upscale is being misrepresented as recovered detail.

### Multi-Image SR

Review must include:

- alignment confidence;
- overlap coverage;
- rejected-frame list;
- local confidence/support map when available;
- source count;
- source frame crop contact sheet.

Block final apply when multi-image output cannot show source support for the claimed detail gain.

### Panorama-Style SR

Review must include:

- overlap/bounds review;
- crop or boundary mode;
- seam artifact notes;
- field-of-view expansion disclosure;
- distinction between detail gain and canvas expansion.

Block final apply if the review packet cannot separate stitched coverage from true detail improvement.

## Decision Rules

Use `pass` only when:

- every required crop is present;
- source provenance is complete;
- no blocking artifact is present;
- warning codes match observed risks;
- output dimensions and scale match the dry-run plan;
- the selected mode and detail policy are accurately disclosed.

Use `warn` when:

- artifacts are localized and not subject-critical;
- lower confidence is visible but acceptable for preview;
- output is usable only with a lower scale or safer policy;
- additional human review is required before apply.

Use `block` when:

- any source provenance is missing;
- source graph or content hashes are stale;
- output invents semantic detail;
- text or symbols are fabricated;
- primary subject edges are distorted;
- alignment failure affects important regions;
- conservative mode depends on model-only hallucination;
- output bounds are not reproducible;
- model provenance is missing for model-backed output.

## Evidence Ledger

Every PR that changes SR visual quality must include:

- exact command or UI path used to produce output;
- source fixture IDs;
- output artifact ID;
- dry-run plan ID/hash;
- output dimensions;
- review checklist result;
- crop contact sheet path or screenshot;
- warning/block code summary;
- known limitations;
- follow-up issue links for accepted gaps.

## Automation Hooks

Automated checks should fail when:

- required metadata fields are missing;
- generated sample artifacts drift;
- an apply result lacks an accepted dry-run plan;
- stale-state is `current` with invalidation reasons;
- stale-state is `stale` without invalidation reasons;
- model-backed output lacks model provenance;
- single-image final apply is exposed before its dedicated validation issue lands.

Manual review remains required for visual artifacts until automated crop scoring and fixture comparisons are implemented.

## Non-Goals

- This checklist does not provide real fixture images.
- This checklist does not implement SR rendering.
- This checklist does not claim quality for any backend.
- This checklist does not replace performance, memory, schema, or sidecar roundtrip validation.
