#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  buildRawEngineLocalAppServerToolRegistryQuery,
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleRawEngineSceneColorPipelineV1,
  sampleToneColorCommandEnvelopeV1,
  sampleToolRegistryV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  rawEngineAgentReplayFixtureV1Schema,
  rawEngineToolRegistryV1Schema,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const REPORT_PATH = 'docs/validation/agent-app-server-raw-edit-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const ISSUE_NUMBER = 2315;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const toolCallSummarySchema = z
  .object({
    approvalState: z.enum(['approved', 'not_required', 'rejected']),
    auditEventId: z.string().trim().min(1),
    commandId: z.string().trim().min(1),
    dryRun: z.boolean(),
    mutates: z.boolean(),
    status: z.enum(['completed', 'rejected']),
    toolName: z.string().trim().min(1),
  })
  .strict();

const proofReportSchema = z
  .object({
    apply: toolCallSummarySchema.extend({
      appliedGraphRevision: z.string().trim().min(1),
      changedNodeIds: z.array(z.string().trim().min(1)).min(1),
      undoRevision: z.string().trim().min(1),
    }),
    chat: z
      .object({
        assistantPlan: z.string().trim().min(1),
        userPrompt: z.string().trim().min(1),
      })
      .strict(),
    dryRun: toolCallSummarySchema.extend({
      parameterDiffPaths: z.array(z.string().trim().min(1)).min(1),
      predictedGraphRevision: z.string().trim().min(1),
    }),
    issue: z.literal(ISSUE_NUMBER),
    limits: z.array(z.string().trim().min(1)).min(1),
    proofHashes: z
      .object({
        applyCommand: hashSchema,
        dryRunCommand: hashSchema,
        replayFixture: hashSchema,
        reportInputs: hashSchema,
      })
      .strict(),
    proofStatus: z.literal('runtime_apply_partial'),
    rawTarget: z
      .object({
        afterArtifactId: z.string().trim().min(1),
        beforeArtifactId: z.string().trim().min(1),
        exportArtifactId: z.string().trim().min(1),
        imagePath: z.string().trim().endsWith('.NEF'),
        noOverwritePolicy: z.literal('never_overwrite_original'),
        virtualCopyId: z.string().trim().min(1),
      })
      .strict(),
    refs: z.array(z.literal('#2315')).length(1),
    rejectedApplyBeforeDryRun: toolCallSummarySchema,
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    toolRegistry: z
      .object({
        applyTool: z.literal('tonecolor.apply_command'),
        dryRunTool: z.literal('tonecolor.dry_run_command'),
        registryHash: hashSchema,
      })
      .strict(),
    validationMode: z.literal('agent_chat_raw_app_server_bridge_apply_proof'),
  })
  .strict();

const userPrompt =
  'Make DSC_2315.NEF a little warmer, lift the shadows, protect highlights, show me the preview, then apply if approved.';
const assistantPlan =
  'Use app-server tool discovery, run a non-mutating basic tone dry-run, require edit-apply approval, then apply the matching command without overwriting the original RAW.';

const target = {
  imagePath: '/photos/agent-proof/DSC_2315.NEF',
  kind: 'image',
  virtualCopyId: 'vc_agent_app_server_raw_edit_2315',
} as const;

const dryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...sampleToneColorCommandEnvelopeV1,
  actor: {
    id: 'codex-app-server',
    kind: 'agent',
    sessionId: 'session_agent_app_server_raw_edit_2315',
  },
  approval: {
    approvalClass: 'preview_only',
    reason: 'Preview the RAW tone edit through the app-server bridge before any graph mutation.',
    state: 'not_required',
  },
  colorPipeline: sampleRawEngineSceneColorPipelineV1,
  commandId: 'command_agent_app_server_raw_edit_dry_run_2315',
  correlationId: 'corr_agent_app_server_raw_edit_2315',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_agent_app_server_raw_edit_initial_2315',
  idempotencyKey: 'idem_agent_app_server_raw_edit_dry_run_2315',
  parameters: {
    blackPoint: -1,
    clarity: 5,
    contrast: 8,
    exposureEv: 0.2,
    highlights: -18,
    saturation: 3,
    shadows: 16,
    whitePoint: 4,
  },
  target,
});

