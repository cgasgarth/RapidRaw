# ADR-NEG-002: Density-Domain Inversion Model

- Date: 2026-06-13
- Issue: #265 `negative-lab(adr): define density-domain inversion model`
- Status: proposed
- Scope: first architecture decision for objective negative conversion math,
  stage boundaries, controls, schema concepts, and validation expectations.

## Context

RawEngine's Negative Lab is planned as a first-class professional scanning and
conversion workspace, not a single checkbox inside film simulation. The density
model is the first hard boundary because every later feature depends on it:
base/fog sampling, roll normalization, presets, CPU/GPU parity, app-server
tools, positive variants, and fixture validation.

RapidRAW already contains a negative conversion surface, but RawEngine should not
let inherited behavior become the product contract. The Negative Lab contract is
local-first, macOS-first, non-destructive, replayable, and explicit about what is
objective conversion versus creative rendering.

This ADR defines the v1 target model, named `density_rgb_v1`. It does not claim
exact film-stock emulation, exact scanner characterization, or final UI
implementation.

## Decision

Negative conversion v1 will use a staged density-domain model. The canonical
algorithm ID is `density_rgb_v1`.

1. **Acquisition input transform**
   - Decode the scan or camera RAW into `LinearScanRgb`, a declared,
     non-display, non-creative linear scan-channel buffer.
   - Apply only bounded acquisition corrections needed before sampling: input
     profile, raw black/white normalization, lens shading, flat-field or
     illumination correction, crop/rotation geometry, and scanner/camera profile
     metadata.
   - Do not apply creative white balance, sharpening, grain, LUTs, HSL, general
     tone tools, or film simulation before objective inversion.
   - Record the channel basis as `camera_rgb`, `scanner_rgb`, `rendered_rgb`, or
     `unknown`. A colorimetric output transform happens after objective
     inversion unless an acquisition profile explicitly declares a safe
     pre-density transform.
2. **Base/fog estimation**
   - Estimate per-channel film base and fog from accepted sample regions using
     robust statistics: median or trimmed mean, median absolute deviation or
     standard deviation, min/max, and clipping fraction.
   - Store accepted and rejected sample regions, confidence, frame or roll scope,
     and algorithm version.
   - Support manual base samples first; automatic detection can be added once
     fixture confidence gates exist.
3. **Transmittance and density conversion**
   - Treat `LinearScanRgb` values as transmittance-like measurements after
     acquisition correction.
   - Normalize by base/fog per channel before inversion:
     `Trel[channel] = max(input[channel], epsilon) / max(base[channel], epsilon)`.
   - Convert to density-like values with guarded log math:
     `density[channel] = log10(max(base[channel], epsilon) / max(input[channel], epsilon))`.
     This is equivalent to `-log10(Trel[channel])`.
   - Reject or warn on NaN, infinity, zero/negative transmittance, severe
     clipping, and unbounded log-domain values.
4. **Objective inversion**
   - Map density to an objective positive linear representation through
     process-family parameters and monotonic per-channel curves.
   - V1 process families are C-41 color negative and black-and-white silver
     negative. ECN-2, chromogenic black-and-white, creative/redscale color, and
     E-6 helper mode are deferred to separate ADRs.
   - Characteristic curve parameters include toe, linear section, shoulder,
     gamma or contrast index, per-channel offsets, and output black/white points.
5. **Neutralization and output handoff**
   - Apply semi-objective neutral or skin target matching only after objective
     inversion and only as labeled operations.
   - Produce an objective positive variant with provenance before normal
     RawEngine creative editing.
   - Display/output transforms happen after the objective positive render and
     must remain profile-aware.

The normal editor operates on the linked positive variant after the Negative Lab
stage. The original scan remains immutable.

## Mathematical Contract

The CPU reference implementation must use explicit `f32` math and stable
algorithm parameters.

For channel `c` at pixel `x`:

```text
I_c(x)      = LinearScanRgb value
B_c         = accepted base/fog estimate
epsilon     = positive algorithm floor
I_safe_c(x) = max(I_c(x), epsilon)
B_safe_c    = max(B_c, epsilon)
Trel_c(x)   = I_safe_c(x) / B_safe_c
D_raw_c(x)  = log10(B_safe_c / I_safe_c(x))
D_c(x)      = clamp(D_raw_c(x), 0, density_max)
P0_c(x)     = monotonic_curve_c(D_c(x))
P1_c(x)     = apply_positive_black_white_points(P0_c(x))
P2_rgb(x)   = apply_post_inversion_balance(P1_rgb(x))
Pout(x)     = output_transform(P2_rgb(x), target_working_space)
```

