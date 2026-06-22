#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import prettier from 'prettier';
import type { z } from 'zod';

import { runAgentColorEditWorkflowV1 } from '../../../packages/rawengine-schema/src/agentColorEditWorkflow.ts';
import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import { sampleRawEngineSceneColorPipelineV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  rawEngineToolRegistryV1Schema,
  toneColorCommandEnvelopeV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { agentExpertEditDemoWorkflowSchema } from '../../../src/schemas/agentExpertEditDemoWorkflowSchemas.ts';

const REPORT_PATH = 'docs/validation/agent-expert-edit-demo-workflow-2026-06-21.json';
const HTML_PATH = 'docs/validation/agent-expert-edit-demo-workflow-2026-06-21.html';
const UPDATE_REPORT = process.argv.includes('--update');

const context = {
  now: () => new Date('2026-06-21T13:30:00.000Z'),
  requestId: 'request_agent_expert_edit_demo_2844',
};
const userPrompt =
  'Inspect DSC_2844.NEF, warm the scene slightly, lift shadows, protect highlights, preview it, then apply to a virtual copy if approved.';
const assistantPlan =
  'Read available local app-server tools, build a deterministic basic-tone dry-run, block apply until approval, then apply the matching command to a virtual copy and publish before/after/audit evidence.';
const target = {
  imagePath: '/photos/agent-demo/DSC_2844.NEF',
  kind: 'image',
  virtualCopyId: 'vc_agent_expert_edit_demo_2844',
} as const;

const dryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: 'agent',
    sessionId: 'session_agent_expert_edit_demo_2844',
  },
  approval: {
    approvalClass: 'preview_only',
    reason: 'Preview the expert edit plan before mutating the virtual-copy graph.',
    state: 'not_required',
  },
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
  commandId: 'command_agent_expert_edit_demo_dry_run_2844',
  commandType: 'toneColor.setBasicTone',
  correlationId: 'corr_agent_expert_edit_demo_2844',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_agent_expert_edit_demo_initial_2844',
  idempotencyKey: 'idem_agent_expert_edit_demo_dry_run_2844',
  parameters: {
    blackPoint: -1,
    clarity: 6,
    contrast: 9,
    exposureEv: 0.18,
    highlights: -22,
    saturation: 3,
    shadows: 20,
    whitePoint: 5,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target,
});

const applyCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...dryRunCommand,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'Approved deterministic dry-run; apply only to the virtual-copy edit graph.',
    state: 'approved',
  },
  commandId: 'command_agent_expert_edit_demo_apply_2844',
  dryRun: false,
  idempotencyKey: 'idem_agent_expert_edit_demo_apply_2844',
});

const rejectedBridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await rejectedBridge.dispatch(applyCommand, context);
if (rejectedApply.ok) throw new Error('Demo apply must be rejected before a matching dry-run.');
const rejectedAudit = parseSingleAuditEvent(rejectedBridge.listAuditEvents(), 'Rejected apply audit missing.');

const bridge = createRawEngineLocalAppServerBridge();
const registryResult = await bridge.dispatch(buildRawEngineLocalAppServerToolRegistryQuery('agent_demo_registry_2844'));
if (!registryResult.ok) throw new Error(`Registry inspect failed: ${registryResult.message}`);
const registry = rawEngineToolRegistryV1Schema.parse(registryResult.result);

const workflowBridge = createRawEngineLocalAppServerBridge();
const workflow = await runAgentColorEditWorkflowV1({
  applyCommand,
  bridge: workflowBridge,
  context,
  dryRunCommand,
});
if (!workflow.dryRun.parameterDiffPaths.includes('/parameters/highlights')) {
  throw new Error('Expert edit dry-run must protect highlights.');
}
if (!workflow.dryRun.parameterDiffPaths.includes('/parameters/shadows')) {
  throw new Error('Expert edit dry-run must lift shadows.');
}

const [dryRunAudit, applyAudit] = workflowBridge
  .listAuditEvents()
  .map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (dryRunAudit === undefined || applyAudit === undefined) {
  throw new Error('Expert edit workflow must record dry-run and apply audit events.');
}

