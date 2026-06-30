#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';
import { NegativeLabAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/negativeLabAppServerRuntime.ts';
import {
  negativeLabApplyPlanRequestV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  rawEngineAgentReplayFixtureV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabAppServerToolManifestV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleToolRegistryV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { NegativeLabAppServerCommandName } from '../../../src/utils/negativeLabAppServerCommandNames.ts';
import {
  buildNegativeLabAcceptedBatchApplyRouteResult,
  buildNegativeLabAcceptedBatchPlanRouteResult,
  buildNegativeLabBatchSummaryRouteResult,
  buildNegativeLabConversionPlanResult,
  buildNegativeLabDensitometerRouteResult,
  buildNegativeLabFrameHealthRouteResult,
  buildNegativeLabQcProofRouteResult,
  buildNegativeLabStockFamilyConversionRouteResult,
  NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST,
} from '../../../src/utils/negativeLabAppServerRoutes.ts';
import { NegativeLabOutputFormatId } from '../../../src/utils/negativeLabOutputFormatIds.ts';

const OUTPUT_PATH = 'docs/validation/negative-lab-agent-workflow-proof-2026-06-16.html';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');
const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

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
const frameHealthCommand = {
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: true,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
};
const dryRunCommand = {
  ...frameHealthCommand,
  presetId: 'negative_lab.generic.c41.neutral.v1',
};
const conversionCommand = {
  outputFormat: NegativeLabOutputFormatId.JpegProof,
  paths: frameHealthCommand.targetPaths,
  presetId: 'negative_lab.generic.c41.neutral.v1',
  sampleRect,
  scope: 'all',
  suffix: 'Positive',
};

const manifest = negativeLabAppServerToolManifestV1Schema.parse(sampleNegativeLabAppServerToolManifestV1);
const runtimeBus = new NegativeLabAppServerRuntimeToolBusV1(manifest);
const runtimeDryRun = runtimeBus.execute({
  request: sampleNegativeLabCommandEnvelopeV1,
  toolName: 'negativelab.preview_conversion',
});
if (runtimeDryRun.kind !== 'dry_run') {
  throw new Error('Negative Lab runtime bus did not return a dry-run result.');
}
const runtimeApplyRequest = negativeLabApplyPlanRequestV1Schema.parse({
  ...sampleNegativeLabApplyPlanRequestV1,
  acceptedDryRunPlanHash: runtimeDryRun.acceptedDryRunPlanHash,
  dryRunPlanId: runtimeDryRun.dryRun.dryRunPlanId,
});
const runtimeApply = runtimeBus.execute({
  request: runtimeApplyRequest,
  toolName: 'negativelab.apply_planned_command',
});
if (runtimeApply.kind !== 'apply') {
  throw new Error('Negative Lab runtime bus did not return an apply result.');
}
if (runtimeApply.apply.dryRunCommandId !== runtimeDryRun.dryRun.commandId) {
  throw new Error('Negative Lab runtime bus did not preserve dry-run command identity.');
}
if (runtimeApply.apply.changeSet.artifactHandles.length === 0) {
  throw new Error('Negative Lab runtime bus apply did not emit artifact handles.');
}
const runtimeV2Command = {
  ...sampleNegativeLabCommandEnvelopeV1,
  commandId: 'command_negative_set_conversion_recipe_v2_app_server_proof',
  correlationId: 'corr_negative_set_conversion_recipe_v2_app_server_proof',
  idempotencyKey: 'idem_negative_set_conversion_recipe_v2_app_server_proof',
  parameters: {
    ...sampleNegativeLabCommandEnvelopeV1.parameters,
    conversionModel: {
      algorithmId: 'negative_density_print_v2',
      algorithmVersion: 2,
      densityMax: 4,
      epsilonPolicyId: 'density_epsilon_v1',
      negativeDensityTolerance: 0.02,
    },
    densityPrintCurve: {
      contrastGrade: 1.12,
      densityOffset: 0.03,
      midtoneShape: -0.08,
      outputTag: 'export_linear',
      schemaVersion: 1,
      shoulderStrength: 0.32,
      targetBlackDensity: 1.72,
      targetWhiteDensity: 0.05,
      toeStrength: 0.28,
    },
    frameSelection: {
      ...sampleNegativeLabCommandEnvelopeV1.parameters.frameSelection,
      frameIds: ['frame_0001', 'frame_0002'],
    },
    previewRequest: {
      ...sampleNegativeLabCommandEnvelopeV1.parameters.previewRequest,
      artifactPurposes: [
        'objective_positive_preview',
        'density_map',
        'clipping_overlay',
        'warning_report',
        'parameter_diff',
      ],
    },
  },
};
const runtimeV2DryRun = runtimeBus.execute({
  request: runtimeV2Command,
  toolName: 'negativelab.preview_conversion',
});
if (runtimeV2DryRun.kind !== 'dry_run') {
  throw new Error('Negative Lab runtime bus did not return a v2 dry-run result.');
}
const runtimeV2ApplyRequest = negativeLabApplyPlanRequestV1Schema.parse({
  ...sampleNegativeLabApplyPlanRequestV1,
  acceptedDryRunPlanHash: runtimeV2DryRun.acceptedDryRunPlanHash,
  commandId: runtimeV2DryRun.dryRun.commandId,
  dryRunPlanId: runtimeV2DryRun.dryRun.dryRunPlanId,
});
const runtimeV2Apply = runtimeBus.execute({
  request: runtimeV2ApplyRequest,
  toolName: 'negativelab.apply_planned_command',
});
if (runtimeV2Apply.kind !== 'apply') {
  throw new Error('Negative Lab runtime bus did not return a v2 apply result.');
}
if (
  runtimeV2DryRun.dryRun.proof?.algorithm.algorithmId !== 'negative_density_print_v2' ||
  runtimeV2DryRun.dryRun.proof.algorithm.algorithmVersion !== 2 ||
  runtimeV2DryRun.dryRun.proof.printCurveParams?.outputTag !== 'export_linear' ||
  runtimeV2DryRun.dryRun.proof.scanMetricsSummary.frameCount !== 2 ||
  runtimeV2DryRun.dryRun.proof.acceptedSuggestionSummary.state !== 'suggested_only' ||
  runtimeV2DryRun.dryRun.proof.acceptedSuggestionSummary.acceptedFrameCount !== 0 ||
  runtimeV2DryRun.dryRun.proof.selectedCrosstalkProvenance.provenance !== 'rawengine_process_profile' ||
  runtimeV2DryRun.dryRun.proof.previewExportArtifactParity.previewArtifactIds.length !== 1 ||
  runtimeV2DryRun.dryRun.proof.warningCodes[0] !== 'low_acquisition_confidence'
) {
  throw new Error(
    'Negative Lab v2 dry-run proof did not expose algorithm, metrics, suggestions, crosstalk, and warnings.',
  );
}
if (
  runtimeV2Apply.apply.proof?.algorithm.algorithmId !== 'negative_density_print_v2' ||
  runtimeV2Apply.apply.proof.acceptedSuggestionSummary.state !== 'accepted_into_plan' ||
  runtimeV2Apply.apply.proof.acceptedSuggestionSummary.acceptedFrameCount !== 2 ||
  runtimeV2Apply.apply.proof.previewExportArtifactParity.exportArtifactIds[0] !==
    runtimeV2Apply.apply.changeSet.artifactHandles[0]?.artifactId ||
  !runtimeV2Apply.apply.proof.previewExportArtifactParity.dimensionsMatch ||
  runtimeV2Apply.apply.changeSet.warningCodes[0] !== 'low_acquisition_confidence'
) {
  throw new Error('Negative Lab v2 apply proof did not preserve accepted proof and preview/export parity metadata.');
}
for (const rejectedRequest of [
  {
    ...runtimeV2ApplyRequest,
    acceptedDryRunPlanHash: 'sha256:not_the_accepted_v2_plan',
  },
  {
    ...runtimeV2ApplyRequest,
    commandId: 'command_negative_set_conversion_recipe_stale_v2_app_server_proof',
  },
]) {
  try {
    runtimeBus.execute({
      request: rejectedRequest,
      toolName: 'negativelab.apply_planned_command',
    });
    throw new Error('Unaccepted Negative Lab v2 runtime plan was applied.');
  } catch (error) {
    if (error instanceof Error && error.message === 'Unaccepted Negative Lab v2 runtime plan was applied.') {
      throw error;
    }
  }
}
const routeNames = new Set(NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.map((route) => route.commandName));
const requiredRouteNames = [
  NegativeLabAppServerCommandName.ConversionPlan,
  NegativeLabAppServerCommandName.Densitometer,
  NegativeLabAppServerCommandName.FrameHealth,
  NegativeLabAppServerCommandName.QcProof,
  NegativeLabAppServerCommandName.BatchSummary,
  NegativeLabAppServerCommandName.AcceptBatchPlan,
  NegativeLabAppServerCommandName.AcceptedBatchApply,
  NegativeLabAppServerCommandName.StockFamilyConversion,
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
const frameHealthReport = buildNegativeLabFrameHealthRouteResult(frameHealthCommand);
const qcProofReport = buildNegativeLabQcProofRouteResult(frameHealthCommand);
const batchSummary = buildNegativeLabBatchSummaryRouteResult(frameHealthCommand);
const acceptedPlan = buildNegativeLabAcceptedBatchPlanRouteResult(dryRunCommand);
const acceptedApplyPlan = buildNegativeLabAcceptedBatchApplyRouteResult({
  acceptedPlan,
  conversion: conversionCommand,
  dryRun: dryRunCommand,
});
const conversionPlan = buildNegativeLabConversionPlanResult(conversionCommand);
const stockFamilyConversionPlan = buildNegativeLabStockFamilyConversionRouteResult({
  outputFormat: NegativeLabOutputFormatId.JpegProof,
  paths: frameHealthCommand.targetPaths,
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
  qcProofReport.totalFrameCount !== frameHealthCommand.targetPaths.length ||
  qcProofReport.includedFrameCount !== frameHealthCommand.includedPaths.length ||
  qcProofReport.frames[2]?.exportBlockedReason !== 'Frame excluded from batch.'
) {
  throw new Error('Negative Lab agent QC route did not expose proof/report evidence.');
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
  finalGraphRevision: runtimeApply.apply.appliedGraphRevision,
  initialGraphRevision: 'graph_rev_negative_7',
  registry: sampleToolRegistryV1,
  replayId: 'replay_negative_lab_agent_route_tool_e2e_001',
  replayKind: 'agent_tool_replay',
  schemaVersion: 1,
  steps: [
    {
      auditLog: {
        affectedArtifactIds: runtimeDryRun.dryRun.previewArtifacts.map((artifact) => artifact.artifactId),
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
        warnings: ['runtime_bus_synthetic_no_real_scan_quality_claim'],
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
      output: runtimeDryRun.dryRun,
      outputContentHash: runtimeDryRun.acceptedDryRunPlanHash,
      outputSchemaName: 'NegativeLabDryRunResultV1',
      prerequisiteStepIds: [],
      sourceGraphRevision: 'graph_rev_negative_7',
      stepId: 'negative_lab_agent_preview',
      toolKind: 'dry_run',
      toolName: 'negativelab.preview_conversion',
      warnings: ['runtime_bus_synthetic_no_real_scan_quality_claim'],
    },
    {
      auditLog: {
        affectedArtifactIds: runtimeApply.apply.changeSet.artifactHandles.map((artifact) => artifact.artifactId),
        affectedImageIds: [target.imagePath],
        noOverwritePolicy: 'never_overwrite_original',
        parameterDiff: [
          {
            path: '/dryRunPlanId',
            value: runtimeApplyRequest.dryRunPlanId,
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
        warnings: ['runtime_bus_synthetic_no_real_scan_quality_claim'],
      },
      approval: {
        approvalClass: 'edit_apply',
        reason: 'Applying Negative Lab conversion requires the locally approved dry-run plan.',
        state: 'approved',
      },
      deterministic: true,
      dryRun: false,
      input: runtimeApplyRequest,
      inputContentHash: runtimeDryRun.acceptedDryRunPlanHash,
      inputSchemaName: 'NegativeLabApplyPlanRequestV1',
      mutates: true,
      output: runtimeApply.apply,
      outputContentHash: `sha256:${runtimeApply.apply.appliedGraphRevision}`,
      outputSchemaName: 'NegativeLabApplyResultV1',
      prerequisiteStepIds: ['negative_lab_agent_preview'],
      resultingGraphRevision: runtimeApply.apply.appliedGraphRevision,
      sourceGraphRevision: 'graph_rev_negative_7',
      stepId: 'negative_lab_agent_apply',
      toolKind: 'apply',
      toolName: 'negativelab.apply_planned_command',
      warnings: ['runtime_bus_synthetic_no_real_scan_quality_claim'],
    },
  ],
  target,
  validationProfile: 'golden_replay',
  warnings: ['runtime_bus_synthetic_no_real_scan_quality_claim'],
});

if (fixture.steps.length !== 2 || fixture.finalGraphRevision !== runtimeApply.apply.appliedGraphRevision) {
  throw new Error('Negative Lab agent replay fixture did not validate the preview/apply chain.');
}

if (runtimeApply.apply.changeSet.artifactHandles.length === 0) {
  throw new Error('Negative Lab agent apply fixture did not include an edited artifact handle.');
}

const routeRows = requiredRouteNames
  .map(
    (routeName) => `<tr>
      <td><code>${escapeHtml(routeName)}</code></td>
      <td>${routeNames.has(routeName) ? 'mapped' : 'missing'}</td>
    </tr>`,
  )
  .join('\n');

const replayRows = fixture.steps
  .map(
    (step) => `<tr>
      <td><code>${escapeHtml(step.stepId)}</code></td>
      <td>${escapeHtml(step.toolName)}</td>
      <td>${step.dryRun ? 'dry-run' : 'apply'}</td>
      <td>${step.mutates ? 'yes' : 'no'}</td>
      <td>${escapeHtml(step.approval.state)}</td>
      <td>${step.auditLog.affectedArtifactIds.map((artifactId) => `<code>${escapeHtml(artifactId)}</code>`).join(', ')}</td>
    </tr>`,
  )
  .join('\n');

const qcRows = qcProofReport.frames
  .map(
    (frame) => `<tr>
      <td><code>${escapeHtml(frame.frameId)}</code></td>
      <td>${escapeHtml(frame.scanLabel)}</td>
      <td>${frame.included ? 'included' : 'excluded'}</td>
      <td>${frame.needsReview ? 'review' : 'ready'}</td>
      <td>${escapeHtml(frame.exportBlockedReason ?? frame.recommendedAction)}</td>
    </tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Negative Lab Agent Workflow Proof</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --ink: #111827;
        --muted: #5b6472;
        --panel: #ffffff;
        --line: #d8dee8;
        --accent: #0f766e;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 24px 56px;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      header,
      section {
        margin-bottom: 28px;
      }

      header {
        display: grid;
        gap: 10px;
      }

      h1 {
        font-size: 32px;
        line-height: 1.15;
      }

      h2 {
        font-size: 21px;
        margin-bottom: 12px;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .tile {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      .tile strong {
        display: block;
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 6px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 10px;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }

      th {
        background: #edf2f7;
        color: var(--muted);
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }

      @media (max-width: 820px) {
        .summary {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Negative Lab Agent Workflow Proof</h1>
        <p>Runtime-bus proof artifact for preview, QC, accepted dry-run apply, and governed stock-family planning.</p>
      </header>

      <section class="summary">
        <div class="tile"><strong>Replay</strong><code>${escapeHtml(fixture.replayId)}</code></div>
        <div class="tile"><strong>Routes</strong>${requiredRouteNames.length}</div>
        <div class="tile"><strong>QC frames</strong>${qcProofReport.totalFrameCount}</div>
        <div class="tile"><strong>Apply paths</strong>${acceptedApplyPlan.apply.paths.length}</div>
      </section>

      <section>
        <h2>Mapped Routes</h2>
        <table>
          <thead><tr><th>Command</th><th>Status</th></tr></thead>
          <tbody>${routeRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Replay Steps</h2>
        <table>
          <thead><tr><th>Step</th><th>Tool</th><th>Mode</th><th>Mutates</th><th>Approval</th><th>Artifacts</th></tr></thead>
          <tbody>${replayRows}</tbody>
        </table>
      </section>

      <section>
        <h2>QC Proof Rows</h2>
        <table>
          <thead><tr><th>Frame</th><th>Scan</th><th>Batch</th><th>QC</th><th>Action</th></tr></thead>
          <tbody>${qcRows}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>
`;

const prettierConfig = (await resolveConfig(OUTPUT_PATH)) ?? {};
const formattedHtml = await format(html, { ...prettierConfig, filepath: OUTPUT_PATH, parser: 'html' });

if (shouldUpdate) {
  writeFileSync(OUTPUT_PATH, formattedHtml);
  console.log('negative lab agent workflow proof updated');
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, 'utf8');
if (current !== formattedHtml) {
  throw new Error(
    `${OUTPUT_PATH} is stale. Run bun tests/integration/checks/check-negative-lab-agent-workflow.ts --update`,
  );
}

console.log(
  `negative lab agent workflow ok (${requiredRouteNames.length} routes, ${fixture.steps.length} runtime steps)`,
);