If `D_raw_c(x)` is below `-density_negative_tolerance`, the operation must emit
an `above_base_transmittance` or base/flat-field mismatch warning before
clamping.

## V1 Controls

V1 UI and API controls should be intentionally narrow:

- input mode: camera RAW/DNG, camera TIFF, flatbed TIFF, lab JPEG/TIFF;
- process family: C-41 color negative or black-and-white silver negative;
- base sample tool: add, remove, accept, reject, and set sample scope;
- base confidence, base RGB, base density, and warning readouts;
- density exposure control;
- per-channel density offset;
- per-channel inversion curve preset with expert curve override deferred;
- black point and white point;
- neutral sample and optional skin sample target;
- objective positive preview, density view, channel view, clipping overlay, and
  before/after split.

Deferred controls:

- automatic frame splitting;
- automatic stock detection;
- exact branded film-stock emulation;
- measured scanner/camera/film profile authoring;
- ECN-2 remjet/cinema assumptions;
- E-6 slide helper mode;
- full roll matching UI;
- GPU shader implementation beyond a CPU reference comparison target;
- app-server mutating tools.

The first UI should make uncertainty visible instead of hiding it behind a
one-click conversion. Missing base samples, lossy inputs, suspected lab
correction, and scanner auto-correction should remain visible warnings.

## Data Model Concepts

The first schemas should separate these concepts instead of storing one broad
adjustment blob:

| Concept                      | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `NegativeAcquisitionProfile` | Capture/scanner source, input profile, light source, correction flags, confidence.    |
| `BaseFogEstimate`            | Per-channel base/fog values, sample regions, rejected regions, confidence, version.   |
| `DensityInversionProfile`    | Process family, curve parameters, black/white points, channel offsets, profile scope. |
| `NegativeConversionCommand`  | Stage-labeled dry-run/apply command with target, parameters, warnings, provenance.    |
| `PositiveVariantRecord`      | Linked positive output, source identity, command hash, preview/render artifact IDs.   |

Every operation must declare a stage:

- `acquisition`
- `objective_inversion`
- `semi_objective_normalization`
- `creative_rendering`
- `output`

Every operation must declare a class:

- `objective`
- `semi_objective`
- `creative`

Batch and future app-server operations may only synchronize objective and
semi-objective parameters by default. Creative synchronization requires explicit
user scope.

Stable warning codes should include:

- `missing_base_sample`
- `low_confidence_base`
- `clipped_base_channel`
- `above_base_transmittance`
- `lossy_input`
- `suspected_auto_color`
- `suspected_lab_correction`
- `unknown_input_profile`
- `dense_negative`
- `thin_negative`
- `contaminated_base_sample`
- `mixed_process_risk`
- `profile_mismatch`

## Numeric Invariants

The CPU reference implementation is canonical for correctness. GPU preview and
export paths must match it within documented tolerances before shipping.

Blocking invariants:

- all density operations consume linearized input;
- no NaN or infinity in intermediate or output buffers;
- zero and negative transmittance are guarded by an explicit epsilon and warning;
- objective curves are monotonic;
- base/fog estimate records are deterministic for fixed sample regions;
- command replay produces stable parameter diffs and output hashes for synthetic
  fixtures;
- clipping warnings are generated before visually plausible output can hide data
  loss.
- intermediate debug artifacts can be generated for linear input, base estimate,
  relative transmittance, density, curve output, positive pre-balance, and
  positive post-balance.

## Validation

Early validation should use synthetic and legally safe fixtures before measured
real film-stock profiles exist.

Required first fixtures:

- gray ramp with known synthetic orange mask;
- ColorChecker-like synthetic patch grid with known positive reference;
- dense negative case;
- thin negative case;
- clipped channel case;
- uneven illumination case;
- black-and-white silver negative ramp;
- lab-corrected JPEG warning case.
- mixed-roll warning case with different synthetic base/exposure offsets.

Required first checks:

- schema parse and rejected-payload tests for acquisition, base/fog, inversion,
  and positive variant records;
- CPU reference deterministic output hash for synthetic fixtures;
- no NaN/Inf and no unguarded negative density;
- monotonic objective curve validation;
- warning stability for missing base, clipped channel, uneven illumination, and
  lab-corrected input;
