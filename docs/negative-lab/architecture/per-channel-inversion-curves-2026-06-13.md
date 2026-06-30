# Negative Lab Per-Channel Inversion Curves

- Date: 2026-06-13
- Issue: #153 `negative-lab(inversion): add per-channel inversion curves`
- Scope: schema and command contract for objective per-channel inversion curve
  sets.

## Purpose

Per-channel inversion curves map density-domain negative measurements into an
objective positive representation before neutralization, roll normalization, or
creative film looks. They must be explicit enough for app-server dry runs,
sidecar replay, fixture validation, and future CPU/GPU parity checks.

This contract keeps three concepts separate:

- process profile defaults, which describe generic or measured process-family
  behavior;
- objective curve overrides, which can be scoped to a roll, selected frames, or
  one frame;
- creative looks, which happen after objective inversion and must not be stored
  as Negative Lab inversion curves.

## Schema Surface

The schema package exposes:

- `NegativeLabPerChannelInversionCurveSetV1`
- `NegativeLabPerChannelInversionCurveSetSourceV1`
- `NegativeLabPerChannelInversionCurveSetScopeV1`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab-per-channel-inversion-curve-set-v1.json`

`negativeLab.setConversionRecipe` can include an optional
`curveModel.inversionCurveSet` plus an `inversionCurveSetPolicy`.

## Validation Rules

The Zod contract rejects curve sets that:

- mix black-and-white luminance curves with RGB color-negative curves;
- omit red, green, or blue curves for color negatives;
- repeat a channel;
- claim `process_profile_reference` without source profile ID and version;
- use process-profile references outside `process_profile` scope;
- define session-scoped overrides without a session ID;
- define selected-frame or single-frame scopes without a frame selection.

The conversion recipe also rejects override policies that do not include a
curve set and rejects curve sets whose process family does not match the
recipe.

## UI Implications

The Negative Lab UI should treat these curves as expert objective controls, not
as a film-look browser. The first UI should expose:

- active source profile and curve-set ID;
- red, green, and blue curve preview for color negatives;
- one luminance curve for black-and-white negatives;
- scope chips for process profile, roll, selected frames, or frame;
- warning badges when an override leaves the process-profile baseline;
- read-only provenance for source profile, fixture IDs, legal naming status,
  and measurement source.

Creative contrast, film stock style, halation, grain, glow, LUTs, and print
looks belong in later film simulation controls after the objective positive
variant exists.

## Validation Path

Early deterministic checks should compare synthetic density ramps against the
declared curve set before real film-stock profiles are claimed. The first test
surface should assert:

- monotonic curve inputs and outputs;
- finite output for every channel;
- color RGB curves preserve channel ordering on synthetic patches;
- black-and-white luminance curves reject RGB channel payloads;
- dry-run command replay records the selected curve-set ID and version.
