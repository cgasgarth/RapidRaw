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
const dryRunPlanId = `dryrun_ai_denoise_${proof.output.contentHash.replace('fnv1a32:', '')}`;
const dryRunPlanHash = `sha256:${proof.output.contentHash.replace('fnv1a32:', '')}${proof.input.contentHash.replace(
  'fnv1a32:',
  '',
)}`;
const dryRunResult = aiEnhancementDryRunResultV1Schema.parse({
  commandId: dryRunCommand.commandId,
  commandType: dryRunCommand.commandType,
  correlationId: dryRunCommand.correlationId,
  dryRunPlanHash,
  dryRunPlanId,
  enhancementArtifacts: [
    {
      artifactId: 'artifact_ai_denoise_runtime_preview',
      contentHash: proof.output.contentHash,
      dimensions: {
        height: proof.output.height,
        width: proof.output.width,
      },
      kind: 'denoise_output',
      storage: 'temp_cache',
    },
  ],
  modelId: dryRunCommand.parameters.modelId,
  modelVersion: dryRunCommand.parameters.modelVersion,
  previewArtifacts: [
    {
      artifactId: 'artifact_ai_denoise_before_after_preview',
      contentHash: proof.provenance.outputContentHash,
      dimensions: {
        height: proof.output.height,
        width: proof.output.width,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  providerClass: dryRunCommand.parameters.providerClass,
  providerId: dryRunCommand.parameters.providerId,
  schemaVersion: dryRunCommand.schemaVersion,
  sourceContentHash: dryRunCommand.parameters.sourceContentHash,
  warnings: proof.warnings,
});
const { regionMaskArtifactId: _applyRegionMaskArtifactId, ...applyParameters } =
  sampleAiEnhancementApplyCommandEnvelopeV1.parameters;
const applyCommand = aiEnhancementCommandEnvelopeV1Schema.parse({
  ...sampleAiEnhancementApplyCommandEnvelopeV1,
  commandId: 'command_ai_denoise_app_server_apply',
  correlationId: 'corr_ai_denoise_app_server_apply',
  parameters: {
    ...applyParameters,
    acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
    acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    capability: 'denoise',
    modelId: proof.settings.modelId,
    modelVersion: proof.settings.modelVersion,
    sourceContentHash: proof.input.contentHash,
    strength: proof.settings.lumaStrength,
  },
});
const applyResult = aiEnhancementApplyResultV1Schema.parse({
  appliedGraphRevision: 'graph_rev_ai_denoise_app_server_apply',
  changedEditNodeIds: ['edit_node_ai_denoise_app_server_001'],
  commandId: applyCommand.commandId,
  commandType: applyCommand.commandType,
  correlationId: applyCommand.correlationId,
  dryRunPlanHash: applyCommand.parameters.acceptedDryRunPlanHash,
  dryRunPlanId: applyCommand.parameters.acceptedDryRunPlanId,
  outputArtifacts: [
    {
      artifactId: 'artifact_ai_denoise_app_server_output',
      contentHash: proof.output.contentHash,
      dimensions: {
        height: proof.output.height,
        width: proof.output.width,
      },
      kind: 'denoise_output',
      storage: 'sidecar_artifact',
    },
  ],
  provenanceEntryIds: ['prov_ai_denoise_app_server_001'],
  schemaVersion: applyCommand.schemaVersion,
  sourceGraphRevision: applyCommand.expectedGraphRevision,
  warnings: proof.warnings,
});

if (proof.runtimeStatus !== 'runtime_apply_capable' || !proof.mutates) {
  failures.push('Local AI denoise adapter must prove runtime apply-capable mutation.');
}
if (dryRunResult.sourceContentHash !== proof.input.contentHash) {
  failures.push('Denoise dry-run result must preserve input hash.');
}
if (applyResult.outputArtifacts[0]?.contentHash !== proof.output.contentHash) {
  failures.push('Denoise apply result must expose output artifact hash.');
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
