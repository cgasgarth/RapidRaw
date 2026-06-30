# ADR: Scene-To-Display Transform Strategy

- Issue: #85 `color(adr): decide scene-to-display transform strategy`
- Status: accepted for next implementation phase
- Scope: architecture decision only; no runtime pixel changes
- Consult: aligned with the 2026-06-14 RapidRaw ChatGPT Pro Extended
  color-space consult recommendation to keep AgX as a display-rendering
  transform, not the working space.

## Decision

RawEngine will keep the existing AgX path as the default scene-to-display
rendering transform for RAW images during the next implementation phase, while
treating it explicitly as an output rendering stage rather than the working
space.

The current `basic` transform remains available as a legacy/simple rendering
mode for non-RAW sources and parity comparisons. New color-pipeline work must
name the transform domain explicitly:

- `acescg_linear_v1`: scene-referred working/editing domain.
- `rawengine_agx_v1`: default scene-to-display rendering transform.
- `rawengine_basic_v1`: legacy/simple rendering transform.
- `display_profile_output`: final display/output profile conversion.

## Current Runtime Basis

RapidRAW already has a usable baseline:

- `src-tauri/src/image_processing.rs` stores `tonemapper_mode` and AgX matrices
  in `GlobalAdjustments`.
- `resolve_tonemapper_override` defaults RAW images to AgX and non-RAW images
  to basic when the override is enabled.
- `apply_cpu_agx_tonemap` mirrors the AgX math for CPU-side output paths.
- `src-tauri/src/shaders/shader.wgsl` applies `agx_full_transform` when
  `tonemapper_mode == 1u`.
- Preview and export both route through `process_and_get_dynamic_image`, which
  gives RawEngine a single place to prove parity.

This ADR keeps that baseline, but changes how the project talks about it: AgX
is not the working color space, not a camera profile, not a LUT domain, and not
a final display-profile conversion.

## Pipeline Placement

The scene-to-display transform runs after scene-referred editing and before
display/output profile conversion:

1. RAW decode, normalization, demosaic, camera/profile transform, and
   chromatic adaptation.
2. Working-space conversion into `acescg_linear_v1`.
3. Scene-referred edit graph: exposure, tone, white balance, curves, HSL,
   selective color, masks, layers, local contrast, detail, and compatible
   scene-referred LUTs.
4. Creative operations that declare scene-referred input.
5. Scene-to-display rendering transform: `rawengine_agx_v1` or
   `rawengine_basic_v1`.
6. Display-profile transform, soft proof transform, or export color-space
   transform.
7. Quantization, encoding, and embedded profile where applicable.

Display-referred LUTs, display-referred film looks, or imported profile effects
must run after step 5 and must declare `display_referred_input` warnings in
schemas and UI.

## Preview, Export, And App-Server Policy

- Preview and export must use the same transform ID and parameter set for a
  given recipe unless a preview-only mode is explicitly requested.
- Preview and export should share a typed render target that records view
  transform, output profile, bit depth, rendering intent, and ICC embedding
  policy.
- App-server tools must expose the selected scene-to-display transform as a
  typed command field, not as a hidden preference.
- Derived artifacts that become editable sources should store whether they are
  scene-linear or display-rendered previews.
- Screenshot and visual QA artifacts must record transform ID, display/output
  profile target, and whether the artifact is preview or export output.

## What Not To Implement Yet

- Do not replace AgX with a new custom filmic curve before ColorChecker,
  DeltaE, and preview/export parity gates exist.
- Do not add HDR display output, PQ, HLG, or EDR behavior to this milestone.
- Do not claim macOS display-profile correctness until a dedicated proofing
  test exists.
- Do not let LUT or film-simulation features silently choose a display domain.
- Do not make scene-to-display transform selection a UI-only setting that the
  command API cannot replay.

## Validation Gates

Milestone 5 should add these gates before broad color-quality claims:

1. Transform ID schema gate: command, sidecar, artifact, and fixture schemas
   accept `rawengine_agx_v1` and `rawengine_basic_v1`.
2. CPU/GPU parity gate: AgX patch outputs match within documented tolerances.
3. Preview/export parity gate: one non-trivial recipe renders with the same
   transform ID in preview and export.
4. Clipping/gamut gate: over-range scene values produce stable shoulder,
   clipping, or warning behavior.
5. Display-profile smoke: macOS validation artifact records display/output
   profile assumptions and does not rely on AppleScript, `osascript`, System
   Events, or Apple Events automation fallback.
6. LUT-domain gate: display-referred LUTs cannot be applied as
   scene-referred LUTs without an explicit schema/domain declaration.

## Follow-Up Work

- #84 `color(adr): decide working color space`
- #86 `color(adr): decide camera profile strategy`
- #89 `validation(color): add DeltaE measurement harness`
- #90 `validation(color): add histogram and scope validation`
- #93 `color(cat): add chromatic adaptation plan`
- #94 `color(gamut): add gamut mapping plan`

## Validation

- `bunx prettier --check docs/color/architecture/scene-to-display-transform-adr-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
