#!/usr/bin/env bun

import { strict as assert } from 'node:assert';

import { createRawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  type ToneColorCommandEnvelopeV1,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleRawEngineSceneColorPipelineV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  ToneColorAppServerExecutionMode,
  ToneColorAppServerRouteStatus,
} from '../../../../src/utils/toneColorAppServerRouteIds.ts';
import { TONE_COLOR_APP_SERVER_ROUTE_MANIFEST } from '../../../../src/utils/toneColorAppServerRoutes.ts';

type RuntimeColorCommandType =
  | 'toneColor.setChannelMixer'
  | 'toneColor.setColorBalanceRgb'
  | 'toneColor.setColorGrading';

type RuntimeColorCase = {
  commandType: RuntimeColorCommandType;
  expectedChangedNodeId: string;
  expectedDiffPath: string;
  parameters: Extract<ToneColorCommandEnvelopeV1, { commandType: RuntimeColorCommandType }>['parameters'];
};

const context = {
  now: () => new Date('2026-07-01T12:00:00.000Z'),
  requestId: 'request_color_command_bridge',
};

const cases: RuntimeColorCase[] = [
  {
    commandType: 'toneColor.setColorGrading',
    expectedChangedNodeId: 'tone_color_color_grading:image',
    expectedDiffPath: '/parameters/shadows/hueDegrees',
    parameters: {
      balance: -12,
      blend: 52,
      global: { hueDegrees: 35, luminance: 0, saturation: 6 },
      highlights: { hueDegrees: 48, luminance: 8, saturation: 18 },
      midtones: { hueDegrees: 28, luminance: 2, saturation: 10 },
      shadows: { hueDegrees: 220, luminance: -6, saturation: 20 },
    },
  },
  {
    commandType: 'toneColor.setChannelMixer',
    expectedChangedNodeId: 'tone_color_channel_mixer:image',
    expectedDiffPath: '/parameters/red/green',
    parameters: {
      blue: { blue: 100, constant: 0, green: 0, red: 0 },
      enabled: true,
      green: { blue: 0, constant: 0, green: 100, red: 0 },
      preserveLuminance: true,
      red: { blue: -4, constant: 0, green: 12, red: 96 },
    },
  },
  {
    commandType: 'toneColor.setColorBalanceRgb',
    expectedChangedNodeId: 'tone_color_color_balance_rgb:image',
    expectedDiffPath: '/parameters/midtones/red',
    parameters: {
      enabled: true,
      highlights: { blue: 0, green: 0, red: 0 },
      midtones: { blue: -10, green: 2, red: 14 },
      preserveLuminance: true,
      shadows: { blue: 4, green: 0, red: -2 },
    },
  },
];

for (const colorCase of cases) {
  const dryRunCommand = buildCommand(colorCase, 'dry_run', true);
  const applyCommand = buildCommand(colorCase, 'apply', false);
  const bridge = createRawEngineLocalAppServerBridge();

  const rejectedApply = await createRawEngineLocalAppServerBridge().dispatch(applyCommand, context);
  assert.equal(rejectedApply.ok, false, `${colorCase.commandType} apply before dry-run must be rejected.`);
  assert.equal(rejectedApply.reason, 'handler_failed');

  const dryRunDispatch = await bridge.dispatch(dryRunCommand, context);
  assert.equal(dryRunDispatch.ok, true, `${colorCase.commandType} dry-run must dispatch.`);
  if (!dryRunDispatch.ok) throw new Error(dryRunDispatch.message);
  const dryRun = toneColorDryRunResultV1Schema.parse(dryRunDispatch.result);
  assert.equal(dryRun.commandId, dryRunCommand.commandId);
  assert.equal(dryRun.commandType, colorCase.commandType);
  assert.equal(dryRun.mutates, false);
  assert.ok(dryRun.dryRunPlanHash?.startsWith('sha256:'), `${colorCase.commandType} dry-run needs plan hash.`);
  assert.ok(dryRun.dryRunPlanId?.startsWith('dryrun_'), `${colorCase.commandType} dry-run needs plan id.`);
  assert.ok(dryRun.parameterDiff.some((diff) => diff.path === colorCase.expectedDiffPath));
  assert.equal(
    dryRun.predictedGraphRevision,
    `${dryRunCommand.expectedGraphRevision}:preview:${dryRunCommand.commandId}`,
  );

  const duplicatePreviewCommand = {
    ...dryRunCommand,
    commandId: `${dryRunCommand.commandId}_duplicate`,
    correlationId: `${dryRunCommand.correlationId}_duplicate`,
  };
  const duplicateDispatch = await createRawEngineLocalAppServerBridge().dispatch(duplicatePreviewCommand, context);
  assert.equal(duplicateDispatch.ok, true, `${colorCase.commandType} duplicate dry-run must dispatch.`);
  if (!duplicateDispatch.ok) throw new Error(duplicateDispatch.message);
  const duplicateDryRun = toneColorDryRunResultV1Schema.parse(duplicateDispatch.result);
  assert.equal(duplicateDryRun.dryRunPlanHash, dryRun.dryRunPlanHash);
  assert.equal(duplicateDryRun.dryRunPlanId, dryRun.dryRunPlanId);

  const applyDispatch = await bridge.dispatch(applyCommand, context);
  assert.equal(applyDispatch.ok, true, `${colorCase.commandType} apply must dispatch after dry-run.`);
  if (!applyDispatch.ok) throw new Error(applyDispatch.message);
  const apply = toneColorMutationResultV1Schema.parse(applyDispatch.result);
  assert.equal(apply.commandId, applyCommand.commandId);
  assert.equal(apply.commandType, colorCase.commandType);
  assert.equal(apply.mutates, true);
  assert.ok(apply.changedNodeIds.includes(colorCase.expectedChangedNodeId));
}

