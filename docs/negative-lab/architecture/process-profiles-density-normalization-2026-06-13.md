# Negative Lab Process Profiles And Density Normalization

- Date: 2026-06-13
- Issue: #273 `negative-lab(color): add density normalization and process profiles`
- Scope: schema and sample contracts for process profiles, density curves, and
  density normalization profile references.

## Decision

Negative Lab process profiles are first-class schema records. They describe how a
supported process family maps density-domain inversion into an objective positive
starting point. Density normalization is also a named profile so roll-level
normalization, UI controls, and app-server dry-runs can reference the same
contract without embedding ad hoc parameter JSON.

The v1 schema deliberately separates:

- objective inversion: `density_rgb_v1`;
- semi-objective normalization: `density_normalization_v1`;
- process curve mapping: `process_profile_monotonic_v1`;
- creative rendering: empty for v1 generic profiles until film-look presets land.

## Included Contracts

- `NegativeLabDensityCurvePointV1`
- `NegativeLabDensityCurveV1`
- `NegativeLabDensityNormalizationProfileV1`
- `NegativeLabProcessProfileV1`

The generated samples are:

- `packages/rawengine-schema/samples/negative-lab-density-normalization-profile-v1.json`
- `packages/rawengine-schema/samples/negative-lab-process-profile-v1.json`

## Validation Rules

- Density curve input values must be strictly increasing.
- Density curve output values must be monotonic non-decreasing.
- Density aim values must progress `highlight < midtone < shadow`.
- Density normalization channel weights must sum to 1 within a small tolerance.
- Measured project profiles require project-owned measurement provenance and at
  least one fixture ID.
- Black-and-white profiles must use luminance-only density curves.

## API Usage

`negativeLab.setConversionRecipe` can now reference both a process profile and a
density normalization profile through `curveModel`. `negativeLab.planRollNormalization`
can also reference a density normalization profile. These references are optional
for compatibility while the engine and UI wiring land in later PRs.

Future app-server tools should report profile IDs, versions, class, and warning
codes in dry-run summaries. They should not claim branded stock equivalence from
generic process profiles.

## Deferred

This PR does not implement pixel math, stock-family preset registries, measured
profile acquisition, UI controls, or app-server handlers. Those remain separate
issues so each PR can carry focused validation evidence.
