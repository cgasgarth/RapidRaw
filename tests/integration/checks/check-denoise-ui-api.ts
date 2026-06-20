#!/usr/bin/env bun

import {
  ApprovalClass,
  detailDenoiseCommandEnvelopeV1Schema,
  detailDenoiseDryRunResultV1Schema,
  detailDenoiseRuntimeStateV1Schema,
  detailDenoiseUiControlsV1Schema,
  toDetailDenoiseControlsV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const failures = [];

const uiControls = detailDenoiseUiControlsV1Schema.parse({
  colorNoiseReduction: 35,
  lumaNoiseReduction: 62,
});
const apiControls = toDetailDenoiseControlsV1(uiControls);

if (apiControls.lumaStrength !== 0.62 || apiControls.chromaStrength !== 0.35) {
  failures.push('UI denoise controls did not normalize to API strengths.');
}

const dryRunCommand = detailDenoiseCommandEnvelopeV1Schema.safeParse({
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Validate denoise controls without mutating pixels.',
    state: 'not_required',
  },
  commandId: 'command_detail_denoise_dry_run',
  commandType: 'detailDenoise.dryRunControls',
  correlationId: 'corr_detail_denoise',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_001',
  parameters: apiControls,
  schemaVersion: 1,
  target: { id: 'image_001', kind: 'image' },
});

if (!dryRunCommand.success) {
  failures.push('Valid denoise dry-run command was rejected.');
}

const invalidApply = detailDenoiseCommandEnvelopeV1Schema.safeParse({
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Wrong approval classification.',
    state: 'not_required',
  },
  commandId: 'command_detail_denoise_apply',
  commandType: 'detailDenoise.applyControls',
  correlationId: 'corr_detail_denoise',
  dryRun: false,
  expectedGraphRevision: 'graph_rev_001',
  parameters: apiControls,
  schemaVersion: 1,
  target: { id: 'image_001', kind: 'image' },
});

if (invalidApply.success) {
  failures.push('Denoise apply command without approved edit-apply classification was accepted.');
}

const runtime = detailDenoiseRuntimeStateV1Schema.safeParse({
  applyStatus: 'applied',
  doesNotProve: ['real_raw_quality', 'gpu_parity', 'e2e_workflow'],
  effectiveControls: apiControls,
  mutates: true,
  orderedAfter: 'demosaic',
  orderedBefore: 'scene_linear_deblur',
  runtimeStatus: 'preview_export_parity',
  stage: 'scene_linear_denoise',
});

if (!runtime.success) {
  failures.push('Denoise UI/API runtime status was rejected.');
}

const overclaim = detailDenoiseRuntimeStateV1Schema.safeParse({
  applyStatus: 'not_executed',
  doesNotProve: ['real_raw_quality', 'gpu_parity', 'e2e_workflow'],
  effectiveControls: apiControls,
  mutates: false,
  orderedAfter: 'demosaic',
  orderedBefore: 'scene_linear_deblur',
  runtimeStatus: 'ui_api_wired',
  skipReason: 'preview_export_not_proven',
  stage: 'scene_linear_denoise',
});

if (overclaim.success) {
  failures.push('Denoise UI/API runtime status was allowed to overclaim preview/export parity.');
}

const dryRunResult = detailDenoiseDryRunResultV1Schema.safeParse({
  commandId: 'command_detail_denoise_dry_run',
  commandType: 'detailDenoise.dryRunControls',
  correlationId: 'corr_detail_denoise',
  dryRun: true,
  mutates: false,
  runtime: runtime.success ? runtime.data : null,
  schemaVersion: 1,
  warnings: ['UI/API dry run validated; preview/export parity remains a separate runtime proof.'],
});

if (!dryRunResult.success) {
  failures.push('Denoise dry-run result schema rejected valid status.');
}

if (failures.length > 0) {
  console.error('Denoise UI/API validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Validated denoise UI/API dry-run contract.');
