# Negative Lab QC Proof Validation Contract

- Date: 2026-06-13
- Issue: #278 `validation(negative-lab): add roll consistency and QC overlay tests`
- Scope: schema fixtures and validation rules for roll consistency metrics and
  QC overlay proof artifacts.

## Decision

Negative Lab QC proofing needs a typed artifact before the UI renders overlays
or exports contact sheets. The v1 contract records contact-sheet artifact
handles, frame IDs, roll consistency metrics, overlay geometry, warning codes,
and generated proof metadata.

## Included Contracts

- `NegativeLabQcOverlayKind`
- `NegativeLabQcOverlayV1`
- `NegativeLabRollConsistencyFrameMetricV1`
- `NegativeLabRollConsistencyMetricsV1`
- `NegativeLabQcProofArtifactV1`

The generated sample is:

- `packages/rawengine-schema/samples/negative-lab/fixtures/negative-lab-qc-proof-artifact-v1.json`

## Validation Rules

- QC proof `frameIds` must be unique.
- Every overlay must reference a frame listed in the proof.
- Every roll consistency metric must reference a frame listed in the proof.
- Roll consistency metric frame IDs must be unique.
- Overlay geometry uses the same strict sample geometry schema as base-sample
  overlays, so rectangle and polygon requirements are shared.

## Deferred

This PR does not implement rendered overlays, Playwright screenshots, contact
sheet export, or pixel sampling. Those UI and image-output tests should consume
this contract in later PRs.
