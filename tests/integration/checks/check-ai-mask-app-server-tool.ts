#!/usr/bin/env bun

import { AI_APP_SERVER_TOOL_ROUTES } from '../../../src/utils/aiAppServerToolRoutes.ts';
import {
  AiAppServerToolCapability,
  AiAppServerToolName,
  AiAppServerToolRouteExecutionMode,
  AiAppServerToolRouteSourceKind,
} from '../../../src/utils/aiAppServerToolRouteIds.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';
import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  aiToolApplyResultV1Schema,
  aiToolCommandEnvelopeV1Schema,
  aiToolDryRunResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleAiAppServerToolManifestV1,
  sampleAiToolApplyCommandEnvelopeV1,
  sampleAiToolCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const failures: string[] = [];
const toolByName = new Map(sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, tool]));
const routeCatalogToolNames = new Set(buildRawEngineAppServerRouteCatalog().flatMap((route) => route.toolNames));

const dryRunRoute = AI_APP_SERVER_TOOL_ROUTES.find(
  (route) =>
    route.appServerToolName === AiAppServerToolName.MaskDryRunSubject &&
    route.sourceOperation === 'generate_ai_subject_mask',
);
const applyRoute = AI_APP_SERVER_TOOL_ROUTES.find(
  (route) =>
    route.appServerToolName === AiAppServerToolName.MaskApplySubject &&
    route.sourceKind === AiAppServerToolRouteSourceKind.AppServerTool,
);
if (
  dryRunRoute?.toolCapability !== AiAppServerToolCapability.SubjectMask ||
  dryRunRoute.executionMode !== AiAppServerToolRouteExecutionMode.DryRunCommand
) {
  failures.push('Subject-mask dry-run route must map generate_ai_subject_mask to ai.mask.dry_run_subject.');
}
if (
  applyRoute?.toolCapability !== AiAppServerToolCapability.SubjectMask ||
  applyRoute.executionMode !== AiAppServerToolRouteExecutionMode.ApplyDryRunPlan
) {
  failures.push('Subject-mask apply route must map ai.mask.apply_subject.');
}

for (const toolName of [AiAppServerToolName.MaskDryRunSubject, AiAppServerToolName.MaskApplySubject]) {
  const tool = toolByName.get(toolName);
  if (tool === undefined || !tool.allowedCapabilities.includes(AiAppServerToolCapability.SubjectMask)) {
    failures.push(`${toolName} must allow subject-mask capability.`);
  }

  if (!routeCatalogToolNames.has(toolName)) {
    failures.push(`${toolName} must be exposed by the host route catalog.`);
  }
}

const bridge = createRawEngineLocalAppServerBridge();
const dryRunCommand = aiToolCommandEnvelopeV1Schema.parse({
  ...sampleAiToolCommandEnvelopeV1,
  commandId: 'command_ai_subject_mask_app_server_dry_run',
  correlationId: 'corr_ai_subject_mask_app_server',
  parameters: {
    ...sampleAiToolCommandEnvelopeV1.parameters,
    sourceContentHash: 'sha256:synthetic-subject-mask-source',
  },
});
const bridgeDryRun = await bridge.dispatch(dryRunCommand, {
  now: () => new Date('2026-06-20T00:02:00.000Z'),
  requestId: 'req_ai_subject_mask_app_server_dry_run',
});
let dryRunResult: ReturnType<typeof aiToolDryRunResultV1Schema.parse> | undefined;
if (!bridgeDryRun.ok) {
  failures.push(`Subject-mask bridge dry-run failed: ${bridgeDryRun.message}`);
} else {
  dryRunResult = aiToolDryRunResultV1Schema.parse(bridgeDryRun.result);
}

const applyCommand = aiToolCommandEnvelopeV1Schema.parse({
  ...sampleAiToolApplyCommandEnvelopeV1,
  commandId: 'command_ai_subject_mask_app_server_apply',
  correlationId: 'corr_ai_subject_mask_app_server_apply',
  parameters: {
    ...sampleAiToolApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanHash: dryRunResult?.dryRunPlanHash ?? 'dryrun_unavailable',
    acceptedDryRunPlanId: dryRunResult?.dryRunPlanId ?? 'dryrun_unavailable',
    sourceContentHash: dryRunCommand.parameters.sourceContentHash,
  },
});
const bridgeApply = await bridge.dispatch(applyCommand, {
  now: () => new Date('2026-06-20T00:02:01.000Z'),
  requestId: 'req_ai_subject_mask_app_server_apply',
});
let applyResult: ReturnType<typeof aiToolApplyResultV1Schema.parse> | undefined;
if (!bridgeApply.ok) {
  failures.push(`Subject-mask bridge apply failed: ${bridgeApply.message}`);
} else {
  applyResult = aiToolApplyResultV1Schema.parse(bridgeApply.result);
}

if (dryRunResult?.sourceContentHash !== dryRunCommand.parameters.sourceContentHash) {
  failures.push('Subject-mask dry-run result must preserve source content hash.');
}
if (dryRunResult?.maskArtifacts[0]?.kind !== 'mask') {
  failures.push('Subject-mask dry-run must expose a mask artifact.');
}
if (applyResult?.outputArtifacts[0]?.kind !== 'mask') {
  failures.push('Subject-mask apply result must expose a mask sidecar artifact.');
}
if (applyResult?.sourceGraphRevision !== applyCommand.expectedGraphRevision) {
  failures.push('Subject-mask apply result must preserve source graph revision.');
}
if (applyResult?.provenanceEntryIds[0] !== `prov_subject_mask_${applyCommand.commandId}`) {
  failures.push('Subject-mask apply result must expose deterministic provenance entry id.');
}

const bridgeAuditEvents = bridge.listAuditEvents();
const dryRunAuditEvent = bridgeAuditEvents.find((event) => event.commandId === dryRunCommand.commandId);
const applyAuditEvent = bridgeAuditEvents.find((event) => event.commandId === applyCommand.commandId);
if (dryRunAuditEvent?.mutates !== false || dryRunAuditEvent.status !== 'completed') {
  failures.push('Subject-mask dry-run must record a completed non-mutating audit event.');
}
if (applyAuditEvent?.mutates !== true || applyAuditEvent.status !== 'completed') {
  failures.push('Subject-mask apply must record a completed mutating audit event.');
}

if (failures.length > 0) {
  console.error(`AI mask app-server tool failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ai mask app-server tool ok plan=${dryRunResult?.dryRunPlanId ?? 'missing'} mask=${
    applyResult?.changedMaskIds[0] ?? 'missing'
  }`,
);
