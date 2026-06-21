#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/deblur-real-raw-private-proof-2026-06-21.json';
const PRIVATE_REPORT_PATH = 'private-artifacts/validation/detail-deblur-real-raw/alaska-deblur-v1-report.json';
const PRIVATE_ROOT = '/tmp/rawengine-deblur-alaska-proof';
const PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const SOURCE_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun run check:deblur-real-raw-private-proof -- --require-assets`;
const ASSET_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} bun run check:deblur-real-raw-private-proof -- --require-assets`;
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum([
      'source_raw_private',
      'preview_before_private',
      'preview_after_private',
      'export_after_private',
      'preview_export_diff_private',
      'workflow_report_private',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricNameSchema = z.enum([
  'disabledPreviewMaxDelta',
  'edgeEnergyRatio',
  'inputToPreviewMaxDelta',
  'inputToPreviewMeanAbsDelta',
  'previewExportMaxDelta',
  'previewExportMeanAbsDelta',
  'previewExportP99AbsDelta',
  'sourceHashUnchanged',
]);

const metricSchema = z
  .object({
    name: metricNameSchema,
    passed: z.literal(true),
    threshold: z.number(),
    value: z.number(),
  })
  .strict();

const privateWorkflowReportSchema = z
  .object({
    artifacts: z.array(artifactSchema).length(6),
    fixtureId: z.literal('validation.detail.deblur-real-raw.alaska.v1'),
    issue: z.literal(2891),
    metrics: z.array(metricSchema).length(8),
    proofClaims: z
      .object({
        doesNotProve: z.array(z.string().min(1)).min(4),
        proves: z.array(z.string().min(1)).min(6),
      })
      .strict(),
    reportId: z.literal('detail-deblur-real-raw.alaska.v1'),
    runtimeProof: z
      .object({
        decodePath: z.literal('load_base_image_from_bytes'),
        execution: z.literal('tauri_test_real_raw_deblur_stage'),
        macosAppUiE2e: z.literal(false),
        previewExportParityMetric: z.literal('previewExportMeanAbsDelta'),
        renderStage: z.literal('apply_deblur_stage'),
        sourceIsRaw: z.literal(true),
      })
      .strict(),
    validationMode: z.literal('private_raw_deblur_preview_export_parity'),
  })
  .passthrough();

const committedReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(4),
    fixtureId: z.literal('validation.detail.deblur-real-raw.alaska.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2891),
    localRawRuntime: z
      .object({
        artifactRoot: z.literal('private-artifacts/validation/detail-deblur-real-raw'),
        command: z.literal(SOURCE_COMMAND),
        metrics: z
          .object({
            edgeEnergyRatio: z.number().gte(1),
            inputToPreviewMeanAbsDelta: z.number().gt(0.00005),
            previewExportMeanAbsDelta: z.number().max(0.000001),
            previewExportP99AbsDelta: z.number().max(0.000001),
            sourceHashUnchanged: z.literal(1),
          })
          .strict(),
        privateWorkflowReportPath: z.literal(PRIVATE_REPORT_PATH),
        status: z.literal('passed'),
      })
      .strict(),
    proofBoundary: z.literal('private_raw_runtime_not_final_deblur_quality'),
    proofStatus: z.literal('private_raw_deblur_preview_export_parity'),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        licenseEvidence: z.literal(
          'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
        ),
        licenseSummary: z.literal('Project-owned local RAW sample for software development validation.'),
        localPath: z.literal('private-fixtures/detail/alaska-deblur-v1.arw'),
        sha256: hashSchema,
        sourceFolder: z.literal(PRIVATE_SOURCE),
      })
      .strict(),
    validationCommands: z.array(z.enum([SOURCE_COMMAND, ASSET_COMMAND])).length(2),
    validationMode: z.literal('local_alaska_raw_deblur_runtime'),
    workflowArtifacts: z.array(artifactSchema).length(6),
  })
  .strict();

const failures: Array<string> = [];

if ((UPDATE_REPORT || requireAssets) && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets or --update.');
}

let report: z.infer<typeof committedReportSchema>;
if (UPDATE_REPORT) {
  const workflowReport = await readPrivateWorkflowReport();
  const metrics = metricMap(workflowReport.metrics);
  report = committedReportSchema.parse({
    doesNotProve: workflowReport.proofClaims.doesNotProve,
    fixtureId: workflowReport.fixtureId,
    generatedAt: new Date().toISOString(),
    issue: 2891,
    localRawRuntime: {
      artifactRoot: 'private-artifacts/validation/detail-deblur-real-raw',
      command: SOURCE_COMMAND,
      metrics: {
        edgeEnergyRatio: requiredMetric(metrics, 'edgeEnergyRatio'),
        inputToPreviewMeanAbsDelta: requiredMetric(metrics, 'inputToPreviewMeanAbsDelta'),
        previewExportMeanAbsDelta: requiredMetric(metrics, 'previewExportMeanAbsDelta'),
        previewExportP99AbsDelta: requiredMetric(metrics, 'previewExportP99AbsDelta'),
        sourceHashUnchanged: requiredMetric(metrics, 'sourceHashUnchanged'),
      },
      privateWorkflowReportPath: PRIVATE_REPORT_PATH,
      status: 'passed',
    },
    proofBoundary: 'private_raw_runtime_not_final_deblur_quality',
    proofStatus: 'private_raw_deblur_preview_export_parity',
    schemaVersion: 1,
    sourceRaw: {
      licenseEvidence:
        'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
      licenseSummary: 'Project-owned local RAW sample for software development validation.',
      localPath: 'private-fixtures/detail/alaska-deblur-v1.arw',
      sha256: workflowReport.artifacts.find((artifact) => artifact.kind === 'source_raw_private')?.hash,
      sourceFolder: PRIVATE_SOURCE,
    },
    validationCommands: [SOURCE_COMMAND, ASSET_COMMAND],
    validationMode: 'local_alaska_raw_deblur_runtime',
    workflowArtifacts: workflowReport.artifacts,
  });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
} else {
  report = committedReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets && privateRoot !== undefined) {
  await readPrivateWorkflowReport();
  for (const artifact of report.workflowArtifacts) {
    const absolutePath = resolve(privateRoot, artifact.path);
    try {
      await access(absolutePath);
    } catch {
      failures.push(`${artifact.kind}: missing artifact ${artifact.path}`);
      continue;
    }
    if (artifact.kind === 'workflow_report_private') continue;
    const actualHash = hashBuffer(await readFile(absolutePath));
    if (actualHash !== artifact.hash) failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
  }
}

if (failures.length > 0) {
  console.error('deblur real RAW private proof summary failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`deblur real RAW private proof summary ok (${requireAssets ? 'assets verified' : 'schema verified'})`);

async function readPrivateWorkflowReport(): Promise<z.infer<typeof privateWorkflowReportSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return privateWorkflowReportSchema.parse(
    JSON.parse(await readFile(resolve(privateRoot, PRIVATE_REPORT_PATH), 'utf8')),
  );
}

function metricMap(metrics: ReadonlyArray<z.infer<typeof metricSchema>>): Map<string, number> {
  return new Map(metrics.map((metric) => [metric.name, metric.value]));
}

function requiredMetric(metrics: ReadonlyMap<string, number>, name: string): number {
  const value = metrics.get(name);
  if (value === undefined) throw new Error(`missing metric ${name}`);
  return value;
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
