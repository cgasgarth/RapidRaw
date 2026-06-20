# Render Artifact Comparison

- Issue: #69 `validation(render): add image artifact comparison script`
- Script: `tests/integration/checks/check-render-artifact-comparison.ts`
- Fixture manifest: `fixtures/render/artifact-comparison-cases.json`

## Scope

The artifact comparison harness compares expected and actual image fixtures and
fails when pixel tolerances are exceeded. The first fixture set uses tiny ASCII
PPM images so the check is deterministic, dependency-free, and safe for PR CI.

The script reports:

- max per-channel pixel delta;
- mean per-channel delta;
- changed-pixel count for cases that must prove a visible change occurred.

## Status

This is a render-validation foundation, not a final golden RAW render suite.
Future feature PRs should replace or extend the synthetic PPM cases with
renderer-produced artifacts and real-image fixtures where licensing allows.
