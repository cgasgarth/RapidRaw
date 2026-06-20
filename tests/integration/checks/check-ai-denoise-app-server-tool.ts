#!/usr/bin/env bun

import { AI_APP_SERVER_TOOL_ROUTES } from '../../../src/utils/aiAppServerToolRoutes.ts';
import {
  AiAppServerToolCapability,
  AiAppServerToolName,
  AiAppServerToolRouteExecutionMode,
  AiAppServerToolRouteSourceKind,
} from '../../../src/utils/aiAppServerToolRouteIds.ts';
import { applyLocalAiDenoiseAdapter, buildSyntheticAiDenoiseInput } from '../../../src/utils/localAiDenoiseAdapter.ts';
import { buildRawEngineAppServerRouteCatalog } from '../../../src/utils/rawEngineAppServerHost.ts';
import { createRawEngineLocalAppServerBridge } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleAiEnhancementApplyCommandEnvelopeV1,
  sampleAiEnhancementCommandEnvelopeV1,
  sampleAiAppServerToolManifestV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const failures: string[] = [];
const routeByToolName = new Map(
  AI_APP_SERVER_TOOL_ROUTES.filter((route) => route.sourceKind === AiAppServerToolRouteSourceKind.AppServerTool).map(
    (route) => [route.appServerToolName, route],
  ),
);
const toolByName = new Map(sampleAiAppServerToolManifestV1.tools.map((tool) => [tool.toolName, tool]));
const routeCatalogToolNames = new Set(buildRawEngineAppServerRouteCatalog().flatMap((route) => route.toolNames));

const dryRunRoute = routeByToolName.get(AiAppServerToolName.EnhancementDryRunCommand);
const applyRoute = routeByToolName.get(AiAppServerToolName.EnhancementApplyCommand);
if (
  dryRunRoute?.toolCapability !== AiAppServerToolCapability.Denoise ||
  dryRunRoute.executionMode !== AiAppServerToolRouteExecutionMode.DryRunCommand
) {
  failures.push('Denoise dry-run route must map ai.enhancement.dry_run_command.');
}
if (
  applyRoute?.toolCapability !== AiAppServerToolCapability.Denoise ||
  applyRoute.executionMode !== AiAppServerToolRouteExecutionMode.ApplyDryRunPlan
) {
  failures.push('Denoise apply route must map ai.enhancement.apply_command.');
}

for (const toolName of [AiAppServerToolName.EnhancementDryRunCommand, AiAppServerToolName.EnhancementApplyCommand]) {
  const tool = toolByName.get(toolName);
  if (tool === undefined || !tool.allowedCapabilities.includes(AiAppServerToolCapability.Denoise)) {
    failures.push(`${toolName} must allow denoise capability.`);
  }

  if (!routeCatalogToolNames.has(toolName)) {
    failures.push(`${toolName} must be exposed by the host route catalog.`);
  }
}

const input = buildSyntheticAiDenoiseInput();
const proof = applyLocalAiDenoiseAdapter({ input });
const bridge = createRawEngineLocalAppServerBridge();
const { regionMaskArtifactId: _dryRunRegionMaskArtifactId, ...dryRunParameters } =
  sampleAiEnhancementCommandEnvelopeV1.parameters;
const dryRunCommand = aiEnhancementCommandEnvelopeV1Schema.parse({
  ...sampleAiEnhancementCommandEnvelopeV1,
  commandId: 'command_ai_denoise_app_server_dry_run',
  correlationId: 'corr_ai_denoise_app_server',
  parameters: {
    ...dryRunParameters,
    capability: 'denoise',
    modelId: proof.settings.modelId,
    modelVersion: proof.settings.modelVersion,
    sourceContentHash: proof.input.contentHash,
    strength: proof.settings.lumaStrength,
  },
});
const bridgeDryRun = await bridge.dispatch(dryRunCommand, {
  now: () => new Date('2026-06-20T00:00:00.000Z'),
  requestId: 'req_ai_denoise_app_server_dry_run',
});
let dryRunResult: ReturnType<typeof aiEnhancementDryRunResultV1Schema.parse> | undefined;
if (!bridgeDryRun.ok) {
  failures.push(`Denoise bridge dry-run failed: ${bridgeDryRun.message}`);
} else {
  dryRunResult = aiEnhancementDryRunResultV1Schema.parse(bridgeDryRun.result);
}
const { regionMaskArtifactId: _applyRegionMaskArtifactId, ...applyParameters } =
  sampleAiEnhancementApplyCommandEnvelopeV1.parameters;
const applyCommand = aiEnhancementCommandEnvelopeV1Schema.parse({
  ...sampleAiEnhancementApplyCommandEnvelopeV1,
  commandId: 'command_ai_denoise_app_server_apply',
  correlationId: 'corr_ai_denoise_app_server_apply',
  parameters: {
    ...applyParameters,
    acceptedDryRunPlanHash: dryRunResult?.dryRunPlanHash ?? 'dryrun_unavailable',
    acceptedDryRunPlanId: dryRunResult?.dryRunPlanId ?? 'dryrun_unavailable',
    capability: 'denoise',
    modelId: proof.settings.modelId,
    modelVersion: proof.settings.modelVersion,
    sourceContentHash: proof.input.contentHash,
    strength: proof.settings.lumaStrength,
  },
});
const bridgeApply = await bridge.dispatch(applyCommand, {
  now: () => new Date('2026-06-20T00:00:01.000Z'),
  requestId: 'req_ai_denoise_app_server_apply',
});
let applyResult: ReturnType<typeof aiEnhancementApplyResultV1Schema.parse> | undefined;
if (!bridgeApply.ok) {
  failures.push(`Denoise bridge apply failed: ${bridgeApply.message}`);
} else {
  applyResult = aiEnhancementApplyResultV1Schema.parse(bridgeApply.result);
}

if (proof.runtimeStatus !== 'runtime_apply_capable' || !proof.mutates) {
  failures.push('Local AI denoise adapter must prove runtime apply-capable mutation.');
}
if (dryRunResult?.sourceContentHash !== proof.input.contentHash) {
  failures.push('Denoise dry-run result must preserve input hash.');
}
if (applyResult?.outputArtifacts[0]?.kind !== 'denoise_output') {
  failures.push('Denoise apply result must expose a denoise output artifact.');
}
if (applyResult?.sourceGraphRevision !== applyCommand.expectedGraphRevision) {
  failures.push('Denoise apply result must preserve source graph revision.');
}
if (applyResult?.provenanceEntryIds[0] !== `prov_denoise_${applyCommand.commandId}`) {
  failures.push('Denoise apply result must expose deterministic provenance entry id.');
}

const bridgeAuditEvents = bridge.listAuditEvents();
const applyAuditEvent = bridgeAuditEvents.find((event) => event.commandId === applyCommand.commandId);
if (applyAuditEvent?.mutates !== true || applyAuditEvent.status !== 'completed') {
  failures.push('Denoise apply must record a completed mutating audit event.');
}

if (failures.length > 0) {
  console.error(`AI denoise app-server tool failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ai denoise app-server tool ok changed=${proof.metrics.changedPixelCount} maxDelta=${proof.metrics.inputOutputMaxDelta.toFixed(
    5,
  )}`,
);
