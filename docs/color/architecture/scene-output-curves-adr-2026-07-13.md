# ADR: Scene and Output Curve Domains

Status: accepted and implemented for #5409.

## Decision

RapidRAW exposes two versioned user-curve nodes. `scene_curve_v1` runs in AP1
scene-linear RGB before the view transform. Its coordinates are log2 exposure
values relative to 18% middle grey and cover -16 EV through +16 EV. Nonpositive
scene values bypass log evaluation so negative gamut excursions remain finite
and available to the shared gamut stage. `output_curve_v1` runs after the view
transform in its declared encoded output domain. SDR uses 0–1; HDR extends the
same compiler and UI to four times reference white.

Both nodes compile sorted, finite, unique control points into a 4096-entry LUT.
Monotone cubic uses deterministic Fritsch-Carlson-style slope limiting and is
C1 continuous inside the control-point interval without overshooting monotone
points. Linear interpolation is C0 continuous. The analytic-to-LUT error budget
is 1e-3 across the declared interval. CPU and WGPU interpolate the same LUT and
share endpoint metadata.

Endpoint behavior is explicit: constant, endpoint-tangent linear, or finite
soft roll-off. Scene defaults do not clamp extended values. Output defaults are
target-aware and include the output profile, reference-white nits, maximum
linear value, curve version, LUT fingerprint, and shader ABI in render identity.

## Color Semantics

Scene luma uses AP1 coefficients, never Rec.709 coefficients. Luminance-
preserving mode curves AP1 luminance and scales RGB by the luminance ratio;
max-RGB preservation is available for saturated highlights. Linked RGB applies
one scalar function to every channel, and red/green/blue modes deliberately
permit channel styling. Final target fitting remains the gamut service's job.

## Compatibility

Process-v1 sidecars retain the existing 0–255, 16-sample Hermite display path
exactly. New curve fields are ignored by that graph. Optional migration fits an
output curve to the legacy LUT and reports maximum and RMS error; conversion is
rejected when the requested tolerance is exceeded. Upgraded images receive an
identity scene curve unless the user explicitly creates one.

## Consequences

- Curve compilation happens once per curve revision, never per frame.
- Scene and output fingerprints invalidate only their authoritative render
  stages and GPU bind-group identity.
- Preview, export, and CPU reference paths share one compiled plan contract.
- Profile tone curves remain profile nodes and are not silently converted into
  user curves.
- Presets persist domain, output-process identity, and implementation version.
