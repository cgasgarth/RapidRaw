# ADR: Illuminant-Based White Balance

Status: accepted and implemented for #5402.

## Decision

RapidRAW represents technical white balance as versioned physical illuminant
coordinates (`rapidraw.white_balance.v1`). Kelvin/Duv and xy compile through
CAT16 into an AP1 scene-linear matrix. As Shot is exactly identity relative to
the camera input transform. Auto and picker modes retain method, sample count,
rejection, confidence, and source-frame/preview identity in runtime receipts.

Technical correction is global and cannot be masked. Creative warmth/tint is a
separate later node and may be global or local. Existing sidecars are migrated
by copying their numeric `temperature`/`tint` values to the creative node while
preserving the legacy fields, so their rendered appearance does not change.

RAW and non-RAW sources both receive technical correction only after conversion
to scene-linear working RGB. For RAW this follows the camera RGB to AP1 input
transform; for non-RAW it follows the declared/assumed input transfer decode.
Preview and export share the same parsed matrix and production WGSL.

## Camera Profiles

Dual-illuminant profile selection no longer treats `blue_gain / red_gain` as
CCT. The resolver derives the observed camera neutral from all three as-shot
gains, predicts camera responses for each calibration white through its own
matrix, projects the observation between those responses in log chroma, then
interpolates in reciprocal temperature. Invalid matrices or gains fail safe to
the existing measured D65/single-matrix fallback and disclose low confidence.

For explicit Auto, Kelvin/Tint, preset, and picker/chromaticity modes, the
compiled `WhiteBalancePlanV1` is instead the sole interpolation authority. RAW
decode receives the plan through adjustment-aware preview/export/thumbnail
load paths, uses its exact xy/Duv rather than linearly interpolating endpoint
chromaticities, and records the plan fingerprint in the camera-profile receipt.
As Shot continues to resolve from the camera neutral because no user illuminant
has replaced that metadata.

Picker hover is a source-bound transient session: repeated samples replace the
preview without writing history, stale image/preview completions are rejected,
pointer leave or cancellation restores the deep-cloned baseline, and click
commits exactly one history entry. Selecting Auto invokes the deterministic
image analysis; it cannot relabel a previous Kelvin/Duv value as an estimate.

## Consequences

- Temperature is bounded to 1667–25000 K and Duv to ±0.05.
- CAT compilation uses `f64`; application uses the same `f32` matrix layout on
  CPU references and WGPU.
- Auto/picker estimates are truthful about low sample counts and clipping.
- Technical settings participate in sidecar persistence and render identity.
- Legacy creative sliders remain supported but are no longer presented as
  physical white balance.