const applyCommand = toneColorCommandEnvelopeV1Schema.parse({
  ...dryRunCommand,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'User accepted the dry-run preview; apply the tone edit to the virtual copy edit graph only.',
    state: 'approved',
  },
  commandId: 'command_agent_app_server_raw_edit_apply_2315',
  dryRun: false,
  idempotencyKey: 'idem_agent_app_server_raw_edit_apply_2315',
});

const context = {
  now: () => new Date('2026-06-20T12:15:00.000Z'),
  requestId: 'request_agent_app_server_raw_edit_2315',
};

const bridge = createRawEngineLocalAppServerBridge();
const rejectedBridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await rejectedBridge.dispatch(applyCommand, context);
if (rejectedApply.ok || rejectedApply.reason !== 'handler_failed') {
  throw new Error('App-server bridge must reject chat apply before the matching RAW dry-run.');
}

const rejectedApplyAudit = parseSingleAuditEvent(
  rejectedBridge.listAuditEvents(),
  'Rejected apply before dry-run must record one audit event.',
);

const registryResult = await bridge.dispatch(buildRawEngineLocalAppServerToolRegistryQuery('agent_raw_edit_registry'));
if (!registryResult.ok) throw new Error(`App-server bridge tool registry query failed: ${registryResult.message}`);
const registry = rawEngineToolRegistryV1Schema.parse(registryResult.result);
const dryRunTool = registry.tools.find((tool) => tool.toolName === 'tonecolor.dry_run_command');
const applyTool = registry.tools.find((tool) => tool.toolName === 'tonecolor.apply_command');

if (dryRunTool?.mutates !== false || dryRunTool.toolKind !== 'dry_run') {
  throw new Error('Tool registry must expose tonecolor.dry_run_command as non-mutating dry-run.');
}
if (applyTool?.mutates !== true || applyTool.toolKind !== 'apply' || applyTool.approvalClass !== 'edit_apply') {
  throw new Error('Tool registry must expose tonecolor.apply_command as approved mutating apply.');
}

const dryRunResult = await bridge.dispatch(dryRunCommand, context);
if (!dryRunResult.ok) throw new Error(`Chat-driven RAW dry-run failed: ${dryRunResult.message}`);
const dryRun = toneColorDryRunResultV1Schema.parse(dryRunResult.result);
if (dryRun.mutates) throw new Error('Dry-run result must not mutate the graph.');
if (dryRun.sourceGraphRevision !== dryRunCommand.expectedGraphRevision) {
  throw new Error('Dry-run result did not preserve the expected source graph revision.');
}
if (!dryRun.parameterDiff.some((diff) => diff.path === '/parameters/highlights')) {
  throw new Error('Dry-run result must show the requested highlight protection diff.');
}
if (!dryRun.parameterDiff.some((diff) => diff.path === '/parameters/shadows')) {
  throw new Error('Dry-run result must show the requested shadow lift diff.');
}

const applyResult = await bridge.dispatch(applyCommand, context);
if (!applyResult.ok) throw new Error(`Approved chat-driven RAW apply failed: ${applyResult.message}`);
const apply = toneColorMutationResultV1Schema.parse(applyResult.result);
if (!apply.mutates) throw new Error('Apply result must mutate the edit graph.');
if (apply.sourceGraphRevision !== applyCommand.expectedGraphRevision) {
  throw new Error('Apply result did not preserve the expected source graph revision.');
}
if (apply.appliedGraphRevision === apply.sourceGraphRevision) {
  throw new Error('Apply result must advance the graph revision.');
}