const malformed = await createRawEngineLocalAppServerBridge().dispatch(
  {
    ...buildCommand(cases[0], 'malformed', true),
    parameters: {
      ...cases[0].parameters,
      shadows: { hueDegrees: 360, luminance: 0, saturation: 10 },
    },
  },
  context,
);
assert.equal(malformed.ok, false, 'Malformed color grading command must be rejected.');
assert.equal(malformed.reason, 'invalid_command');

for (const commandType of cases.map((colorCase) => colorCase.commandType)) {
  assertRouteStatus(commandType, ToneColorAppServerRouteStatus.Mapped);
}

for (const commandType of [
  'toneColor.setToneCurve',
  'toneColor.setWhiteBalance',
  'toneColor.setLevels',
  'toneColor.setBlackWhiteMixer',
] as const) {
  assertRouteStatus(commandType, ToneColorAppServerRouteStatus.MappedUnavailable);
}

console.log('color command bridge ok (grading + channel mixer + RGB balance dry-run/apply/rejection/routes)');

function buildCommand(colorCase: RuntimeColorCase, suffix: string, dryRun: boolean): ToneColorCommandEnvelopeV1 {
  return toneColorCommandEnvelopeV1Schema.parse({
    ...sampleToneColorCommandEnvelopeV1,
    actor: {
      id: 'codex-app-server',
      kind: 'agent',
      sessionId: 'session_color_command_bridge',
    },
    approval: dryRun
      ? {
          approvalClass: 'preview_only',
          reason: `Preview ${colorCase.commandType}.`,
          state: 'not_required',
        }
      : {
          approvalClass: 'edit_apply',
          reason: `Apply accepted ${colorCase.commandType}.`,
          state: 'approved',
        },
    colorPipeline: sampleRawEngineSceneColorPipelineV1,
    commandId: `${colorCase.commandType.replaceAll('.', '_')}_${suffix}`,
    commandType: colorCase.commandType,
    correlationId: `corr_${colorCase.commandType.replaceAll('.', '_')}_${suffix}`,
    dryRun,
    expectedGraphRevision: `graph_rev_${colorCase.commandType.replaceAll('.', '_')}_initial`,
    idempotencyKey: `idem_${colorCase.commandType.replaceAll('.', '_')}_${suffix}`,
    parameters: colorCase.parameters,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: '/photos/color-command/IMG_4612.CR3',
      kind: 'image',
    },
  });
}

function assertRouteStatus(
  commandType: ToneColorCommandEnvelopeV1['commandType'],
  expectedStatus: ToneColorAppServerRouteStatus,
): void {
  const routes = TONE_COLOR_APP_SERVER_ROUTE_MANIFEST.routes.filter((route) => route.commandType === commandType);
  assert.equal(routes.length, 2, `${commandType} must expose dry-run and apply route entries.`);
  for (const mode of [ToneColorAppServerExecutionMode.DryRunCommand, ToneColorAppServerExecutionMode.ApplyDryRunPlan]) {
    const route = routes.find((candidate) => candidate.executionMode === mode);
    assert.ok(route, `${commandType} must expose ${mode}.`);
    assert.equal(route.status, expectedStatus, `${commandType} ${mode} route status mismatch.`);
  }
}