const beforeAfter = {
  afterArtifactId: 'artifact_agent_expert_edit_demo_after_virtual_copy_2844',
  afterGraphRevision: workflow.apply.appliedGraphRevision,
  afterPreviewDataUrl: svgDataUrl('After virtual copy', workflow.apply.appliedGraphRevision, '#f0c478', '#475a5f'),
  beforeArtifactId: 'artifact_agent_expert_edit_demo_before_raw_2844',
  beforeGraphRevision: workflow.dryRun.sourceGraphRevision,
  beforePreviewDataUrl: svgDataUrl('Before RAW', workflow.dryRun.sourceGraphRevision, '#c49b63', '#2f3d45'),
  exportArtifactId: 'artifact_agent_expert_edit_demo_export_audit_2844',
  noOverwritePolicy: 'never_overwrite_original',
  virtualCopyId: target.virtualCopyId,
} as const;

const reportWithoutEvidence = {
  approval: {
    acceptedDryRunCommandId: dryRunCommand.commandId,
    approvalClass: applyCommand.approval.approvalClass,
    approvalId: 'approval_agent_expert_edit_demo_2844',
    state: applyCommand.approval.state,
  },
  apply: {
    changedNodeIds: workflow.apply.changedNodeIds,
    commandId: workflow.apply.commandId,
    commandType: workflow.apply.commandType,
    contentHash: hashJson(applyCommand),
    dryRun: false,
    graphRevision: workflow.apply.appliedGraphRevision,
    mutates: workflow.apply.mutates,
    status: applyAudit.status,
    toolName: workflow.apply.toolName,
    undoRevision: workflow.apply.undoRevision,
  },
  audit: {
    eventCount: workflow.audit.eventCount + 1,
    rejectedApplyBeforeDryRun: rejectedAudit.status === 'rejected',
    timeline: [rejectedAudit, dryRunAudit, applyAudit].map((event) => ({
      dryRun: event.dryRun,
      eventId: event.eventId,
      mutates: event.mutates,
      status: event.status,
    })),
  },
  beforeAfter,
  dryRun: {
    commandId: workflow.dryRun.commandId,
    commandType: workflow.dryRun.commandType,
    contentHash: hashJson(dryRunCommand),
    dryRun: true,
    graphRevision: workflow.dryRun.predictedGraphRevision,
    mutates: workflow.dryRun.mutates,
    parameterDiffPaths: workflow.dryRun.parameterDiffPaths,
    previewArtifactId: 'artifact_agent_expert_edit_demo_preview_dry_run_2844',
    status: dryRunAudit.status,
    toolName: workflow.dryRun.toolName,
  },
  inspect: {
    imagePath: target.imagePath,
    projectTool: 'rawengine.local.toolRegistry.query',
    rawFamily: 'nikon_nef_private_style_fixture',
    toolCount: registry.tools.length,
    virtualCopyId: target.virtualCopyId,
  },
  issue: 2983,
  limits: [
    'Runs deterministic in-process local app-server bridge tools; it does not call a paid model provider.',
    'Shows before/after demo preview artifacts and graph revisions; it does not decode RAW pixels in this PR.',
    'Applies only to the virtual-copy edit graph and preserves the original RAW no-overwrite policy.',
  ],
  plan: {
    assistantPlan,
    deterministicProvider: true,
    userPrompt,
  },
  proofStatus: 'runtime_apply_demo',
  runtimeWorkflow: {
    api: 'runAgentColorEditWorkflowV1',
    applyAuditEventId: workflow.audit.applyEventId,
    dryRunAuditEventId: workflow.audit.dryRunEventId,
  },
  refs: ['#2983'],
  validationMode: 'agent_expert_edit_demo_workflow',
} satisfies Omit<z.input<typeof agentExpertEditDemoWorkflowSchema>, 'evidence'>;

