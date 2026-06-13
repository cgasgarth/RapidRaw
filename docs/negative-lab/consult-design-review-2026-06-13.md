# Negative Lab Consult Design Review

- Date: 2026-06-13
- Issue: #148 `consult(negative-lab): get negative processing lab design review`
- Source: ChatGPT Pro Extended consult in the RapidRaw project, with the
  repository attached as project context.

## Purpose

The consult reviewed the next Negative Lab work around per-channel inversion
curves, base/fog sampling controls, roll workflow integration, QC proof
surfaces, deterministic fixtures, and risks to avoid.

Codex remains responsible for verifying and implementing the advice. This file
records the accepted guidance so it can be reviewed like other design inputs.

## Accepted Guidance

The consult recommended keeping Negative Lab split into objective calibration,
objective inversion, semi-objective normalization, and creative rendering. This
matches the existing density-domain ADR and avoids storing creative looks inside
negative conversion schemas.

Accepted decisions:

- Per-channel inversion curves should be objective, scoped, and provenanced.
- RGB color-negative curve sets must require exactly red, green, and blue
  channels.
- Black-and-white silver curve sets must require a luminance curve only.
- Base/fog is calibration and must not be treated as white balance.
- Rejected base samples must remain recorded and inspectable.
- Base/fog estimates should use accepted sample IDs only.
- QC proof should carry numeric metrics, not only contact sheets or preview
  images.
- Manual base sampling should ship before automatic base/fog detection.
- Schema and deterministic fixtures should land before polished UI or quality
  claims.
- PRs should stay split by contract, validation, UI, and renderer surfaces.

## Work Already Applied

The following PRs applied the consult direction:

- #910 `negative-lab(schema): add inversion curve sets`
- #913 `negative-lab(schema): add base sampling controls`
- #911 `docs(negative-lab): add roll setup frame queue design`
- #912 `docs(negative-lab): add qc overlay readout design`
- #914 `docs(negative-lab): add workspace ui design`

## Recommended Next PR Order

1. Add or harden deterministic base/fog numeric fixtures.
2. Add density math reference tests for `D = log10(B / I)`.
3. Add monotonic curve sampling tests for per-channel curve sets.
4. Add UI fixture states for the dedicated Negative Lab workspace.
5. Add overlay renderer screenshot tests once real overlay rendering exists.
6. Add app-server dry-run fixtures that expose the same Negative Lab evidence as
   the UI.
7. Add Rust reference-path tests before claiming quality improvements.

## Deterministic Fixture Targets

First fixture targets should be synthetic and legally safe:

- C-41-like orange-mask gray ramp with known base RGB;
- per-channel curve response fixture with deliberately different RGB curves;
- black-and-white silver luminance ramp;
- rejected base sample exclusion fixture;
- warning stability fixture for clipped base channels, zero or negative
  transmittance, above-base transmittance, lossy inputs, and uneven
  illumination.

Useful numeric assertions:

- estimated base median equals known base within a tight tolerance;
- density calculation equals `log10(base / input)`;
- density clamps to the configured range;
- all intermediate and output values are finite;
- output is monotonic across a ramp;
- RGB curve sets reject missing or duplicate channels;
- B&W curve sets reject RGB channel payloads;
- rejected samples cannot appear in estimate source sample IDs.

## Risks To Avoid

- Do not let the inherited Rust negative conversion parameters become the
  public API contract.
- Do not let freeform creative curves masquerade as objective inversion.
- Do not accept channel arrays without exact membership validation.
- Do not over-trust lab JPEGs or rendered TIFFs; preserve low-confidence and
  lossy-input warnings.
- Do not bypass preset naming and legal policies with curve-set display names.
- Do not rely on visual QC alone; require numeric metrics and warning
  provenance.
- Do not combine schema, renderer, UI, and docs into one large PR.

## Follow-Up Questions

Future consults should focus on:

- base/fog estimator implementation details and robust statistics;
- density math tolerances for CPU/GPU parity;
- UI overlay rendering and screenshot validation strategy;
- measured profile fixture design once project-owned scan targets exist;
- app-server tool contracts for agent-driven Negative Lab workflows.
