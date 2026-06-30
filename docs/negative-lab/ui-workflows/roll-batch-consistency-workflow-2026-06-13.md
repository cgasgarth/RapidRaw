# Negative Lab Roll Batch Consistency Workflow

- Date: 2026-06-13
- Issue: #154 `negative-lab(batch): add roll-level batch consistency workflow`
- Scope: schema contract for coordinating roll-level Negative Lab batch
  conversion, consistency review, and QC handoff.

## Purpose

Roll-level negative conversion needs one workflow record that explains which
frames are included, which frames anchor normalization, which dry-run stages are
ready, which stages have been applied, and which QC artifacts should be
reviewed before export. This keeps batch processing deterministic for UI,
app-server tools, sidecars, and future automation.

## Schema Surface

This PR adds:

- `NegativeLabRollBatchWorkflowV1`
- `NegativeLabRollBatchWorkflowStageV1`
- `NegativeLabRollBatchWorkflowStagePlanV1`
- sample artifact
  `packages/rawengine-schema/samples/negative-lab/workflows/negative-lab-roll-batch-workflow-v1.json`

## Workflow Stages

The workflow stage plan tracks:

- frame detection review;
- base/fog sampling;
- conversion recipe setup;
- roll normalization;
- positive variant creation;
- QC review.

Each stage records command IDs, dry-run plan IDs, warning codes, dependencies,
and status. Dry-run-ready stages must include dry-run plan IDs. Applied stages
must include command IDs.

## Consistency Rules

The Zod schema rejects workflows that:

- include rejected frames in a batch;
- use anchor frames outside the selected frame set;
- report roll consistency metrics for frames outside the selected frame set;
- omit required consistency stages;
- duplicate stage names;
- mark dry-run-ready stages without dry-run plans.

## Downstream Use

The Negative Lab UI can use this record to show a roll queue, anchor-frame
choices, batch dry-run readiness, consistency warnings, and QC proof status.

## Frame Health Dry-Run Summary

`src/schemas/negativeLabFrameHealthSchemas.ts` now defines a frame health report
and batch dry-run summary for the workspace. The summary records affected frame
IDs, skipped frame IDs, planned apply count, and rolled-up warning codes before a
batch conversion mutates files. The public checker
`bun run check:negative-lab-frame-health` proves the schema builder keeps those
counts and warning lists consistent.
App-server tools can use the same record to explain why a batch is ready,
blocked, or waiting for review before any mutating apply step.