const reportHash = hashJson(reportWithoutEvidence);
const report = agentExpertEditDemoWorkflowSchema.parse({
  ...reportWithoutEvidence,
  evidence: {
    htmlPath: HTML_PATH,
    reportHash,
    reportPath: REPORT_PATH,
  },
});
const html = await prettier.format(renderHtml(report), {
  ...(await prettier.resolveConfig(HTML_PATH)),
  parser: 'html',
});

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(HTML_PATH, html);
} else {
  const expected = agentExpertEditDemoWorkflowSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:agent-expert-edit-demo-workflow:update.`);
  }
  const expectedHtml = await readFile(HTML_PATH, 'utf8');
  if (expectedHtml !== html) {
    throw new Error(`${HTML_PATH} is stale; run bun run check:agent-expert-edit-demo-workflow:update.`);
  }
}

console.log('agent expert edit demo workflow ok (inspect/plan/dry-run/apply/audit)');

function parseSingleAuditEvent(
  events: unknown[],
  message: string,
): z.infer<typeof rawEngineLocalAppServerAuditEventV1Schema> {
  if (events.length !== 1) throw new Error(message);
  const event = events[0];
  if (event === undefined) throw new Error(message);
  return rawEngineLocalAppServerAuditEventV1Schema.parse(event);
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function svgDataUrl(label: string, revision: string, warm: string, cool: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="426" viewBox="0 0 640 426"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${cool}"/><stop offset="0.55" stop-color="#6e786d"/><stop offset="1" stop-color="${warm}"/></linearGradient></defs><rect width="640" height="426" fill="url(#g)"/><rect x="32" y="32" width="576" height="362" rx="14" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/><text x="48" y="74" fill="white" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700">${escapeHtml(label)}</text><text x="48" y="360" fill="white" font-family="Menlo, monospace" font-size="16">${escapeHtml(revision)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function renderHtml(report: z.infer<typeof agentExpertEditDemoWorkflowSchema>): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>RawEngine Agent Expert Edit Demo</title>
  <style>
    body { margin: 0; background: #111316; color: #f3f4f1; font-family: Inter, system-ui, sans-serif; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .muted { color: #aab2bd; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
    .card { border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(255,255,255,.04); padding: 16px; }
    img { width: 100%; border-radius: 6px; border: 1px solid rgba(255,255,255,.12); display: block; }
    code { color: #d6e4ff; }
    ol { display: grid; gap: 8px; padding-left: 22px; }
    li { padding: 8px 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; background: rgba(255,255,255,.035); }
  </style>
</head>
<body>
  <main>
    <h1>RawEngine Agent Expert Edit Demo</h1>
    <p class="muted">${escapeHtml(report.plan.userPrompt)}</p>
    <section class="grid">
      <div class="card">
        <h2>Before</h2>
        <img alt="Before RAW demo preview" src="${report.beforeAfter.beforePreviewDataUrl}" />
        <p><code>${escapeHtml(report.beforeAfter.beforeArtifactId)}</code></p>
      </div>
      <div class="card">
        <h2>After</h2>
        <img alt="After virtual copy demo preview" src="${report.beforeAfter.afterPreviewDataUrl}" />
        <p><code>${escapeHtml(report.beforeAfter.afterArtifactId)}</code></p>
      </div>
    </section>
    <section class="card">
      <h2>Workflow</h2>
      <ol>
        <li>Inspect: ${escapeHtml(report.inspect.projectTool)} over ${report.inspect.toolCount} tools.</li>
        <li>Plan: deterministic provider prepared expert tone edit.</li>
        <li>Dry-run: ${escapeHtml(report.dryRun.toolName)} -> ${escapeHtml(report.dryRun.graphRevision)}.</li>
        <li>Approval: ${escapeHtml(report.approval.approvalClass)} ${escapeHtml(report.approval.state)}.</li>
        <li>Apply: ${escapeHtml(report.apply.toolName)} -> ${escapeHtml(report.apply.graphRevision)}.</li>
        <li>Audit: ${report.audit.eventCount} events, rejected apply-before-dry-run preserved.</li>
      </ol>
    </section>
    <p class="muted">No overwrite policy: ${escapeHtml(report.beforeAfter.noOverwritePolicy)}. Proof hash: ${escapeHtml(report.evidence.reportHash)}.</p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
