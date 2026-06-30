#!/usr/bin/env bun

import {
  ApprovalClass,
  detailDeblurCommandEnvelopeV1Schema,
  detailDeblurDryRunResultV1Schema,
  detailDeblurRuntimeStateV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  DetailAppServerCommandType,
  DetailAppServerExecutionMode,
  DetailAppServerRouteStatus,
  DetailAppServerToolName,
} from '../../../src/utils/detailAppServerRouteIds.ts';
import { DETAIL_APP_SERVER_ROUTES } from '../../../src/utils/detailAppServerRoutes.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';

const failures: string[] = [];
const routesByToolName = new Map(DETAIL_APP_SERVER_ROUTES.map((route) => [route.toolName, route]));
const catalogToolNames = new Set(buildRawEngineAppServerRouteCatalog().flatMap((route) => route.toolNames));

for (const [toolName, executionMode] of [
  [DetailAppServerToolName.DryRunCommand, DetailAppServerExecutionMode.DryRunCommand],
  [DetailAppServerToolName.ApplyCommand, DetailAppServerExecutionMode.ApplyDryRunPlan],
] as const) {
  const route = routesByToolName.get(toolName);
  if (route === undefined) {
    failures.push(`${toolName} route missing.`);
    continue;
  }

  if (route.executionMode !== executionMode || route.status !== DetailAppServerRouteStatus.MappedUnavailable) {
    failures.push(`${toolName} must expose ${executionMode} with explicit unavailable status.`);
  }

  if (!catalogToolNames.has(toolName)) {
    failures.push(`${toolName} must be visible in the host route catalog.`);
  }
}

const controls = {
  enabled: true,
  psf: 'gaussian',
  sigmaPx: 0.8,
  strength: 0.25,
} as const;
const dryRunCommand = detailDeblurCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: 'agent',
    sessionId: 'session_detail_deblur_app_server',
  },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Deblur dry-run validates controls without mutating preview, export, or sidecars.',
    state: 'not_required',
  },
  commandId: 'command_detail_deblur_app_server_dry_run',
  commandType: DetailAppServerCommandType.DryRunControls,
  correlationId: 'corr_detail_deblur_app_server',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_deblur_app_server_001',
  parameters: controls,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
    virtualCopyId: null,
  },
});
const applyCommand = detailDeblurCommandEnvelopeV1Schema.parse({
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'User requested deblur apply; app-server currently reports runtime unavailable instead of mutating.',
    state: 'approved',
  },
  commandId: 'command_detail_deblur_app_server_apply',
  commandType: DetailAppServerCommandType.ApplyControls,
  correlationId: 'corr_detail_deblur_app_server_apply',
  dryRun: false,
});
const unavailableRuntime = detailDeblurRuntimeStateV1Schema.parse({
  applyStatus: 'blocked',
  doesNotProve: ['preview_export_parity', 'real_raw_quality', 'gpu_parity', 'e2e_workflow', 'runtime_image_change'],
  effectiveControls: controls,
  orderedAfter: 'scene_linear_denoise',
  orderedBefore: 'capture_sharpen',
  runtimeStatus: 'blocked',
  skipReason: 'preview_not_wired',
  stage: 'scene_linear_post_denoise',
  warnings: ['Deblur app-server apply is explicitly unavailable until runtime preview/export wiring exists.'],
});
const dryRunResult = detailDeblurDryRunResultV1Schema.parse({
  commandId: dryRunCommand.commandId,
  commandType: dryRunCommand.commandType,
  correlationId: dryRunCommand.correlationId,
  dryRun: true,
  mutates: false,
  parameterDiff: [
    {
      nodeId: null,
      path: '/details/deblurStrength',
      previousValue: 0,
      value: controls.strength,
    },
  ],
  predictedGraphRevision: dryRunCommand.expectedGraphRevision,
  previewArtifacts: [],
  runtime: unavailableRuntime,
  schemaVersion: dryRunCommand.schemaVersion,
  sourceGraphRevision: dryRunCommand.expectedGraphRevision,
  warnings: unavailableRuntime.warnings,
});

if (applyCommand.approval.state !== 'approved') {
  failures.push('Deblur apply command must prove approved edit-apply request validation.');
}
if (dryRunResult.runtime.applyStatus !== 'blocked' || dryRunResult.runtime.skipReason !== 'preview_not_wired') {
  failures.push('Deblur app-server result must report explicit unavailable state.');
}
if (dryRunResult.runtime.doesNotProve.includes('runtime_image_change') === false) {
  failures.push('Deblur unavailable result must not claim runtime image change.');
}

if (failures.length > 0) {
  console.error(`Deblur app-server tool failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`deblur app-server tool unavailable ok (${DETAIL_APP_SERVER_ROUTES.length} routes)`);
