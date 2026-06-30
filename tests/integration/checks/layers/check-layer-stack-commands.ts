#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  ActorKind,
  ApprovalClass,
  dispatchLayerStackCommand,
  type LayerStackSidecarV1,
  layerMaskCommandEnvelopeV1Schema,
  layerStackSidecarV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src';

const commandStepSchema = z
  .object({
    commandType: z.enum([
      'layerMask.createLayer',
      'layerMask.deleteLayer',
      'layerMask.duplicateLayer',
      'layerMask.moveLayer',
      'layerMask.renameLayer',
      'layerMask.setLayerOpacity',
      'layerMask.setLayerVisibility',
    ]),
    id: z.string().trim().min(1),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();

const fixtureSchema = z
  .object({
    expectedFinalLayerIds: z.array(z.string().trim().min(1)),
    initialSidecar: layerStackSidecarV1Schema,
    steps: z.array(commandStepSchema).min(1),
    version: z.literal(1),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(await readFile('fixtures/layers/layer-stack-command-replay.json', 'utf8')),
);

const buildCommand = (step: z.infer<typeof commandStepSchema>, sidecar: LayerStackSidecarV1, dryRun: boolean) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-layer-stack-command-check',
      kind: ActorKind.Test,
      sessionId: 'session_layer_stack_commands',
    },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun ? 'Preview layer stack sidecar mutation.' : 'Apply approved layer stack sidecar mutation.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: `command_${step.id}_${dryRun ? 'dry_run' : 'apply'}`,
    commandType: step.commandType,
    correlationId: `corr_${step.id}`,
    dryRun,
    expectedGraphRevision: sidecar.graphRevision,
    idempotencyKey: `idem_${step.id}_${dryRun ? 'dry_run' : 'apply'}`,
    parameters: step.parameters,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: sidecar.sourceImagePath,
      kind: 'image',
    },
  });

let sidecar = fixture.initialSidecar;
const mutatedCommandTypes = new Set<string>();

for (const step of fixture.steps) {
  const dryRun = dispatchLayerStackCommand(buildCommand(step, sidecar, true), sidecar);
  if (!('predictedSidecar' in dryRun)) throw new Error(`${step.id}: expected dry-run sidecar prediction.`);
  if (dryRun.commandResult.mutates) throw new Error(`${step.id}: dry-run result must be non-mutating.`);
  if (sidecar.graphRevision !== dryRun.commandResult.sourceGraphRevision) {
    throw new Error(`${step.id}: dry-run source revision mismatch.`);
  }

  const applied = dispatchLayerStackCommand(buildCommand(step, sidecar, false), sidecar);
  if (!('sidecar' in applied)) throw new Error(`${step.id}: expected applied sidecar.`);
  if (!applied.commandResult.mutates) throw new Error(`${step.id}: apply result must mutate.`);
  if (applied.commandResult.changedLayerIds.length === 0) throw new Error(`${step.id}: expected changed layer IDs.`);
  if (JSON.stringify(applied.sidecar) !== JSON.stringify(layerStackSidecarV1Schema.parse(applied.sidecar))) {
    throw new Error(`${step.id}: sidecar roundtrip parse mismatch.`);
  }

  sidecar = applied.sidecar;
  mutatedCommandTypes.add(applied.commandResult.commandType);
}

const finalLayerIds = sidecar.layers.map((layer) => layer.id);
if (JSON.stringify(finalLayerIds) !== JSON.stringify(fixture.expectedFinalLayerIds)) {
  console.error('Expected final layer IDs:', JSON.stringify(fixture.expectedFinalLayerIds));
  console.error('Actual final layer IDs:', JSON.stringify(finalLayerIds));
  process.exit(1);
}

const staleCommand = buildCommand(fixture.steps[0], sidecar, false);
const staleResult = layerMaskCommandEnvelopeV1Schema.parse({
  ...staleCommand,
  expectedGraphRevision: fixture.initialSidecar.graphRevision,
});

let staleRejected = false;
try {
  dispatchLayerStackCommand(staleResult, sidecar);
} catch {
  staleRejected = true;
}

if (!staleRejected) throw new Error('Expected stale graph revision rejection.');

console.log(`layer stack commands ok (${fixture.steps.length} ops, ${mutatedCommandTypes.size} command types)`);
