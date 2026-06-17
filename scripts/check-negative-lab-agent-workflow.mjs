#!/usr/bin/env bun

import {
  buildNegativeLabAcceptedBatchApplyRouteResult,
  buildNegativeLabAcceptedBatchPlanRouteResult,
  buildNegativeLabBatchSummaryRouteResult,
  buildNegativeLabConversionPlanResult,
  buildNegativeLabDensitometerRouteResult,
  buildNegativeLabFrameHealthRouteResult,
  buildNegativeLabStockFamilyConversionRouteResult,
  NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST,
} from '../src/utils/negativeLabAppServerRoutes.ts';
import {
  rawEngineAgentReplayFixtureV1Schema,
  negativeLabAppServerToolManifestV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabAppServerToolManifestV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabDryRunResultV1,
  sampleToolRegistryV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';

const actor = {
  id: 'codex-app-server',
  kind: 'agent',
  sessionId: 'session_negative_lab_agent_e2e',
};
const target = {
  imagePath: '/roll/001.CR3',
  kind: 'image',
};
const sampleRect = { height: 0.6, width: 0.12, x: 0.02, y: 0.2 };
const dryRunCommand = {
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: true,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
};
const conversionCommand = {
  outputFormat: 'jpeg_proof',
  paths: dryRunCommand.targetPaths,
  presetId: 'negative_lab.generic.c41.neutral.v1',
  sampleRect,
  scope: 'all',
  suffix: 'Positive',
};

const manifest = negativeLabAppServerToolManifestV1Schema.parse(sampleNegativeLabAppServerToolManifestV1);
const routeNames = new Set(NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.map((route) => route.commandName));
const requiredRouteNames = [
  'negative.lab.build_conversion_plan',
  'negative.lab.build_densitometer_readout',
  'negative.lab.build_frame_health_report',
  'negative.lab.build_batch_dry_run_summary',
  'negative.lab.accept_batch_dry_run_plan',
  'negative.lab.build_accepted_batch_apply',
  'negative.lab.build_stock_family_conversion_plan',
];

for (const routeName of requiredRouteNames) {
  if (!routeNames.has(routeName)) {
    throw new Error(`Missing Negative Lab agent route: ${routeName}`);
  }
}

if (!manifest.tools.some((tool) => tool.toolName === 'negativelab.preview_conversion' && !tool.mutates)) {
  throw new Error('Missing non-mutating Negative Lab preview tool.');
}

if (
  !manifest.tools.some(
    (tool) => tool.toolName === 'negativelab.apply_planned_command' && tool.mutates && tool.requiresDryRunPlan,
  )
) {
  throw new Error('Missing approved Negative Lab apply tool with dry-run requirement.');
}

const densitometerReadout = buildNegativeLabDensitometerRouteResult({
  baseFogEstimate: {
    baseDensity: [0.146, 0.221, 0.357],
    baseRgb: [0.714, 0.601, 0.44],
    blueWeight: 0.82,
    confidence: 0.91,
    greenWeight: 0.95,
    redWeight: 1.18,
  },
});
const frameHealthReport = buildNegativeLabFrameHealthRouteResult(dryRunCommand);
const batchSummary = buildNegativeLabBatchSummaryRouteResult(dryRunCommand);
const acceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult(dryRunCommand);
const acceptedApplyPlan = buildNegativeLabAcceptedBatchApplyRouteResult({
  acceptedPlan,
  conversion: conversionCommand,
  dryRun: dryRunCommand,
});
const conversionPlan = buildNegativeLabConversionPlanResult(conversionCommand);
const stockFamilyConversionPlan = buildNegativeLabStockFamilyConversionRouteResult({
  outputFormat: 'jpeg_proof',
  paths: dryRunCommand.targetPaths,
  sampleRect,
  scope: 'all',
  stockFamilyRegistryId: 'negative_lab.stock_family.c41_portrait_color_negative.v1',
  suffix: 'Positive',
});

if (densitometerReadout.status !== 'strong_cast') {
  throw new Error('Negative Lab agent densitometer route did not flag the color cast.');
}

if (frameHealthReport.activeFrameId !== 'negative-lab-frame-2' || batchSummary.plannedApplyCount !== 2) {
  throw new Error('Negative Lab agent dry-run routes did not produce expected frame/roll evidence.');
}

if (
  acceptedApplyPlan.acceptedDryRunPlanId !== acceptedPlan.acceptedDryRunPlanId ||
  acceptedApplyPlan.acceptedDryRunPlanHash !== acceptedPlan.acceptedDryRunPlanHash ||
  acceptedApplyPlan.apply.paths.join('|') !== '/roll/001.CR3|/roll/002.CR3'
) {
  throw new Error('Negative Lab agent apply route did not preserve accepted dry-run identity.');
}

if (conversionPlan.params.base_fog_sample?.x !== sampleRect.x) {
  throw new Error('Negative Lab agent conversion route did not preserve the sampled base/fog rectangle.');
}

if (
  stockFamilyConversionPlan.stockFamily.genericPresetId !== 'negative_lab.generic.c41.portrait.v1' ||
  stockFamilyConversionPlan.conversionPlan.presetId !== 'negative_lab.generic.c41.portrait.v1' ||
  stockFamilyConversionPlan.conversionPlan.params.base_fog_sample?.x !== sampleRect.x
) {
  throw new Error('Negative Lab agent stock-family route did not map registry id to a conversion plan.');
}

const fixture = rawEngineAgentReplayFixtureV1Schema.parse({
  actor,
  deterministicReplayHash: 'sha256:negative-lab-agent-route-tool-e2e',
  finalGraphRevision: sampleNegativeLabApplyResultV1.appliedGraphRevision,
  initialGraphRevision: 'graph_rev_negative_7',
  registry: sampleToolRegistryV1,
  replayId: 'replay_negative_lab_agent_route_tool_e2e_001',
  replayKind: 'agent_tool_replay',
  schemaVersion: 1,
  steps: [
    {
      auditLog: {
        affectedArtifactIds: sampleNegativeLabDryRunResultV1.previewArtifacts.map((artifact) => artifact.artifactId),
        affectedImageIds: [target.imagePath],
        noOverwritePolicy: 'never_overwrite_original',
        parameterDiff: [
          {
            path: '/parameters/base_fog_sample',
            value: sampleRect,
          },
        ],
        toolCall: {
          inputSchemaName: 'NegativeLabCommandEnvelopeV1',
          toolKind: 'dry_run',
          toolName: 'negativelab.preview_conversion',
        },
        warnings: ['route_proof_only_no_renderer_export'],
      },
      approval: {
        approvalClass: 'preview_only',
        reason: 'Previewing Negative Lab conversion builds analysis, batch dry-run, and preview artifacts.',
        state: 'not_required',
      },
      deterministic: true,
      dryRun: true,
      input: sampleNegativeLabCommandEnvelopeV1,
      inputContentHash: 'sha256:negative-lab-agent-preview-input',
      inputSchemaName: 'NegativeLabCommandEnvelopeV1',
      mutates: false,
      output: sampleNegativeLabDryRunResultV1,
      outputContentHash: 'sha256:negative-lab-agent-preview-output',
      outputSchemaName: 'NegativeLabDryRunResultV1',
      prerequisiteStepIds: [],
      sourceGraphRevision: 'graph_rev_negative_7',
      stepId: 'negative_lab_agent_preview',
      toolKind: 'dry_run',
      toolName: 'negativelab.preview_conversion',
      warnings: ['route_proof_only_no_renderer_export'],
    },
    {
      auditLog: {
        affectedArtifactIds: sampleNegativeLabApplyResultV1.changeSet.artifactHandles.map(
          (artifact) => artifact.artifactId,
        ),
        affectedImageIds: [target.imagePath],
        noOverwritePolicy: 'never_overwrite_original',
        parameterDiff: [
          {
            path: '/dryRunPlanId',
            value: sampleNegativeLabApplyPlanRequestV1.dryRunPlanId,
          },
        ],
        rollbackPoint: {
          graphRevision: 'graph_rev_negative_7',
          undoRevision: 'undo_negative_lab_agent_apply_001',
        },
        toolCall: {
          inputSchemaName: 'NegativeLabApplyPlanRequestV1',
          toolKind: 'apply',
          toolName: 'negativelab.apply_planned_command',
        },
        warnings: ['route_proof_only_no_renderer_export'],
      },
      approval: {
        approvalClass: 'edit_apply',
        reason: 'Applying Negative Lab conversion requires the locally approved dry-run plan.',
        state: 'approved',
      },
      deterministic: true,
      dryRun: false,
      input: sampleNegativeLabApplyPlanRequestV1,
      inputContentHash: 'sha256:negative-lab-agent-apply-input',
      inputSchemaName: 'NegativeLabApplyPlanRequestV1',
      mutates: true,
      output: sampleNegativeLabApplyResultV1,
      outputContentHash: 'sha256:negative-lab-agent-apply-output',
      outputSchemaName: 'NegativeLabApplyResultV1',
      prerequisiteStepIds: ['negative_lab_agent_preview'],
      resultingGraphRevision: sampleNegativeLabApplyResultV1.appliedGraphRevision,
      sourceGraphRevision: 'graph_rev_negative_7',
      stepId: 'negative_lab_agent_apply',
      toolKind: 'apply',
      toolName: 'negativelab.apply_planned_command',
      warnings: ['route_proof_only_no_renderer_export'],
    },
  ],
  target,
  validationProfile: 'golden_replay',
  warnings: ['route_proof_only_no_renderer_export'],
});

if (fixture.steps.length !== 2 || fixture.finalGraphRevision !== sampleNegativeLabApplyResultV1.appliedGraphRevision) {
  throw new Error('Negative Lab agent replay fixture did not validate the preview/apply chain.');
}

if (sampleNegativeLabApplyResultV1.changeSet.artifactHandles.length === 0) {
  throw new Error('Negative Lab agent apply fixture did not include an edited artifact handle.');
}

console.log(
  `negative lab agent workflow ok (${requiredRouteNames.length} routes, ${fixture.steps.length} replay steps, route proof only)`,
);