const [dryRunAudit, applyAudit] = bridge
  .listAuditEvents()
  .map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (dryRunAudit === undefined || applyAudit === undefined) {
  throw new Error('App-server bridge must record dry-run and apply audit events.');
}
if (dryRunAudit.dryRun !== true || dryRunAudit.mutates !== false || dryRunAudit.status !== 'completed') {
  throw new Error('Dry-run audit event must be completed and non-mutating.');
}
if (applyAudit.dryRun !== false || applyAudit.mutates !== true || applyAudit.status !== 'completed') {
  throw new Error('Apply audit event must be completed and mutating.');
}

const rawArtifacts = {
  afterArtifactId: 'artifact_agent_app_server_raw_edit_after_virtual_copy_2315',
  beforeArtifactId: 'artifact_agent_app_server_raw_edit_before_raw_2315',
  exportArtifactId: 'artifact_agent_app_server_raw_edit_export_audit_2315',
};
const replayFixture = rawEngineAgentReplayFixtureV1Schema.parse({
  actor: dryRunCommand.actor,
  deterministicReplayHash: hashJson({
    applyCommand,
    dryRunCommand,
    userPrompt,
  }),
  finalGraphRevision: apply.appliedGraphRevision,
  initialGraphRevision: dryRun.sourceGraphRevision,
  registry: sampleToolRegistryV1,
  replayId: 'replay_agent_app_server_raw_edit_2315',
  replayKind: 'agent_tool_replay',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  steps: [
    {
      auditLog: {
        affectedArtifactIds: [],
        affectedImageIds: [dryRunCommand.target.imagePath],
        noOverwritePolicy: 'never_overwrite_original',
        parameterDiff: dryRun.parameterDiff.map(({ path, previousValue, value }) => ({
          path,
          ...(previousValue === undefined ? {} : { previousValue }),
          ...(value === undefined ? {} : { value }),
        })),
        toolCall: {
          inputSchemaName: 'ToneColorCommandEnvelopeV1',
          toolKind: 'dry_run',
          toolName: 'tonecolor.dry_run_command',
        },
        warnings: dryRun.warnings,
      },
      approval: dryRunCommand.approval,
      deterministic: true,
      dryRun: true,
      input: dryRunCommand,
      inputContentHash: hashJson(dryRunCommand),
      inputSchemaName: 'ToneColorCommandEnvelopeV1',
      mutates: false,
      output: dryRun,
      outputContentHash: hashJson(dryRun),
      outputSchemaName: 'ToneColorDryRunResultV1',
      prerequisiteStepIds: [],
      sourceGraphRevision: dryRun.sourceGraphRevision,
      stepId: 'step_agent_app_server_raw_edit_dry_run',
      toolKind: 'dry_run',
      toolName: 'tonecolor.dry_run_command',
      warnings: dryRun.warnings,
    },
    {
      auditLog: {
        affectedArtifactIds: [
          rawArtifacts.beforeArtifactId,
          rawArtifacts.afterArtifactId,
          rawArtifacts.exportArtifactId,
        ],
        affectedImageIds: [applyCommand.target.imagePath],
        noOverwritePolicy: 'never_overwrite_original',
        parameterDiff: dryRun.parameterDiff.map(({ path, previousValue, value }) => ({
          path,
          ...(previousValue === undefined ? {} : { previousValue }),
          ...(value === undefined ? {} : { value }),
        })),
        rollbackPoint: {
          graphRevision: apply.sourceGraphRevision,
          undoRevision: apply.undoRevision,
        },
        toolCall: {
          inputSchemaName: 'ToneColorCommandEnvelopeV1',
          toolKind: 'apply',
          toolName: 'tonecolor.apply_command',
        },
        warnings: apply.warnings,
      },
      approval: applyCommand.approval,
      deterministic: true,
      dryRun: false,
      input: applyCommand,
      inputContentHash: hashJson(applyCommand),
      inputSchemaName: 'ToneColorCommandEnvelopeV1',
      mutates: true,
      output: apply,
      outputContentHash: hashJson(apply),
      outputSchemaName: 'ToneColorMutationResultV1',
      prerequisiteStepIds: ['step_agent_app_server_raw_edit_dry_run'],
      resultingGraphRevision: apply.appliedGraphRevision,
      sourceGraphRevision: apply.sourceGraphRevision,
      stepId: 'step_agent_app_server_raw_edit_apply',
      toolKind: 'apply',
      toolName: 'tonecolor.apply_command',
      warnings: apply.warnings,
    },
  ],
  target: applyCommand.target,
  validationProfile: 'golden_replay',
  warnings: [
    'Partial runtime proof: local app-server bridge dispatches typed commands in-process; it does not launch the official Codex app-server sidecar.',
    'Partial RAW proof: target and audit artifacts preserve RAW identity; this check does not decode or export real RAW pixels.',
  ],
});

