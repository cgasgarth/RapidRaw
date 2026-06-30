# Film Simulation Architecture

- Date: 2026-06-13
- Issue: #135 `film(architecture): define film simulation architecture`
- Scope: architecture contract for creative film simulation, separate from
  objective negative conversion.

## Purpose

RawEngine film simulation must be a controllable creative color system, not a
single LUT picker. The architecture should support professional look browsing,
user presets, imported LUTs, black-and-white controls, grain, halation,
bloom/glow, layered local edits, side-by-side comparison, and fixture-backed
validation while avoiding proprietary film-stock assets or unsafe naming
claims.

Film simulation is downstream of objective RAW development and downstream of
Negative Lab objective inversion. It can use metadata from acquisition,
profiles, masks, and variants, but it must not silently rewrite objective
negative conversion, base/fog calibration, or roll normalization.

## Inherited RapidRaw Surfaces

RapidRaw already has useful film-adjacent surfaces that should be wrapped and
governed rather than discarded:

- adjustment sidecars already include LUT keys such as `lutPath`, `lutName`,
  `lutSize`, `lutIntensity`, and optional `lutData`;
- adjustment sidecars already include creative effects such as `grainAmount`,
  `glowAmount`, `halationAmount`, and `flareAmount`;
- `src-tauri/src/lut_processing.rs` parses LUT files and can generate/export
  cube LUT data;
- `src-tauri/src/gpu/gpu_processing.rs` uploads LUTs as 3D textures and samples
  them in the shader;
- `src-tauri/src/shaders/shader.wgsl` already contains LUT sampling, grain,
  glow, and halation shader parameters;
- `src/components/ui/LUTControl.tsx` is the existing frontend LUT control
  surface;
- export code can export adjustments as LUTs while explicitly zeroing effects
  that do not belong in LUT output.

The architecture work should therefore define stricter contracts around these
surfaces: declared color domains, provenance, deterministic parameters,
versioned schemas, and validation gates. It should not remove working LUT or
effects paths unless a replacement lands in the same small PR.

## Product Boundaries

Film simulation covers creative rendering:

- look recipe selection;
- global and masked creative color transforms;
- LUT and HaldCLUT application;
- color response and channel bias controls;
- contrast and print-style tone curves;
- split tone and color wash controls;
- black-and-white film controls;
- grain, texture, and chroma/luma noise modeling;
- halation;
- bloom/glow;
- look strength and mix;
- preset save/share;
- side-by-side comparison.

Film simulation does not cover:

- RAW decode;
- camera/scanner input profile classification;
- lens correction;
- film base/fog calibration;
- density-domain negative inversion;
- objective per-channel inversion curves;
- roll normalization;
- QC warnings for invalid negative conversion;
- export encoding or delivery resizing.

Those upstream stages can feed film simulation, but their records and
validation remain separate.

## Edit Graph Order

The intended graph order is:

1. RAW decode or source import.
2. Input color/profile transform into the working scene space.
3. Lens, geometry, and acquisition corrections.
4. Negative Lab acquisition calibration when the source is a negative.
5. Negative Lab objective density inversion when the source is a negative.
6. Negative Lab semi-objective roll normalization when enabled.
7. Base tone and color edits.
8. Local masks and layer stack evaluation.
9. Creative film simulation.
10. Output transform and export rendering.

Inside creative film simulation, the first implementation should evaluate:

1. look recipe base transform;
2. optional LUT/HaldCLUT transform;
3. black-and-white mixer when enabled;
4. contrast and print-style curve;
5. color response, split tone, saturation, and density-like color controls;
6. halation;
7. bloom/glow;
8. grain and texture;
9. strength/mix blend with the pre-film input.

This order is a starting contract, not an irreversible renderer decision. Any
change that moves grain before halation, applies LUTs after output color
management, or lets creative looks alter objective negative stages should get a
small ADR with fixture evidence.

## Working Color Assumptions

The renderer should prefer scene-referred or wide-gamut linear working data for
upstream image development and objective negative conversion. Creative film
simulation may include output-referred components when the component is defined
that way, but the look recipe must declare the expected input and output
domains.

Every film look, LUT import, or creative operation should declare:

- input color domain;
- output color domain;
- whether it expects linear, log, or display-referred data;
- whether it is scene-referred friendly;
- whether it is output-referred only;
- gamut mapping expectations;
- blend behavior for look strength.