- schema roundtrip between TypeScript/Zod and future Rust serde structures;
- command replay equivalence for the same command log;
- markdown/docs link checks for the ADR and user-facing limitations.

Measured real fixtures, DeltaE gates, GPU parity, and major-stock coverage are
deferred until fixture licensing and profile methodology ADRs are complete.

## Preset Strategy

V1 presets are process/profile starting points, not exact stock emulations. Use a
three-layer strategy:

1. generic built-in process profiles now;
2. stock registry/reference mappings after the naming/legal ADR;
3. project-measured profiles later with fixtures, methodology, and review.

- Built-in names should use generic process-family language first, such as
  `C-41 neutral camera scan`, `C-41 warm flatbed`, and `B&W silver neutral`.
- Named stock-family mappings require a separate preset naming/legal ADR,
  provenance records, confidence tiers, and prohibited-claim lint.
- No preset may claim official, exact, manufacturer-approved, Capture One,
  Lightroom, Negative Lab Pro, or other third-party emulation status without
  explicit project-owned measurements and legal review.

## Implementation Order

1. Add this ADR and keep `RAW_EDITOR_PLAN.md` aligned.
2. Add schema definitions for acquisition profile, base/fog estimate, inversion
   profile, conversion command, warnings, and positive variant provenance.
3. Add synthetic negative fixture generator and fixture manifest lint.
4. Add deterministic CPU reference conversion for tiny fixtures.
5. Add command dry-run/apply contract with sidecar roundtrip tests.
6. Add a hidden or feature-flagged Negative Lab shell with density/debug
   readouts backed by fixture artifacts.
7. Add manual base sampling and objective positive preview.
8. Add roll/session model and semi-objective roll normalization.
9. Add preset registry only after the preset naming/legal ADR.
10. Add GPU preview after CPU reference and tolerance gates are stable.

## Migration And Compatibility

Every persisted operation must store:

- schema version;
- `algorithm_id`;
- algorithm parameter version;
- acquisition profile version;
- process profile version;
- stock/profile version when present;
- warning-policy version;
- output transform/profile ID.

Old recipes must replay with their original algorithm version unless the user
explicitly migrates them. Preset and profile migrations must not silently move
parameters between objective, semi-objective, and creative classes.

## Consequences

Positive consequences:

- Negative conversion becomes testable and replayable before UI polish.
- The API and app-server surfaces can call the same commands as the UI.
- Film-stock presets cannot silently mix objective inversion with creative looks.
- Future GPU work has a CPU reference and numeric gates.

Tradeoffs:

- V1 will feel less magical than a fully automatic film scanner workflow.
- Exact branded stock presets are delayed until provenance and legal policy are
  ready.
- Some inherited negative-conversion behavior may need to be isolated or
  replaced rather than extended.

Key risks and mitigations:

- **Display RGB inversion**: require `LinearScanRgb` and reject ambiguous input
  domains.
- **Channel-mixing before density**: allow only declared acquisition transforms
  before log-domain math.
- **Base treated as white balance**: keep base/fog estimation separate from
  post-inversion neutralization.
- **Lab JPEG overconfidence**: allow editing but emit low-confidence and
  suspected-correction warnings.
- **Early clipping**: keep float intermediates and report clipping separately
  from display/output gamut mapping.
- **CPU/GPU drift**: keep CPU reference canonical and require explicit tolerance
  gates before GPU preview ships.

## Consult Reconciliation

A Pro Extended consult was started in the RapidRaw ChatGPT project on
2026-06-13 with GitHub context attached. The response reinforced that #265
should stay a small contract ADR and recommended these changes, which are
accepted into this document:

- name the v1 model `density_rgb_v1`;
- operate on declared `LinearScanRgb` rather than display RGB;
- express density as `D = log10(B / I)` with a versioned epsilon policy;
- freeze stable warning codes early;
- keep base/fog, post-inversion balance, roll normalization, stock profiles, and
  creative rendering as separate schema stages;
- defer spectral film modeling, exact stock emulation, freeform curve editing,
  roll normalization, frame splitting, dust/IR cleaning, and GPU parity until
  later PRs.

The consult also recommended a three-layer preset strategy: generic built-ins
first, stock registry/reference mappings second, and measured profiles only after
project-owned fixtures and review exist.
