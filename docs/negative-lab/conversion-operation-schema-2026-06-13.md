# Negative Lab Conversion Operation Schema

- Date: 2026-06-13
- Issue: #151 `negative-lab(schema): define negative conversion operation schema`
- Scope: Zod schema, sample artifact, and validation rules for replayable
  Negative Lab operation records.

## Purpose

The Negative Lab editor needs a stable record for each command the UI, local
agent, CLI, or batch runner proposes or applies. Command envelopes describe the
request, dry-run and apply results describe execution output, and positive
variant provenance describes finished variants. `NegativeLabConversionOperationV1`
connects those surfaces into one audit unit.

The record is intentionally local-first. It does not assume a remote service,
but it does require enough structure for deterministic replay, sidecar review,
agent tool calls, rollback UI, and fixture validation.

## Schema Surface

This PR adds:

- `NegativeLabConversionOperationV1`
- `NegativeLabConversionOperationArtifactPurposeV1`
- `NegativeLabConversionOperationParameterRefsV1`
- `NegativeLabConversionOperationProvenanceV1`
- `NegativeLabOperationClass`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab-conversion-operation-v1.json`

The operation stage enum now includes `output_generation` so positive variant
creation is not mislabeled as creative rendering.

## Operation Fields

Each operation records:

- command type and operation ID;
- operation stage and operation class;
- session ID, source graph revision, and optional result graph revision;
- frame selection;
- approval class and mutation flag;
- artifact purposes and artifact handles;
- warning payloads;
- parameter references for acquisition profile, input profile, process profile,
  inversion curve set, base samples, base/fog estimate, conversion recipe,
  normalization profile, output transform, QC proof, dry-run plan, and positive
  variants;
- provenance for actor, command ID, correlation ID, local-only execution, and
  source surface.

The first sample records a non-mutating objective inversion preview created by
the app-server agent. It references the base sample, base/fog estimate,
per-channel inversion curve set, process profile, dry-run plan, and preview
artifacts.

## Stage Mapping

Command types map to operation stages:

- `negativeLab.createSession` -> acquisition
- `negativeLab.applyFrameCrop` -> acquisition
- `negativeLab.updateBaseSamples` -> calibration
- `negativeLab.estimateBaseFog` -> calibration
- `negativeLab.setConversionRecipe` -> objective inversion
- `negativeLab.planRollNormalization` -> semi-objective normalization
- `negativeLab.createPositiveVariant` -> output generation
- `negativeLab.setFrameQcStatus` -> quality control

Stages map to classes:

- acquisition -> acquisition
- calibration -> calibration
- objective inversion -> objective
- semi-objective normalization -> semi-objective
- creative rendering -> creative
- output generation -> output
- quality control -> quality control

This keeps film base calibration, objective inversion, roll normalization,
creative looks, output creation, and QC review as separate surfaces.

## Validation Rules

The Zod contract rejects:

- command types recorded against the wrong stage;
- stages recorded against the wrong operation class;
- mutating operations with `safe_read` or `preview_only` approval;
- mutating operations without a change set;
- mutating operations without a result graph revision;
- dry-run operations with applied change sets;
- dry-run operations with result graph revisions;
- conversion recipe operations without recipe, curve-set, or process-profile
  references;
- positive variant creation without positive variant IDs;
- positive variant creation without output artifacts.

These rules support the app-server agent without requiring unsafe type casts or
ad hoc JSON payload interpretation.

## UI And Agent Implications

The Negative Lab UI should show operations as a timeline grouped by stage:

- acquisition and frame setup;
- base/fog calibration;
- objective inversion;
- roll normalization;
- positive output generation;
- QC decisions.

The local image-editing agent should use the same record for dry-run preview
tool calls and applied edits. The record lets the UI explain what changed, what
artifacts were generated, which warnings were acknowledged, and why a given
operation cannot be auto-applied.

## Deferred

Deferred from this PR:

- renderer execution;
- sidecar persistence wiring;
- timeline UI;
- rollback implementation;
- OpenAI app-server tool invocation code;
- creative film simulation operation schemas.

Those should build on this record once schema samples and docs are stable.