The engine should reject or warn on ambiguous LUTs whose color domain cannot be
declared by the user or inferred from metadata.

## Data Model

The first schema/API work after this document should define:

- `FilmLookRecipeV1`: built-in or user look recipe with legal/provenance
  metadata, compatible source domains, compatible output domains, touched
  parameter scopes, and default component references.
- `FilmLookNodeV1`: discriminated recipe node for LUT, tone curve, color
  response, split tone, black-and-white, grain, halation, glow, and mix/blend
  operations.
- `FilmRenderDomainV1`: explicit input/output render domain declaration for
  scene-linear, log-like, display-referred, and export/output-referred
  transforms.
- `FilmSimulationWarningV1`: stable warnings for ambiguous LUT domains, missing
  provenance, unsupported renderer paths, clipping risk, and unsafe claims.
- `FilmSimulationProvenanceV1`: source, author, hash, license, fixture, review,
  and migration metadata for look recipes and imported assets.
- `FilmSimulationOperationV1`: command/API record for applying or previewing a
  film simulation operation.
- `FilmLutAssetV1`: imported LUT/HaldCLUT metadata, declared input/output
  domains, size, interpolation policy, hash, license/provenance fields, and
  validation status.
- `FilmGrainModelV1`: grain algorithm, seed policy, size, roughness, luma/chroma
  split, tone response, and ISO-like preset labels.
- `FilmHalationModelV1`: threshold, radius, color bias, channel behavior,
  intensity, mask behavior, and highlight rolloff.
- `FilmGlowModelV1`: threshold, radius, intensity, color handling, blend mode,
  and local-mask behavior.
- `FilmBwModelV1`: channel mixer, panchromatic/ortho-style response, contrast
  curve, filter color, grain interaction, and tinting controls.
- `FilmPresetManifestV1`: shareable preset metadata, dependency hashes,
  compatibility, migration version, and unsafe-claim checks.

The schema should use Zod first, generated sample artifacts, strict invalid
sample checks, and no untyped JSON escape hatches.

## API Boundaries

Film simulation commands should be dry-run first:

- preview film look;
- import/validate LUT;
- apply film look;
- set grain;
- set halation;
- set bloom/glow;
- set black-and-white controls;
- save preset;
- export or share preset;
- compare variants side by side.

Every command should include:

- command ID and correlation ID;
- target image, variant, layer, or mask;
- expected graph revision;
- approval class;
- dry-run flag;
- deterministic seed policy when stochastic grain is involved;
- preview artifact handles;
- validation warnings;
- legal/provenance warnings for imported or shared assets.

Agent tools must expose the same commands through the app-server surface rather
than introducing separate image-editing shortcuts. The agent can recommend or
preview looks, but applied film simulation changes should still go through the
command envelope and graph revision checks.

## Layer And Mask Behavior

Film simulation should be usable globally, per layer, and per mask. The first
renderer implementation can start global-only, but the schema must not assume
global-only behavior.

Layered film simulation should define:

- where film operations sit relative to normal tone/color layers;
- whether grain is applied per layer or after layer compositing;
- how masked halation/glow behaves near mask edges;
- whether look strength blends in scene space or output space;
- how preview thumbnails cache look inputs.

The default policy should be:

- color and contrast look components may be layered and masked;
- halation and glow may use masks but must avoid double-counting highlights
  across stacked layers;
- grain should default to final creative render grain after compositing, with an
  explicit expert mode for layer-local grain later.

## Legal And Provenance Rules

Built-in looks must be vendor-neutral unless a future legal review explicitly
approves a named-stock claim.

Do not bundle:

- proprietary LUTs;
- proprietary ICC/DCP/profile assets;
- copied film simulation recipes;
- competitor look names or descriptions;
- manufacturer logos, packaging art, or copied swatches;
- "exact match", "official", or "manufacturer approved" claims.

Each built-in look should carry:

- generic safe name;
- display description;
- source type: engineered, measured, imported, or user-authored;
- legal naming status;
- license/provenance status;
- compatible source domains;
- parameter scopes touched;
- fixture coverage status;
- migration version.

Imported presets and LUTs should be allowed only when provenance is recorded.
Unsafe claims should warn or block sharing, even when local editing remains
allowed.

## Validation Gates

CI should eventually include:

