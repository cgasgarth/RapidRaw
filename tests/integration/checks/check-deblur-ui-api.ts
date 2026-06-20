#!/usr/bin/env bun

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  detailDeblurCommandEnvelopeV1Schema,
  detailDeblurDryRunResultV1Schema,
  detailDeblurRuntimeStateV1Schema,
  detailDeblurUiControlsV1Schema,
  toDetailDeblurControlsV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments.ts';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

const uiControls = detailDeblurUiControlsV1Schema.parse({
  deblurEnabled: true,
  deblurSigmaPx: 0.8,
  deblurStrength: 25,
});
const apiControls = toDetailDeblurControlsV1(uiControls);
assertEqual(apiControls.enabled, true, 'enabled conversion');
assertEqual(apiControls.psf, 'gaussian', 'PSF conversion');
assertEqual(apiControls.strength, 0.25, 'strength conversion');
assertEqual(apiControls.sigmaPx, 0.8, 'sigma conversion');

const legacyLoaded = normalizeLoadedAdjustments({ sharpness: 12 });
assertEqual(legacyLoaded.deblurEnabled, INITIAL_ADJUSTMENTS.deblurEnabled, 'legacy enabled default');
assertEqual(legacyLoaded.deblurStrength, INITIAL_ADJUSTMENTS.deblurStrength, 'legacy strength default');
assertEqual(legacyLoaded.deblurSigmaPx, INITIAL_ADJUSTMENTS.deblurSigmaPx, 'legacy sigma default');

const dryRunCommand = detailDeblurCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: 'agent',
    sessionId: 'session_detail_deblur_sample',
  },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Deblur dry-run validates controls without mutating preview, export, or sidecars.',
    state: 'not_required',
  },
  commandId: 'command_detail_deblur_dry_run_sample',
  commandType: 'detailDeblur.dryRunControls',
  correlationId: 'corr_detail_deblur_dry_run_sample',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_1181',
  parameters: apiControls,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
    virtualCopyId: null,
  },
});

const invalidApply = detailDeblurCommandEnvelopeV1Schema.safeParse({
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Invalid applied deblur command should not pass without edit approval.',
    state: 'not_required',
  },
  commandId: 'command_detail_deblur_apply_invalid',
  commandType: 'detailDeblur.applyControls',
  correlationId: 'corr_detail_deblur_apply_invalid',
  dryRun: false,
});
if (invalidApply.success) {
  fail('Expected applied deblur command without edit approval to fail.');
}

const runtime = detailDeblurRuntimeStateV1Schema.parse({
  applyStatus: 'applied',
  doesNotProve: ['real_raw_quality', 'gpu_parity', 'e2e_workflow'],
  effectiveControls: apiControls,
  orderedAfter: 'scene_linear_denoise',
  orderedBefore: 'capture_sharpen',
  runtimeStatus: 'preview_export_parity',
  stage: 'scene_linear_post_denoise',
  warnings: ['Synthetic workflow proof exists; real RAW quality remains tracked separately.'],
});

detailDeblurDryRunResultV1Schema.parse({
  commandId: dryRunCommand.commandId,
  commandType: 'detailDeblur.dryRunControls',
  correlationId: dryRunCommand.correlationId,
  dryRun: true,
  mutates: false,
  parameterDiff: [
    {
      nodeId: null,
      path: '/details/deblurStrength',
      previousValue: 0,
      value: 25,
    },
  ],
  predictedGraphRevision: 'graph_rev_1181_preview',
  previewArtifacts: [],
  runtime,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: dryRunCommand.expectedGraphRevision,
  warnings: ['UI/API wired; runtime preview/export parity is validated by check:deblur-workflow-smoke.'],
});

console.log('deblur UI/API ok');
