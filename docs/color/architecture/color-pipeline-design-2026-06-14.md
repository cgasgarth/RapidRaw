# Color Pipeline Design

- Issue: `color(docs): add color pipeline design doc`
- Status: target design for phased implementation
- Scope: architecture, command/API contracts, validation gates, and migration
  order; no runtime pixel changes in this document.

## Purpose

RawEngine needs an explicit color pipeline before it can make credible
Capture One/Lightroom-class color claims. RapidRAW already has useful preview
and export machinery, but the current pipeline does not yet define canonical
working space, camera-profile placement, profile provenance, display/output
policy, LUT domains, or color-quality validation.

This design turns color behavior into named stages that UI, sidecars, API
commands, app-server tools, fixtures, and CI can all inspect and replay.

## Target Pipeline

The RAW path should resolve to this ordered contract:

1. Source identity, sidecar, graph revision, and decode settings.
2. RAW decode, black/white normalization, orientation, and demosaic.
3. Camera-space linear RGB with decoder metadata and warnings.
4. White balance in input/camera space.
5. Camera profile transform and chromatic adaptation.
6. `acescg_linear_v1` scene-linear working-space buffer.
7. Scene-referred global edits: exposure, curves, tone controls, contrast, HSL,
   color calibration, selective color, and local contrast.
8. Layer and mask composition in declared scene-referred domains.
9. Scene-referred creative operations such as compatible film models and LUTs.
10. Scene-to-display rendering transform.
11. Display/output profile conversion, soft proofing, export intent, and gamut
    warnings.
12. Quantization, encoding, embedded profile, and artifact provenance.

Non-RAW rendered inputs can enter later in the pipeline only after declaring
their pixel basis, embedded/assumed profile, and reduced-confidence warnings.

## Named Domains

RawEngine artifacts should record stable domain identifiers:

| Domain                     | Meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| `camera_linear_rgb`        | Decoder output before camera-profile conversion.       |
| `acescg_linear_v1`         | Canonical scene-referred editing domain.               |
| `scene_referred_lut_input` | LUT/model input that remains scene-referred.           |
| `display_referred_rgb`     | After scene-to-display rendering, before final output. |
| `display_profile_output`   | Final display/export profile target.                   |
| `negative_acquisition_rgb` | Negative Lab acquisition/copy input basis.             |
| `derived_artifact_source`  | HDR/panorama/focus/SR output entering edit graph.      |

Specific ADRs may assign additional versioned IDs to these domains. Until each
ID lands, runtime code must not hide assumptions behind UI-only settings.

## Camera Profile And White Balance

Camera profiling is an input transform, not a creative edit. The camera-profile
strategy ADR defines lookup order and provenance fields. The first runtime work
should add profile metadata to command/sidecar/artifact schemas before applying
new profile math to pixels.

White balance should record source and method separately from the camera
profile:

- `as_shot`
- `auto`
- `picker`
- `manual_kelvin`
- `camera_preset`
- `unknown`

Chromatic adaptation must be named in artifacts before RawEngine makes
profile-correct output claims. The first profile-boundary CAT may use Bradford
when adapting profile connection or DNG-style D50 data into ACEScg, but the
chosen method must be recorded and tested.

## Scene-Referred Edits

Scene-referred edits operate before scene-to-display rendering:

- exposure and high dynamic range tone controls;
- linear or scene-aware curves;
- HSL and selective color with declared working-domain behavior;
- color calibration and channel mixing;
- local contrast and dehaze when they operate on linear luminance;
- masks and layers whose inputs declare the same working domain;
- scene-compatible LUTs and film models.

Display-referred operations must be schema-separated and should warn when used
inside a scene-referred slot.

## Film Simulation And Negative Lab

Film simulation and Negative Lab must not bypass the color contract.

Film simulation paths must declare whether they consume scene-referred or
display-referred pixels. Major-stock-style looks should be implemented as
project-owned generic families or measured profiles with legal provenance, not
as proprietary emulation claims.

