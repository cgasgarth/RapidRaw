#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  LinearGradientMaskCommandRuntime,
  renderLinearGradientMask,
} from '../../../packages/rawengine-schema/src/linearGradientMaskCommandRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const fixtureSchema = z
  .object({
    height: z.number().int().positive(),
    linearAlpha: z.array(z.number().min(0).max(1)).min(1),
    width: z.number().int().positive(),
  })
  .strict();

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/gradient/linear-gradient-mask-command.json'), 'utf8')),
);
const dryRunCommand = layerMaskCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_linear_gradient_mask_command',
  },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Preview a linear gradient mask alpha before mutating the edit graph.',
    state: 'not_required',
  },
  commandId: 'command_linear_gradient_mask_preview',
  commandType: 'layerMask.createGradientMask',
  correlationId: 'corr_linear_gradient_mask',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_linear_gradient_source',
  idempotencyKey: 'idem_linear_gradient_mask_preview',
  parameters: {
    gradient: {
      end: { x: 1, y: 0.5 },
      feather: 0,
      gradientKind: 'linear',
      invert: false,
      start: { x: 0, y: 0.5 },
    },
    maskName: 'Linear Sky Holdout',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
  },
});
const applyCommand = layerMaskCommandEnvelopeV1Schema.parse({
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Apply the accepted linear gradient mask into the edit graph.',
    state: 'approved',
  },
  commandId: 'command_linear_gradient_mask_apply',
  dryRun: false,
  idempotencyKey: 'idem_linear_gradient_mask_apply',
});

const failures: Array<string> = [];
const render = renderLinearGradientMask({ command: dryRunCommand, height: fixture.height, width: fixture.width });
if (JSON.stringify(render.alpha) !== JSON.stringify(fixture.linearAlpha)) {
  failures.push('Linear gradient alpha render does not match fixture.');
}
if (!render.contentHash.startsWith('fnv1a32:')) {
  failures.push('Linear gradient render must produce a stable content hash.');
}

const invertedRender = renderLinearGradientMask({
  command: layerMaskCommandEnvelopeV1Schema.parse({
    ...dryRunCommand,
    parameters: {
      ...dryRunCommand.parameters,
      gradient: {
        ...dryRunCommand.parameters.gradient,
        invert: true,
      },
    },
  }),
  height: fixture.height,
  width: fixture.width,
});
if (invertedRender.alpha[0] !== 1 || invertedRender.alpha.at(-1) !== 0) {
  failures.push('Inverted linear gradient alpha must reverse mask endpoints.');
}

const unmatchedRuntime = new LinearGradientMaskCommandRuntime({ height: fixture.height, width: fixture.width });
try {
  unmatchedRuntime.dispatch(applyCommand);
  failures.push('Linear gradient apply should fail before matching dry-run.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('matching dry-run')) {
    failures.push('Linear gradient apply rejection should explain missing matching dry-run.');
  }
}

const runtime = new LinearGradientMaskCommandRuntime({ height: fixture.height, width: fixture.width });
const dryRunResult = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(dryRunCommand));
if (dryRunResult.mutates || dryRunResult.maskArtifacts[0]?.contentHash !== render.contentHash) {
  failures.push('Linear gradient dry-run must be non-mutating and expose the rendered mask artifact.');
}

const applyResult = layerMaskMutationResultV1Schema.parse(runtime.dispatch(applyCommand));
if (!applyResult.mutates || applyResult.changedMaskIds[0] !== render.maskId) {
  failures.push('Linear gradient apply must mutate the accepted rendered mask id.');
}

if (failures.length > 0) {
  console.error('Linear gradient mask command validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`linear gradient mask command ok (${fixture.width}x${fixture.height})`);
