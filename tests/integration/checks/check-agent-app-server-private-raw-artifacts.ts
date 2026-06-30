#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const AGENT_REPORT_PATH = 'docs/validation/proofs/agent/agent-app-server-raw-edit-proof-2026-06-20.json';
const RAW_WORKFLOW_REPORT_PATH =
  'private-artifacts/validation/open-edit-export/high-iso-skin-shadow-v1-workflow-report.json';
const REPORT_PATH = 'docs/validation/proofs/agent/agent-app-server-private-raw-artifacts-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const agentReportSchema = z
  .object({
    apply: z
      .object({
        approvalState: z.literal('approved'),
        commandId: z.string().trim().min(1),
        mutates: z.literal(true),
        status: z.literal('completed'),
        toolName: z.literal('tonecolor.apply_command'),
      })
      .passthrough(),
    dryRun: z
      .object({
        approvalState: z.literal('not_required'),
        commandId: z.string().trim().min(1),
        mutates: z.literal(false),
        status: z.literal('completed'),
        toolName: z.literal('tonecolor.dry_run_command'),
      })
      .passthrough(),
    issue: z.literal(2315),
    proofHashes: z
      .object({
        applyCommand: hashSchema,
        dryRunCommand: hashSchema,
      })
      .passthrough(),
    proofStatus: z.literal('runtime_apply_partial'),
    rawTarget: z
      .object({
        imagePath: z.string().trim().min(1),
        noOverwritePolicy: z.literal('never_overwrite_original'),
        virtualCopyId: z.string().trim().min(1),
      })
      .passthrough(),
    validationMode: z.literal('agent_chat_raw_app_server_bridge_apply_proof'),
  })
  .passthrough();

const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'sidecar_after_private',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricSchema = z
  .object({
    name: z.enum([
      'changedPixelRatio',
      'previewExportMeanAbsDelta',
      'sidecarReloadRevisionMatch',
      'sourceHashUnchanged',
    ]),
    passed: z.literal(true),
    value: z.number(),
  })
  .passthrough();

const rawWorkflowReportSchema = z
  .object({
    artifacts: z.array(artifactSchema).length(5),
    fixtureId: z.literal('validation.raw-open-edit-export.high-iso-skin-shadow.v1'),
    metrics: z.array(metricSchema).length(4),
    sourceRaw: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
  })
  .passthrough();

const proofReportSchema = z
  .object({
    agentBridge: z
      .object({
        applyCommandId: z.string().trim().min(1),
        applyTool: z.literal('tonecolor.apply_command'),
        dryRunCommandId: z.string().trim().min(1),
        dryRunTool: z.literal('tonecolor.dry_run_command'),
        reportHash: hashSchema,
        reportPath: z.literal(AGENT_REPORT_PATH),
      })
      .strict(),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2315),
    limits: z.array(z.string().trim().min(1)).min(3),
    privateRawRuntime: z
      .object({
        artifacts: z.array(artifactSchema).length(5),
        changedPixelRatio: z.number().gt(0),
        fixtureId: z.literal('validation.raw-open-edit-export.high-iso-skin-shadow.v1'),
        previewExportMeanAbsDelta: z.number().min(0).max(0.015),
        sourceHashUnchanged: z.literal(1),
        sourceRawHash: hashSchema,
        workflowReportPath: z.literal(RAW_WORKFLOW_REPORT_PATH),
      })
      .strict(),
    proofStatus: z.literal('partial_agent_apply_plus_private_raw_artifacts'),
    schemaVersion: z.literal(1),
    validationMode: z.literal('agent_app_server_bridge_plus_private_raw_artifact_proof'),
  })
  .strict();

const failures: string[] = [];
if ((UPDATE_REPORT || requireAssets) && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required for --update or --require-assets.');
}

const agentReportText = await readFile(AGENT_REPORT_PATH, 'utf8');
const agentReport = agentReportSchema.parse(JSON.parse(agentReportText));

let proofReport: z.infer<typeof proofReportSchema>;
if (UPDATE_REPORT) {
  const rawWorkflowReport = await readRawWorkflowReport();
  const metrics = metricMap(rawWorkflowReport.metrics);
  proofReport = proofReportSchema.parse({
    agentBridge: {
      applyCommandId: agentReport.apply.commandId,
      applyTool: agentReport.apply.toolName,
      dryRunCommandId: agentReport.dryRun.commandId,
      dryRunTool: agentReport.dryRun.toolName,
      reportHash: hashBuffer(Buffer.from(agentReportText)),
      reportPath: AGENT_REPORT_PATH,
    },
    generatedAt: new Date().toISOString(),
    issue: 2315,
    limits: [
      'Runs the RawEngine local app-server bridge in-process, not the official Codex app-server sidecar.',
      'Verifies private RAW before/after/export artifacts from the RAW runtime proof, but does not prove the chat agent launched the desktop app.',
      'Links agent apply intent to a representative RAW artifact lane; full #2315 still needs one unified app-server plus app run.',
    ],
    privateRawRuntime: {
      artifacts: rawWorkflowReport.artifacts,
      changedPixelRatio: metrics.changedPixelRatio,
      fixtureId: rawWorkflowReport.fixtureId,
      previewExportMeanAbsDelta: metrics.previewExportMeanAbsDelta,
      sourceHashUnchanged: metrics.sourceHashUnchanged,
      sourceRawHash: rawWorkflowReport.sourceRaw.hash,
      workflowReportPath: RAW_WORKFLOW_REPORT_PATH,
    },
    proofStatus: 'partial_agent_apply_plus_private_raw_artifacts',
    schemaVersion: 1,
    validationMode: 'agent_app_server_bridge_plus_private_raw_artifact_proof',
  });
  await writeFile(REPORT_PATH, `${JSON.stringify(proofReport, null, 2)}\n`);
} else {
  proofReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets && privateRoot !== undefined) {
  const rawWorkflowReport = await readRawWorkflowReport();
  if (rawWorkflowReport.fixtureId !== proofReport.privateRawRuntime.fixtureId) {
    failures.push('RAW workflow fixture ID must match committed proof report.');
  }
  for (const artifact of proofReport.privateRawRuntime.artifacts) {
    const artifactPath = resolve(privateRoot, artifact.path);
    try {
      await access(artifactPath);
    } catch {
      failures.push(`${artifact.kind}: missing artifact ${artifact.path}`);
      continue;
    }
    const actualHash = hashBuffer(await readFile(artifactPath));
    if (actualHash !== artifact.hash) {
      failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
    }
  }
}

if (failures.length > 0) {
  console.error('agent app-server private RAW artifact proof failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `agent app-server private RAW artifact proof ok (${requireAssets ? 'assets verified' : 'schema verified'})`,
);

async function readRawWorkflowReport(): Promise<z.infer<typeof rawWorkflowReportSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return rawWorkflowReportSchema.parse(
    JSON.parse(await readFile(resolve(privateRoot, RAW_WORKFLOW_REPORT_PATH), 'utf8')),
  );
}

function metricMap(metrics: ReadonlyArray<z.infer<typeof metricSchema>>) {
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  return {
    changedPixelRatio: requiredMetric(byName, 'changedPixelRatio'),
    previewExportMeanAbsDelta: requiredMetric(byName, 'previewExportMeanAbsDelta'),
    sourceHashUnchanged: requiredMetric(byName, 'sourceHashUnchanged'),
  };
}

function requiredMetric(metrics: ReadonlyMap<string, number>, name: string): number {
  const value = metrics.get(name);
  if (value === undefined) throw new Error(`missing workflow metric ${name}`);
  return value;
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
