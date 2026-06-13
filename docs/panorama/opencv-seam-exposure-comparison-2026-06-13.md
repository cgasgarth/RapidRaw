# OpenCV Seam And Exposure Strategy Comparison

- Issue: #997 `panorama(opencv): compare seam and exposure strategies against legacy engine`
- Scope: panorama backend design and validation planning
- Status: comparison gate before OpenCV parity fixtures or default promotion

## Decision

RawEngine should treat OpenCV seam finding, exposure compensation, and blending
as selectable backend capabilities, not as product-level artifact types. Project
files, app-server tools, and sidecars should continue to use RawEngine capability
names so OpenCV can remain optional, replaceable, and unavailable-safe.

The first OpenCV backend spike should compare a small set of strategies against
the current RapidRaw homography seam backend:

- legacy adaptive dynamic-programming seam with feathering;
- OpenCV dynamic-programming seam, color cost;
- OpenCV dynamic-programming seam, color-gradient cost;
- OpenCV graph-cut seam, color cost;
- OpenCV graph-cut seam, color-gradient cost;
- OpenCV Voronoi seam as a simple fallback/reference;
- OpenCV gain and channels exposure compensators;
- OpenCV feather and multi-band blenders.

## External Capability Snapshot

Primary OpenCV Rust documentation checked on 2026-06-13:

- <https://docs.rs/opencv/latest/opencv/stitching/index.html>
- <https://github.com/twistedfall/opencv-rust>
- <https://github.com/twistedfall/opencv-rust/blob/master/INSTALL.md>

The OpenCV stitching module exposes a configurable stitching pipeline with
camera models, feature matching, warping, seam estimation, exposure
compensation, and blenders. Its documented module items include graph-cut and
dynamic-programming seam finders, Voronoi and no-seam fallbacks, gain and
channel exposure compensators, feather blending, and multi-band blending.

## Legacy Baseline

Current RapidRaw panorama behavior should remain the baseline for parity:

- Uses feature matching and homography estimation for image alignment.
- Produces an editable derived panorama artifact in RawEngine terms.
- Uses the legacy adaptive seam/feathering behavior as the default local
  preview-quality path until a stronger backend is proven.
- Has no external runtime dependency.

Strengths:

- No packaging or codesigning burden.
- Predictable build graph.
- Easier to keep available in all local and CI environments.
- Good baseline for validating schema, artifact persistence, and app-server
  command contracts.

Weaknesses:

- Limited professional seam selection controls.
- Limited exposure normalization options.
- Limited multi-band blending quality for difficult overlaps.
- Needs more large-panorama and real-photo fixture evidence.

## Strategy Matrix

| Strategy                     | Expected use                               | Risks                                             | Initial CI tier |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------- | --------------- |
| Legacy adaptive seam feather | Default baseline and fallback              | Lower quality on complex overlaps                 | Required        |
| OpenCV DP color              | Fast optional seam comparison              | May choose visible seams on texture/color changes | Nightly/manual  |
| OpenCV DP color-grad         | Edge-aware optional seam comparison        | May be sensitive to noisy or sharpened edges      | Nightly/manual  |
| OpenCV graph-cut color       | Higher-quality overlap selection candidate | Build/runtime dependency and performance cost     | Nightly/manual  |
| OpenCV graph-cut color-grad  | Highest-priority OpenCV seam candidate     | More expensive, needs artifact review             | Nightly/manual  |
| OpenCV Voronoi               | Simple fallback/reference behavior         | Usually not professional enough as default        | Manual          |
| OpenCV gain exposure         | First exposure compensation candidate      | Can shift intentional exposure differences        | Nightly/manual  |
| OpenCV block gain exposure   | Large-overlap exposure smoothing candidate | Can create local inconsistency                    | Nightly/manual  |
| OpenCV channels exposure     | Color-channel exposure mismatch candidate  | Can fight RawEngine color management              | Manual          |
| OpenCV feather blender       | Fast blend comparison                      | Lower quality on parallax/detail seams            | Nightly/manual  |
| OpenCV multi-band blender    | Professional-quality blend candidate       | Memory and performance cost                       | Nightly/manual  |

## Validation Requirements

Synthetic fixtures:

- Flat exposure ramp with overlap to detect gain compensation regressions.
- High-frequency texture crossing seam candidates.
- Strong vertical edge crossing overlap.
- Color-channel mismatch across two sources.
- Low-overlap pair that should fail gracefully.
- Intentional parallax fixture that should produce a warning, not silent polish.

Real-photo fixtures:

- Handheld two-image panorama.
- Tripod multi-image panorama.
- Sky gradient panorama.
- Architecture facade with straight-line sensitivity.
- High-ISO low-light panorama.

Metrics:

- Seam visibility score over overlap bands.
- Exposure delta before and after compensation.
- Color delta across seam neighborhoods.
- Peak memory estimate and observed peak memory where measurable.
- Runtime per megapixel.
- Failure classification for not-enough-images, homography failure, and
  backend-unavailable states.

Manual review:

- 100% crops around each seam candidate.
- Full panorama preview at fit-to-width.
- Side-by-side legacy vs OpenCV output.
- Heatmap or overlay showing seam path and exposure-correction regions.

## Promotion Criteria

OpenCV seam/exposure strategies may be used in optional UI only after:

- capability report advertises each available strategy;
- missing OpenCV degrades to legacy backend without corrupting project files;
- synthetic fixtures prove deterministic outputs for a pinned dependency set;
- UI labels distinguish stable baseline from experimental backend options;
- app-server tools can dry-run backend selection and receive typed warnings.

OpenCV graph-cut or multi-band paths may become default candidates only after:

- real-photo fixtures show clear quality wins over legacy output;
- memory and runtime budgets are documented;
- packaging and codesigning proof is complete;
- release artifacts contain dependency notices;
- project artifacts remain backend-neutral.

## App-Server And API Surface

The API should expose RawEngine choices rather than OpenCV names:

- `seamMethod: adaptive_dp_feather_v1`
- `seamMethod: graph_cut_color`
- `seamMethod: graph_cut_color_gradient`
- `seamMethod: voronoi_reference`
- `exposureMode: gain`
- `exposureMode: block_gain`
- `exposureMode: channels`
- `blendMode: feather`
- `blendMode: multi_band`

The backend adapter can map these names to OpenCV-specific constants internally.
The app-server agent should choose from capability reports, not hard-code
OpenCV assumptions.

## Follow-Up Work

- Add synthetic fixture parity tests for at least legacy, DP color-gradient,
  graph-cut color-gradient, gain exposure, and multi-band blending.
- Add a capability report sample for each backend tier.
- Add unavailable-backend tests for missing OpenCV.
- Add a visual review page section that shows seam overlays and exposure
  correction regions once rendered fixtures exist.
