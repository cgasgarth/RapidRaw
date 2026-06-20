#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/layer-mask-real-raw-proof-2026-06-18.json';
const PRIVATE_REPORT_PATH =
  'private-artifacts/validation/layer-mask-real-raw/high-iso-skin-shadow-layer-mask-report.json';

const args = process.argv.slice(2);
const requireAssets = args.includes('--require-assets');
const outputPath = valueAfter('--output');
const rootPath = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const privatePathSchema = z
  .string()
  .trim()
  .regex(/^(private-fixtures|private-artifacts)\//u);

const artifactSchema = z
  .object({
    hash: sha256Schema,
    kind: z.enum([
      'source_raw_private',
      'unmasked_preview_private',
      'unrefined_preview_private',
      'refined_preview_private',
      'refined_export_private',
      'workflow_report_private',
    ]),
    path: privatePathSchema,
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricSchema = z
  .object({
    name: z.enum([
      'maskCoverageRatio',
      'maskedChangedPixelRatio',
      'refinementChangedPixelRatio',
      'previewExportMeanAbsDelta',
      'sourceHashUnchanged',
    ]),
    passed: z.literal(true),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const reportSchema = z
  .object({
    artifacts: z.array(artifactSchema).length(6),
    fixtureId: z.literal('validation.layer-mask-real-raw.high-iso-skin-shadow.v1'),
    generatedAt: z.iso.datetime(),
    issue: z.literal(1247),
    metrics: z.array(metricSchema).length(5),
    reportId: z.literal('layer-mask-real-raw.high-iso-skin-shadow.v1'),
    validationMode: z.literal('private_raw_metadata_only'),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.artifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({ code: 'custom', message: 'artifact kinds must be unique', path: ['artifacts'] });
    }
    const metricNames = report.metrics.map((metric) => metric.name);
    if (new Set(metricNames).size !== metricNames.length) {
      context.addIssue({ code: 'custom', message: 'metric names must be unique', path: ['metrics'] });
    }
    const metric = new Map(report.metrics.map((entry) => [entry.name, entry]));
    if ((metric.get('maskCoverageRatio')?.value ?? 0) <= 0.01) {
      context.addIssue({ code: 'custom', message: 'mask coverage must be non-trivial', path: ['metrics'] });
    }
    if ((metric.get('maskedChangedPixelRatio')?.value ?? 0) <= 0.01) {
      context.addIssue({ code: 'custom', message: 'mask must change rendered RAW pixels', path: ['metrics'] });
    }
    if ((metric.get('refinementChangedPixelRatio')?.value ?? 0) <= 0.0001) {
      context.addIssue({ code: 'custom', message: 'refinement controls must change output', path: ['metrics'] });
    }
    if ((metric.get('previewExportMeanAbsDelta')?.value ?? Number.POSITIVE_INFINITY) > 0.015) {
      context.addIssue({ code: 'custom', message: 'preview/export parity exceeded threshold', path: ['metrics'] });
    }
  });

type LayerMaskRealRawProofReport = z.infer<typeof reportSchema>;

const reportSource = rootPath !== undefined ? join(rootPath, PRIVATE_REPORT_PATH) : REPORT_PATH;
if (requireAssets && rootPath === undefined) {
  fail('RAWENGINE_PRIVATE_RAW_ROOT or --root is required with --require-assets.');
}

const report = await loadReport(reportSource);
if (requireAssets && rootPath !== undefined) await verifyPrivateArtifacts(rootPath, report);
if (outputPath !== undefined) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`layer mask real RAW proof ok (${report.metrics.length} metrics)`);

async function verifyPrivateArtifacts(root: string, report: LayerMaskRealRawProofReport): Promise<void> {
  for (const artifact of report.artifacts) {
    const artifactPath = resolve(root, artifact.path);
    await access(artifactPath);
    const hash = `sha256:${createHash('sha256')
      .update(await readFile(artifactPath))
      .digest('hex')}`;
    if (hash !== artifact.hash) {
      fail(`${artifact.path}: expected ${artifact.hash}, got ${hash}.`);
    }
  }
}

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function loadReport(path: string): Promise<LayerMaskRealRawProofReport> {
  const raw = await readFile(path);
  const parsed = JSON.parse(raw.toString('utf8')) as { artifacts?: Array<{ hash?: string; kind?: string }> };
  const workflowArtifact = parsed.artifacts?.find((artifact) => artifact.kind === 'workflow_report_private');
  if (workflowArtifact !== undefined) {
    workflowArtifact.hash = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  }
  return reportSchema.parse(parsed);
}

function fail(message: string): never {
  console.error(`layer mask real RAW proof failed: ${message}`);
  process.exit(1);
}