- Zod schema sample validation for every film simulation schema.
- Invalid sample checks for unsafe names, missing provenance, ambiguous color
  domains, malformed LUT metadata, duplicate preset IDs, and unsupported asset
  payloads.
- Synthetic color-ramp fixtures for color transform stability.
- Neutral gray and skin-like patch fixtures for hue stability.
- High-ISO texture fixtures for grain stability.
- High-contrast edge fixtures for halation and glow stability.
- Black-and-white channel-mixer fixtures.
- CPU reference output checks before GPU parity claims.
- GPU/CPU parity thresholds for supported renderer paths.
- Deterministic seeded-grain checks.
- Visual regression snapshots for look browser and comparison UI.
- Performance budget checks for preview latency and memory use.

Blocking gates should start with schemas, provenance, deterministic unit tests,
and small synthetic fixtures. Full visual regression and GPU parity can become
required after the renderer path exists.

## CI Gate Matrix

| PR type               | Must block CI                                                               |
| --------------------- | --------------------------------------------------------------------------- |
| Architecture docs     | docs check, Markdown links, formatting, and no contradictory plan drift     |
| Film schema           | schema check, sample artifact drift, invalid sample tests, typecheck, lint  |
| LUT/HaldCLUT import   | identity LUT fixture, malformed LUT rejection, provenance/domain validation |
| Built-in look catalog | legal/provenance lint, generic-name lint, sample drift, fixture references  |
| CPU renderer          | deterministic fixture hashes, no NaN/Inf, domain warnings, replay stability |
| GPU renderer          | CPU/GPU parity fixtures, tolerance report, fallback behavior                |
| Film UI               | Playwright/visual smoke, keyboard access, fixture-backed screenshots        |
| Preset save/share     | roundtrip tests, migration tests, missing-provenance import quarantine      |

CPU reference output is the canonical behavior for renderer work. GPU paths can
be faster, but they should not become the only source of truth for LUT
interpolation, grain randomness, halation kernels, glow, or final compositing.

## Performance Strategy

Film simulation should remain interactive for common RAW files:

- preview at reduced resolution while edits are active;
- cache LUTs, look recipes, and tone curves by content hash;
- tile expensive glow/halation passes when image size requires it;
- keep grain deterministic without storing full grain images;
- invalidate only affected graph nodes;
- use GPU paths for preview and CPU reference paths for deterministic tests;
- expose estimated cost for high-radius halation, glow, and large LUTs.

Any effect that cannot run interactively should enter an explicit background
job path with progress, cancellation, preview fallback, and artifact handles.

## UI Implications

The film look browser should prioritize fast comparison:

- searchable look list;
- favorites;
- compatible/incompatible look filters;
- strength slider;
- component toggles for LUT, curve, grain, halation, glow, and B&W;
- side-by-side and split-view comparison;
- warning badges for unsupported domains or unsafe provenance;
- local preset save/share with manifest validation;
- compact per-look technical details for expert users.

The browser should not present built-in looks as exact film-stock emulations
unless legal/provenance review approves that claim.

## First PR Sequence

Recommended sequence after this architecture PR:

1. `film(schema): add creative film simulation recipe schemas`
2. `film(lut): add HaldCLUT import validation`
3. `film(legal): add bundled-look legal review checklist`
4. `validation(film): add film simulation fixture outputs`
5. `film(looks): add legally safe built-in look collection`
6. `film(schema): add film simulation operation record`
7. `film(grain): add film grain model`
8. `film(halation): add halation model`
9. `film(glow): add bloom and glow model`
10. `film(bw): add black-and-white film controls`
11. `ui(film): add film look browser`
12. `ui(film): add side-by-side film comparison`
13. `film(presets): add film preset save and share`

Renderer PRs should remain small and fixture-backed. UI PRs should not claim
color quality until the underlying renderer and fixtures support the claim.

## Open Questions

- Whether the first LUT path should support `.cube` only, HaldCLUT images only,
  or both in the same PR.
- Whether built-in generic looks should live in the schema package, Rust
  renderer fixtures, or app data.
- How much OCIO-style color management to expose before renderer work.
- Whether halation should be modeled before or after the print-style curve for
  the first renderer implementation.
- How to represent layer-local grain without surprising users who expect final
  print grain.

These questions should be resolved by small ADRs or consult-backed design notes
when implementation reaches each surface.
