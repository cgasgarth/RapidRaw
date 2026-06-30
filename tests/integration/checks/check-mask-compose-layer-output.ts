#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  type MaskAlphaArtifact,
  renderComposedMask,
} from '../../../packages/rawengine-schema/src/maskComposeCommandRuntime.ts';
import { applyComposedMaskToLayerPixels } from '../../../packages/rawengine-schema/src/maskComposeLayerApplication.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const composeModeSchema = z.enum(['add', 'subtract', 'intersect']);
const fixtureSchema = z
  .object({
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
  .passthrough();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/mask-compose-command.json'), 'utf8')),
);
const sourceMasks: Array<MaskAlphaArtifact> = fixture.sources.map((source) => ({
  ...source,
  height: fixture.height,
  width: fixture.width,
}));
const sourcePixels = z
  .array(z.number().min(0).max(1))
  .length(fixture.width * fixture.height)
  .parse([0.08, 0.2, 0.36, 0.52, 0.7, 0.86]);

const buildCommand = (mode: z.infer<typeof composeModeSchema>) =>
  layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_mask_compose_layer_output',
    },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview composed mask output before applying layer-scoped pixels.',
      state: 'not_required',
    },
    commandId: `command_mask_compose_layer_${mode}`,
    commandType: 'layerMask.combineMasks',
    correlationId: `corr_mask_compose_layer_${mode}`,
    dryRun: true,
    expectedGraphRevision: 'graph_rev_mask_compose_layer_source',
    parameters: {
      combineMode: mode,
      maskName: `${mode} layer output proof`,
      sourceMaskIds: sourceMasks.map((source) => source.maskId),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/session/IMG_0001.CR3',
      kind: 'image',
    },
  });

const failures: Array<string> = [];

for (const mode of composeModeSchema.options) {
  const render = renderComposedMask({ command: buildCommand(mode), sourceMasks });
  const output = applyComposedMaskToLayerPixels({
    adjustment: {
      exposureEv: 0.8,
      layerId: `layer_${mode}_warmth`,
      layerName: `${mode} warmth`,
      opacity: 0.75,
    },
    composedMask: {
      alpha: render.alpha,
      contentHash: render.contentHash,
      height: render.height,
      maskId: render.maskId,
      width: render.width,
    },
    compositionMode: mode,
    sourceMaskIds: render.sourceMaskIds,
    sourcePixels,
  });
  const replay = applyComposedMaskToLayerPixels({
    adjustment: output.sidecarRecord.layer,
    composedMask: {
      alpha: render.alpha,
      contentHash: output.sidecarRecord.composedMask.contentHash,
      height: output.sidecarRecord.composedMask.height,
      maskId: output.sidecarRecord.composedMask.maskId,
      width: output.sidecarRecord.composedMask.width,
    },
    compositionMode: output.sidecarRecord.composedMask.mode,
    sourceMaskIds: output.sidecarRecord.composedMask.sourceMaskIds,
    sourcePixels,
  });

  if (output.changedPixelCount <= 0 || output.maxDelta <= 0) {
    failures.push(`${mode}: composed mask layer output must change pixels.`);
  }
  if (output.outputContentHash === render.contentHash) {
    failures.push(`${mode}: output hash must be distinct from mask alpha hash.`);
  }
  if (output.outputContentHash !== replay.outputContentHash) {
    failures.push(`${mode}: sidecar replay must reproduce output hash.`);
  }
  if (output.sidecarRecord.noOverwritePolicy !== 'never_overwrite_original') {
    failures.push(`${mode}: sidecar must preserve never-overwrite-original policy.`);
  }
  if (output.sidecarRecord.composedMask.coordinateSpace !== 'source_asset_pixels') {
    failures.push(`${mode}: sidecar must preserve source pixel coordinate space.`);
  }
  if (output.overlayAlpha.length !== sourcePixels.length) {
    failures.push(`${mode}: overlay alpha must cover every source pixel.`);
  }
}

try {
  applyComposedMaskToLayerPixels({
    adjustment: {
      exposureEv: 0.8,
      layerId: 'layer_invalid',
      layerName: 'Invalid',
      opacity: 0.75,
    },
    composedMask: {
      alpha: [0.5],
      height: fixture.height,
      maskId: 'mask_invalid',
      width: fixture.width,
    },
    compositionMode: 'add',
    sourceMaskIds: ['mask_a', 'mask_b'],
    sourcePixels,
  });
  failures.push('Composed mask layer output should reject mismatched alpha/source lengths.');
} catch (error) {
  if (!(error instanceof z.ZodError)) {
    failures.push('Composed mask layer output length rejection should be a Zod error.');
  }
}

if (failures.length > 0) {
  console.error('Mask compose layer output validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`mask compose layer output ok (${composeModeSchema.options.length} modes, ${sourcePixels.length} pixels)`);