Negative Lab has a separate acquisition model for camera, scanner, flatbed, lab,
and rendered inputs. Its acquisition profile can share camera-profile concepts,
but stock/process profiles must not smuggle input color correction.

## Derived Artifacts

HDR, panorama, focus stacking, and super-resolution outputs become editable
sources only when they record:

- source hashes and graph revisions;
- source color/profile state;
- working-domain identifier;
- merge/stack algorithm version;
- warning and confidence state;
- whether the artifact is scene-linear or display-rendered.

Derived artifacts that lack these fields are review-only until upgraded by a
validated command path.

## API And App-Server Contract

Every color-affecting command must be typed, replayable, and inspectable:

- command ID and schema version;
- before/after graph revision;
- target stage and domain;
- parameter diff;
- dry-run/apply mode;
- warnings, confidence, and block reasons;
- provenance entry ID;
- preview/export parity metadata where relevant.

App-server tools should expose color edits through these command schemas, not by
driving UI controls. Agent-proposed color changes should produce dry-run
artifacts before apply, especially for profile, batch, or low-confidence input
changes.

## Preview And Export Target

Preview and export should share a typed render target instead of separate
"close enough" color paths:

- view transform: `rawengine_agx_v1`, `rawengine_basic_v1`, or future transform;
- output profile: `srgb`, `display_p3`, or future custom/profiled target;
- bit depth;
- rendering intent;
- ICC embedding policy;
- soft-proof/display-profile assumptions.

Changing the output profile must not mutate the scene ACEScg buffer. Scene-linear
debug export is allowed only as an explicitly named developer/export mode and
must not be confused with normal display exports.

## Validation Ladder

Tier 0: contract and schema gates.

- Zod/Rust schema parse and reject tests.
- Unsafe cast ban and strict TypeScript gate.
- Markdown/docs link validation.
- Command and sidecar fixture drift checks.

Tier 1: deterministic numeric gates.

- Camera profile lookup fixtures.
- Matrix/profile transform unit tests.
- White balance and chromatic adaptation neutral-patch tests.
- ACEScg invariant tests: neutral gray stays neutral, values above 1 survive
  until display rendering, negative values survive unless a stage documents
  clipping, and NaN/Inf is rejected.
- CPU/GPU parity for core color operations.
- Preview/export parity for representative recipes.

Tier 2: measured fixture gates.

- ColorChecker fixture set with legal provenance.
- DeltaE measurement harness and tolerance manifest.
- Gray-ramp neutrality checks.
- Clipping and gamut-warning fixtures.
- LUT-domain reject/accept tests.

Tier 3: product-quality gates.

- macOS display-profile smoke artifacts.
- Wide-gamut and high-DPI visual QA screenshots.
- Real RAW sample render comparisons.
- Negative Lab color target positives.
- Film-look legal/provenance review.

## Implementation Order

1. Land ADRs for working space, scene-to-display transform, and camera profile.
2. Add this design doc and keep plan/docs navigation linked.
3. Add color domain enums to schema package fixtures.
4. Extend sidecar/artifact provenance with color-domain metadata.
5. Add camera-profile transform unit tests.
6. Add chromatic adaptation plan and neutral-patch tests.
7. Add ColorChecker fixture manifest and DeltaE harness.
8. Add CPU/GPU parity for profile, WB/CAT, and scene-to-display operations.
9. Add preview/export parity tests.
10. Add UI metadata readouts before advanced controls.
11. Add app-server dry-run/apply tools for profile and color edits.
12. Add measured tuning and product-quality visual QA only after numeric gates.

## Non-Goals For This Phase

- No proprietary Adobe/Capture One/camera-profile reverse engineering.
- No Capture One/Lightroom-class quality claim from docs-only work.
- No HDR display/PQ/HLG/EDR output contract in Milestone 5.
- No UI-only color setting that cannot roundtrip through commands.
- No film-stock equivalence claims without provenance and validation.

## Validation

- `bunx prettier --check docs/color/architecture/color-pipeline-design-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
