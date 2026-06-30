# Negative Lab Architecture Overview

- Date: 2026-06-13
- Issue: #149 `negative-lab(adr): define negative processing architecture`
- Scope: top-level architecture map for Negative Lab contracts, workflow,
  validation, UI, and app-server boundaries.

## Purpose

Negative Lab is RawEngine's dedicated negative-processing system. It converts
scanned, photographed, or lab-rendered negatives into editable positive variants
through a non-destructive, schema-backed, replayable workflow.

The architecture separates calibration, objective inversion, roll matching,
creative rendering, QC proofing, and export handoff so image quality work can be
validated before the UI or agent claims high confidence.

## Architecture Layers

| Layer                        | Responsibility                                  |
| ---------------------------- | ----------------------------------------------- |
| Acquisition                  | Source assets, input mode, pixel basis, profile |
| Frame detection              | Crops, border metrics, rejected candidates      |
| Calibration                  | Base/fog samples and estimates                  |
| Objective inversion          | Density math and process-family curve sets      |
| Semi-objective normalization | Roll exposure and balance matching              |
| Positive variants            | Linked non-destructive positive outputs         |
| QC proof                     | Contact sheets, overlays, metrics, warnings     |
| Creative editing             | Film looks and normal editor tools after output |
| App-server tools             | Dry-run/apply command access for agents         |

Each layer has a typed schema or command boundary. UI state should derive from
these contracts rather than private component-only payloads.

## Core Contracts

Key schema contracts:

- `NegativeRollSessionV1`
- `NegativeLabFrameDetectionResultV1`
- `NegativeLabBaseSampleRecordV1`
- `NegativeLabBaseFogEstimateV1`
- `NegativeLabPerChannelInversionCurveSetV1`
- `NegativeLabProcessProfileV1`
- `NegativeLabDensityNormalizationProfileV1`
- `NegativeLabRollBatchWorkflowV1`
- `NegativeLabQcProofArtifactV1`
- `NegativeLabPositiveVariantProvenanceV1`
- `NegativeLabCommandEnvelopeV1`
- `NegativeLabAppServerToolManifestV1`

Generated samples under `packages/rawengine-schema/samples/` are the current
machine-validated examples.

## Command Flow

The intended command flow is:

1. `negativeLab.createSession`
2. `negativeLab.applyFrameCrop`
3. `negativeLab.updateBaseSamples`
4. `negativeLab.estimateBaseFog`
5. `negativeLab.setConversionRecipe`
6. `negativeLab.planRollNormalization`
7. `negativeLab.createPositiveVariant`
8. `negativeLab.setFrameQcStatus`

Every mutating operation should have dry-run evidence, expected graph revision,
warnings, and provenance. App-server tools call the same command layer as the
UI.

## Objective Boundaries

Objective operations:

- acquisition correction needed before density math;
- frame geometry and crop review;
- accepted/rejected base/fog samples;
- base/fog estimates;
- density-domain inversion;
- per-channel objective curve sets.

Semi-objective operations:

- roll exposure matching;
- white-balance or neutral-target normalization;
- anchor frame normalization.

Creative operations:

- film looks;
- grain;
- halation;
- glow;
- LUTs;
- print-style output rendering;
- normal editor adjustments after a positive variant exists.

Creative operations must not be stored as base/fog sampling, objective curve
sets, or process profile defaults.

## Workspace And UI

Negative Lab should use a dedicated workspace with persistent session controls,
tool rail, viewer, inspector, and frame queue. Detailed UI contracts live in:

- `dedicated-workspace-ui-2026-06-13.md`
- `roll-setup-frame-queue-ui-2026-06-13.md`
- `qc-overlays-sample-readouts-ui-2026-06-13.md`

The UI should not mutate state directly. It should build and preview typed
commands, show warnings and confidence, then apply approved dry-run plans.

## Validation Strategy

Validation should move from schema to deterministic fixtures before renderer or
UI quality claims:

- Zod schema validation for every command, artifact, and sample;
- generated sample drift checks;
- synthetic density ramps and base/fog fixtures;
- RGB and B&W curve-set membership tests;
- no NaN/Inf renderer invariants;
- warning stability tests;
- Rust reference-path tests;
- UI fixture states and screenshots;
- app-server dry-run/apply fixtures.

The first trusted image-quality claims require deterministic fixtures, not only
visual inspection.

## App-Server And Agent Boundary

The app-server agent can inspect and operate Negative Lab through typed tools:

- read session and frame state;
- request dry-run conversion or QC artifacts;
- inspect warnings, metrics, and provenance;
- apply a previously approved dry-run plan.

The agent should not use UI automation as the primary edit path. It should not
silently apply calibration or conversion changes without dry-run evidence.

## Deferred

Deferred from the architecture baseline:

- automatic stock detection;
- automatic base/fog detection;
- measured exact stock profile authoring;
- final renderer CPU/GPU parity;
- polished export workflow;
- cloud execution;
- destructive metadata writeback.

Those should land behind separate schemas, validation gates, and PRs.