const reportInputs = {
  apply,
  applyAudit,
  assistantPlan,
  dryRun,
  dryRunAudit,
  rejectedApplyAudit,
  target,
  userPrompt,
};
const report = proofReportSchema.parse({
  apply: {
    approvalState: applyCommand.approval.state,
    appliedGraphRevision: apply.appliedGraphRevision,
    auditEventId: applyAudit.eventId,
    changedNodeIds: apply.changedNodeIds,
    commandId: applyCommand.commandId,
    dryRun: false,
    mutates: true,
    status: applyAudit.status,
    toolName: 'tonecolor.apply_command',
    undoRevision: apply.undoRevision,
  },
  chat: {
    assistantPlan,
    userPrompt,
  },
  dryRun: {
    approvalState: dryRunCommand.approval.state,
    auditEventId: dryRunAudit.eventId,
    commandId: dryRunCommand.commandId,
    dryRun: true,
    mutates: false,
    parameterDiffPaths: dryRun.parameterDiff.map((diff) => diff.path),
    predictedGraphRevision: dryRun.predictedGraphRevision,
    status: dryRunAudit.status,
    toolName: 'tonecolor.dry_run_command',
  },
  issue: ISSUE_NUMBER,
  limits: [
    'Runs the RawEngine local app-server bridge in-process; it does not launch the official Codex app-server sidecar or desktop app.',
    'Targets a RAW image path and mutates a typed virtual-copy edit graph; it does not decode RAW pixels.',
    'Before, after, and export entries are deterministic audit artifact handles; this is not a rendered before/after/export image proof.',
  ],
  proofHashes: {
    applyCommand: hashJson(applyCommand),
    dryRunCommand: hashJson(dryRunCommand),
    replayFixture: hashJson(replayFixture),
    reportInputs: hashJson(reportInputs),
  },
  proofStatus: 'runtime_apply_partial',
  rawTarget: {
    ...rawArtifacts,
    imagePath: target.imagePath,
    noOverwritePolicy: 'never_overwrite_original',
    virtualCopyId: target.virtualCopyId,
  },
  refs: ['#2315'],
  rejectedApplyBeforeDryRun: {
    approvalState: applyCommand.approval.state,
    auditEventId: rejectedApplyAudit.eventId,
    commandId: applyCommand.commandId,
    dryRun: false,
    mutates: false,
    status: rejectedApplyAudit.status,
    toolName: 'tonecolor.apply_command',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  toolRegistry: {
    applyTool: 'tonecolor.apply_command',
    dryRunTool: 'tonecolor.dry_run_command',
    registryHash: hashJson(registry),
  },
  validationMode: 'agent_chat_raw_app_server_bridge_apply_proof',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:agent-app-server-raw-edit-proof:update.`);
  }
}

console.log('agent app-server RAW edit proof ok (chat dry-run/apply bridge, partial runtime proof)');

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
