# ADR: Working Color Space

- Issue: #84 `color(adr): decide working color space`
- Status: accepted for next implementation phase
- Scope: color-pipeline architecture decision only; no runtime pixel changes
- Consult: RapidRaw ChatGPT Pro Extended color-space consult checked on
  2026-06-14; accepted recommendation to use ACEScg as the scene-linear working
  buffer and keep AgX at the display-rendering boundary.

## Decision

RawEngine will use `acescg_linear_v1` as the named scene-referred working space
for the next implementation phase.

This means:

- RGB primaries: ACEScg / AP1.
- White point: ACES white.
- Transfer: linear scene-referred values, not display-referred gamma.
- Encoding ID: `acescg_linear_v1` in command schemas, merge artifacts, fixture
  manifests, and validation outputs.
- Precision target: `f32` for CPU reference paths and persisted numeric
  fixtures; `f16`/`Rgba16Float` is allowed for GPU preview/render paths only
  where parity tests prove tolerance.

`acescg_linear_v1` is a pragmatic scene-linear editing buffer: it is open,
wide-gamut, already aligned with rendering/compositing practice, suitable for
future HDR-derived artifacts and film/negative work, and keeps the engine ready
for later OCIO/ACES-style interchange without claiming full ACES conformance in
Milestone 5.

## Pipeline Order

RawEngine's non-negative-image color pipeline should target this order:

1. RAW decode, black/white normalization, and demosaic.
2. Camera/profile transform into an input-linear camera-independent space.
3. Chromatic adaptation into the ACEScg white point when the input profile
   requires it.
4. Conversion into `acescg_linear_v1`.
5. Lens shading, optical corrections, and bounded RAW-domain corrections where
   they are mathematically tied to capture data.
6. Scene-referred tone and color operations: exposure, contrast, highlight and
   shadow recovery, white balance adjustment, curves, local/masked tone edits,
   color balance, and calibration controls.
7. Layer compositing in `acescg_linear_v1` unless a later layer ADR defines a
   narrowly scoped blend-space exception.
8. Creative color operations that declare their domain:
   - scene-referred LUTs can run in `acescg_linear_v1`;
   - display-referred LUTs must declare `display_referred_input` and run after
     the scene-to-display transform;
   - film simulation must declare scene-referred, display-referred, or negative
     lab positive input explicitly.
9. Scene-to-display transform, initially retaining the existing AgX/basic
   choice as a display-rendering stage rather than the working space itself.
10. Display/output transform into preview, soft-proof, or export profile.
11. Quantization, embedding, and export.

## Negative Lab And Derived Artifacts

Negative Lab objective inversion should produce positive variants tagged with
`acescg_linear_v1` before entering the normal editor graph. Acquisition profiles,
density conversion, process profiles, and stock/profile metadata must remain
before that handoff and must not be hidden inside ordinary creative color edits.

HDR, panorama, focus stack, super-resolution, generated positives, AI denoise,
and AI enhancement outputs should store their render-domain metadata. Derived
artifacts that are editable sources should either output `acescg_linear_v1` or
include a required transform into it before normal editing begins.

## Rejected Alternatives

### Display P3 As Working Space

Rejected for the main working space. Display P3 is useful for preview and
consumer output, but it is display-oriented and too narrow to be RawEngine's
scene-referred editing space.

### sRGB As Working Space

Rejected. It clips too much camera and wide-gamut data and would make
Capture One-class color claims indefensible.

### ProPhoto RGB As Immediate Working Space

Rejected for the canonical RawEngine buffer in this phase. Linear ProPhoto is a
credible photo-editor space and may still be needed for DNG/DCP profile behavior
or compatibility transforms, but ACEScg is a cleaner project default for future
film simulation, HDR artifacts, panorama/focus/super-resolution intermediates,
and OCIO/ACES-style interchange.

### ACEScg As Immediate Working Space

Accepted. ACEScg gives RawEngine a named open scene-linear buffer without
pretending Milestone 5 implements the full ACES ecosystem. ACES2065-1/AP0 is
still rejected as the working buffer; it is better treated as archival or
interchange because AP0 is too wide for practical editing/compositing tools.

### Rec. 2020 Linear As Immediate Working Space

Rejected after consult review. Linear Rec. 2020 is useful as an output or
interchange target, but it is less aligned with the long-term film, HDR-derived
artifact, and OCIO/ACES-style roadmap than ACEScg.

## What Not To Implement Yet

- Do not rewrite the full renderer before the camera-profile and
  scene-to-display ADRs land.
- Do not claim camera-profile correctness from lookup fixtures alone.
- Do not add proprietary Adobe, Capture One, manufacturer, or commercial preset
  profile compatibility claims.
- Do not treat AgX as the working space; it is a rendering/display transform.
- Do not let creative LUTs silently run in an unknown domain.
- Do not make HDR display output or spectral reconstruction part of Milestone 5.

## Validation Gates

The first implementation PRs after this ADR should add proof in this order:

1. Schema gate: every command/artifact/fixture that names a working space accepts
   `acescg_linear_v1` and rejects ambiguous labels such as `linear_rgb`.
2. CPU reference gate: small RGB patch fixtures convert through the named
   pipeline with deterministic `f32` outputs.
3. Camera profile gate: at least one synthetic camera-matrix fixture changes
   rendered pixels in the expected direction.
4. White balance/CAT gate: neutral patch fixtures verify adaptation into
   ACEScg's white point and picker behavior.
5. ColorChecker/DeltaE gate: establish baseline metrics and failure thresholds
   before quality claims.
6. GPU parity gate: compare WGPU `Rgba16Float` output against CPU reference for
   representative patches within documented tolerances.
7. Preview/export parity gate: one non-trivial recipe renders consistently in
   preview and export.
8. Gamut/display gate: out-of-gamut patches produce deterministic clipping or
   warning behavior, and macOS display-profile assumptions are recorded.

## Follow-Up Work

- #85 `color(adr): decide scene-to-display transform strategy`
- #86 `color(adr): decide camera profile strategy`
- #88 `validation(color): add ColorChecker fixture set`
- #89 `validation(color): add DeltaE measurement harness`
- #90 `validation(color): add histogram and scope validation`
- #91 `color(wb): add white balance picker tests`
- #93 `color(cat): add chromatic adaptation plan`
- #94 `color(gamut): add gamut mapping plan`

## Acceptance Criteria

- `RAW_EDITOR_PLAN.md` links this ADR from Milestone 5.
- `docs/index.md` and `docs/site-navigation.json` expose this ADR.
- Markdown formatting and link validation pass.
- The consult output is checked, accepted advice is reflected, and rejected
  alternatives are recorded before PR publication.

## Validation

- `bunx prettier --check docs/color/architecture/working-color-space-adr-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
