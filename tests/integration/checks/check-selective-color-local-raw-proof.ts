#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/selective-color-local-raw-proof-2026-06-20.json';
const WORKFLOW_REPORT_PATH =
  'private-artifacts/validation/selective-color/selective-color-orange-v1-workflow-report.json';
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const workflowArtifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'sidecar_after_private',
      'workflow_report_private',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const workflowMetricSchema = z
  .object({
    name: z.enum([
      'changedPixelRatio',
      'previewExportMeanAbsDelta',
      'sidecarReloadRevisionMatch',
      'sourceHashUnchanged',
    ]),
    passed: z.boolean(),
    source: z.literal('private_raw_report'),
    threshold: z.number(),
    value: z.number(),
  })
  .strict();

const workflowReportSchema = z
  .object({
    artifacts: z.array(workflowArtifactSchema).length(5),
    editCommandId: z.literal('command.raw-open-edit-export.selective-color-orange.v1'),
    editGraphRevision: z.literal('graph-rev.raw-open-edit-export.selective-color-orange.v1'),
    fixtureId: z.literal('validation.raw-open-edit-export.selective-color-orange.v1'),
    metrics: z.array(workflowMetricSchema).length(4),
    previewAfter: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
    previewBefore: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
    reportId: z.literal('raw-open-edit-export-run.selective-color-orange.v1'),
    sidecarAfter: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
    sourceRaw: z.object({ hash: hashSchema, path: z.string(), publicRepoAllowed: z.literal(false) }).strict(),
  })
  .passthrough();

const summaryReportSchema = z
  .object({
    doesNotProve: z
      .array(
        z.enum([
          'capture_one_class_color_quality',
          'full_macos_app_manual_session',
          'gpu_cpu_parity',
          'icc_colorimetric_accuracy',
          'public_raw_fixture',
        ]),
      )
      .min(5),
    fixtureId: z.literal('validation.raw-open-edit-export.selective-color-orange.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2476),
    localRawRuntime: z
      .object({
        command: z.literal(
          'RAWENGINE_RUN_PRIVATE_RAW_SELECTIVE_COLOR_PROOF=1 RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --features required-ci,validation-harness,tauri-test raw_open_edit_export_proof::tests::private_runtime_smoke_generates_selective_color_report_when_enabled -- --nocapture',
        ),
        editCommandId: z.literal('command.raw-open-edit-export.selective-color-orange.v1'),
        metrics: z
          .object({
            changedPixelRatio: z.number().gt(0),
            previewExportMeanAbsDelta: z.number().min(0).max(0.015),
            sidecarReloadRevisionMatch: z.literal(1),
            sourceHashUnchanged: z.literal(1),
          })
          .strict(),
        status: z.literal('passed'),
        workflowReportPath: z.literal(WORKFLOW_REPORT_PATH),
      })
      .strict(),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        fixtureStatus: z.literal('private_cc_raw_not_committed'),
        localPath: z.literal('private-fixtures/detail/high-iso-skin-shadow-v1.arw'),
        sha256: hashSchema,
      })
      .strict(),
    validationMode: z.literal('private_raw_selective_color_preview_export_sidecar_proof'),
    workflowArtifacts: z.array(workflowArtifactSchema).length(6),
  })
  .strict();

const failures: string[] = [];

if ((UPDATE_REPORT || requireAssets) && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required for --update or --require-assets.');
}

let summary: z.infer<typeof summaryReportSchema>;
if (UPDATE_REPORT) {
  const workflowReport = await readWorkflowReport();
  summary = summaryReportSchema.parse({
    doesNotProve: [
      'capture_one_class_color_quality',
      'full_macos_app_manual_session',
      'gpu_cpu_parity',
      'icc_colorimetric_accuracy',
      'public_raw_fixture',
    ],
    fixtureId: workflowReport.fixtureId,
    generatedAt: new Date().toISOString(),
    issue: 2476,
    localRawRuntime: {
      command:
        'RAWENGINE_RUN_PRIVATE_RAW_SELECTIVE_COLOR_PROOF=1 RAWENGINE_PRIVATE_RAW_ROOT=/tmp/rawengine-private-root cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --features required-ci,validation-harness,tauri-test raw_open_edit_export_proof::tests::private_runtime_smoke_generates_selective_color_report_when_enabled -- --nocapture',
      editCommandId: workflowReport.editCommandId,
      metrics: metricMap(workflowReport.metrics),
      status: 'passed',
      workflowReportPath: WORKFLOW_REPORT_PATH,
    },
    schemaVersion: 1,
    sourceRaw: {
      fixtureStatus: 'private_cc_raw_not_committed',
      localPath: 'private-fixtures/detail/high-iso-skin-shadow-v1.arw',
      sha256: workflowReport.sourceRaw.hash,
    },
    validationMode: 'private_raw_selective_color_preview_export_sidecar_proof',
    workflowArtifacts: [...workflowReport.artifacts, await workflowReportArtifact()],
  });
  await writeFile(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
} else {
  summary = summaryReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets && privateRoot !== undefined) {
  const workflowReport = await readWorkflowReport();
  if (workflowReport.fixtureId !== summary.fixtureId) {
    failures.push('workflow report fixture ID must match committed summary.');
  }
  for (const artifact of summary.workflowArtifacts) {
    const absolutePath = resolve(privateRoot, artifact.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${artifact.kind}: missing artifact ${artifact.path}`);
      continue;
    }
    const actualHash = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex');
    if (`sha256:${actualHash}` !== artifact.hash) {
      failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
    }
  }
}

if (failures.length > 0) {
  console.error('selective color local RAW proof failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`selective color local RAW proof ok (${requireAssets ? 'assets verified' : 'schema verified'})`);

async function readWorkflowReport(): Promise<z.infer<typeof workflowReportSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return workflowReportSchema.parse(JSON.parse(await readFile(resolve(privateRoot, WORKFLOW_REPORT_PATH), 'utf8')));
}

async function workflowReportArtifact(): Promise<z.infer<typeof workflowArtifactSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return workflowArtifactSchema.parse({
    hash: hashBuffer(await readFile(resolve(privateRoot, WORKFLOW_REPORT_PATH))),
    kind: 'workflow_report_private',
    path: WORKFLOW_REPORT_PATH,
    publicRepoAllowed: false,
  });
}

function metricMap(metrics: ReadonlyArray<z.infer<typeof workflowMetricSchema>>) {
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  return {
    changedPixelRatio: requiredMetric(byName, 'changedPixelRatio'),
    previewExportMeanAbsDelta: requiredMetric(byName, 'previewExportMeanAbsDelta'),
    sidecarReloadRevisionMatch: requiredMetric(byName, 'sidecarReloadRevisionMatch'),
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
