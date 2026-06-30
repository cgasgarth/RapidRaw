#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  type MaskAlphaArtifact,
  MaskComposeCommandRuntime,
  renderComposedMask,
} from '../../../packages/rawengine-schema/src/maskComposeCommandRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const composeModeSchema = z.enum(['add', 'subtract', 'intersect']);

const fixtureSchema = z
  .object({
    expected: z.record(composeModeSchema, z.array(z.number().min(0).max(1)).min(1)),
    height: z.number().int().positive(),
    sources: z
      .array(
        z
          .object({
            alpha: z.array(z.number().min(0).max(1)).min(1),
            maskId: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(2),
    width: z.number().int().positive(),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/mask-compose-command.json'), 'utf8')),
);

const sourceMasks: Array<MaskAlphaArtifact> = fixture.sources.map((source) => ({
  ...source,
  height: fixture.height,
  width: fixture.width,
}));

const buildCommand = (mode: z.infer<typeof composeModeSchema>, dryRun: boolean) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_mask_compose_command',
    },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun
        ? 'Preview a composed mask alpha before mutating the edit graph.'
        : 'Apply the accepted composed mask.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId: dryRun ? `command_mask_compose_${mode}_preview` : `command_mask_compose_${mode}_apply`,
    commandType: 'layerMask.combineMasks',
    correlationId: `corr_mask_compose_${mode}`,
    dryRun,
    expectedGraphRevision: 'graph_rev_mask_compose_source',
    idempotencyKey: dryRun ? `idem_mask_compose_${mode}_preview` : `idem_mask_compose_${mode}_apply`,
    parameters: {
      combineMode: mode,
      maskName: `${mode} mask proof`,
      sourceMaskIds: sourceMasks.map((source) => source.maskId),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_0001.CR3',
      kind: 'image',
    },
  });

const failures: Array<string> = [];
const nearlyEqual = (left: number, right: number): boolean => Math.abs(left - right) <= 0.000001;
const alphaMatches = (actual: ReadonlyArray<number>, expected: ReadonlyArray<number>): boolean =>
  actual.length === expected.length &&
  actual.every((value, index) => nearlyEqual(value, expected[index] ?? Number.NaN));

for (const mode of composeModeSchema.options) {
  const dryRunCommand = buildCommand(mode, true);
  const render = renderComposedMask({ command: dryRunCommand, sourceMasks });
  if (!alphaMatches(render.alpha, fixture.expected[mode])) {
    failures.push(`${mode}: composed alpha does not match fixture.`);
  }
  if (!render.contentHash.startsWith('fnv1a32:')) {
    failures.push(`${mode}: composed mask must produce a stable content hash.`);
  }

  const runtime = new MaskComposeCommandRuntime();
  const dryRunResult = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand, sourceMasks));
  if (dryRunResult.mutates || dryRunResult.maskArtifacts[0]?.contentHash !== render.contentHash) {
    failures.push(`${mode}: dry-run must be non-mutating and expose the composed mask artifact.`);
  }

  const applyResult = layerMaskMutationResultV1Schema.parse(runtime.dispatch(buildCommand(mode, false), sourceMasks));
  if (!applyResult.mutates || applyResult.changedMaskIds[0] !== render.maskId) {
    failures.push(`${mode}: apply must mutate the accepted composed mask id.`);
  }
}

try {
  new MaskComposeCommandRuntime().dispatch(buildCommand('add', false), sourceMasks);
  failures.push('Compose apply should fail before matching dry-run.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('matching dry-run')) {
    failures.push('Compose apply rejection should explain missing matching dry-run.');
  }
}

try {
  const resizedSource = sourceMasks[0];
  if (resizedSource === undefined) throw new Error('Missing compose source fixture.');
  renderComposedMask({
    command: buildCommand('add', true),
    sourceMasks: [{ ...resizedSource, height: 1, width: fixture.width * fixture.height }, sourceMasks[1]].filter(
      (source): source is MaskAlphaArtifact => source !== undefined,
    ),
  });
  failures.push('Compose render should reject mismatched source dimensions.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('matching dimensions')) {
    failures.push('Compose dimension rejection should explain mismatched source dimensions.');
  }
}

if (failures.length > 0) {
  console.error('Mask compose command validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`mask compose command ok (${fixture.width}x${fixture.height}, ${composeModeSchema.options.length} modes)`);
