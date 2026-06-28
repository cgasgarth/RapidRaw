#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REPORT_PATH = 'docs/validation/gamut-mapping-real-raw-private-proof-2026-06-26.json';
const PRIVATE_ROOT = '/tmp/rawengine-gamut-mapping-v4-real-raw-proof';
const PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const RUN_REPORTS_RELATIVE_PATH = 'raw-open-edit-export-run-reports.json';
const SOURCE_COMMAND = `RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun run check:raw-color-management-srgb-perceptual-private-proof --root ${PRIVATE_ROOT} --output ${PRIVATE_ROOT}/${RUN_REPORTS_RELATIVE_PATH} --require-assets`;
const ASSET_COMMAND = `bun run check:raw-color-management-srgb-perceptual-private-proof --root ${PRIVATE_ROOT} --output ${PRIVATE_ROOT}/${RUN_REPORTS_RELATIVE_PATH} --require-assets`;
const RUN_REPORTS_PATH = valueAfter('--run-reports');
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const allowFreshHashes = process.argv.includes('--allow-fresh-hashes');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT ?? PRIVATE_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactKindSchema = z.enum([
  'export_after_private',
  'preview_after_private',
  'preview_before_private',
  'sidecar_after_private',
  'soft_proof_after_private',
  'source_raw_private',
  'workflow_report_private',
]);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: artifactKindSchema,
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const metricSchema = z
  .object({
    changedPixelRatio: z.number().positive(),
    finalFileBitDepth: z.literal(16),
    finalFileIccProfileEmbedded: z.literal(1),
    finalFileReopenSucceeded: z.literal(1),
    finalFileSoftProofRgb8MeanAbsDelta: z.number().min(0).max(0.001),
    finalFileTransformApplied: z.literal(1),
    previewExportMeanAbsDelta: z.number().min(0).max(0.015),
    softProofExportRgb8MeanAbsDelta: z.literal(0),
    sourceHashUnchanged: z.literal(1),
  })
  .strict();
type MetricSummary = z.infer<typeof metricSchema>;
type MetricName = keyof MetricSummary;

const committedReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(7),
    fixtureId: z.literal('validation.raw-open-edit-export.professional-color.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(3238),
    localRawRuntime: z
      .object({
        artifactRoot: z.literal('private-artifacts/validation/open-edit-export/srgb-perceptual'),
        command: z.literal(SOURCE_COMMAND),
        gamutMapping: z.literal('rawengine.gamut.srgb-oklab-chroma-reduce.v4'),
        metrics: metricSchema,
        observedExportColorEncoding: z.literal('srgb_rgb16_tiff'),
        observedOutputProfile: z.literal('srgb'),
        privateRunReportsPath: z.literal(`${PRIVATE_ROOT}/${RUN_REPORTS_RELATIVE_PATH}`),
        status: z.literal('passed'),
      })
      .strict(),
    proofBoundary: z.literal('private_raw_runtime_gamut_mapping_not_final_visual_quality'),
    proofStatus: z.literal('private_raw_srgb_perceptual_gamut_mapping_runtime'),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        licenseEvidence: z.literal(
          'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
        ),
        licenseSummary: z.literal('Project-owned local RAW sample for software development validation.'),
        localPath: z.literal('private-fixtures/color/professional-workflow-v1/alaska-dsc7853.arw'),
        sha256: hashSchema,
        sourceFolder: z.literal(PRIVATE_SOURCE),
      })
      .strict(),
    validationCommands: z.array(z.enum([SOURCE_COMMAND, ASSET_COMMAND])).length(2),
    validationMode: z.literal('local_alaska_raw_srgb_perceptual_gamut_mapping_runtime'),
    workflowArtifacts: z.array(artifactSchema).min(7),
  })
  .strict();

const failures: Array<string> = [];
let report: z.infer<typeof committedReportSchema>;

if (UPDATE_REPORT) {
  if (RUN_REPORTS_PATH === undefined) {
    failures.push('--run-reports is required with --update.');
  }
  const proof = RUN_REPORTS_PATH === undefined ? undefined : await loadProof(RUN_REPORTS_PATH);
  if (proof !== undefined) {
    report = committedReportSchema.parse({
      doesNotProve: proof.doesNotProve,
      fixtureId: proof.fixtureId,
      generatedAt: new Date().toISOString(),
      issue: 3238,
      localRawRuntime: {
        artifactRoot: 'private-artifacts/validation/open-edit-export/srgb-perceptual',
        command: SOURCE_COMMAND,
        gamutMapping: proof.gamutMapping,
        metrics: proof.metrics,
        observedExportColorEncoding: proof.observedExportColorEncoding,
        observedOutputProfile: proof.observedOutputProfile,
        privateRunReportsPath: `${PRIVATE_ROOT}/${RUN_REPORTS_RELATIVE_PATH}`,
        status: 'passed',
      },
      proofBoundary: 'private_raw_runtime_gamut_mapping_not_final_visual_quality',
      proofStatus: 'private_raw_srgb_perceptual_gamut_mapping_runtime',
      schemaVersion: 1,
      sourceRaw: {
        licenseEvidence:
          'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
        licenseSummary: 'Project-owned local RAW sample for software development validation.',
        localPath: proof.sourceRawPath,
        sha256: proof.sourceRawHash,
        sourceFolder: PRIVATE_SOURCE,
      },
      validationCommands: [SOURCE_COMMAND, ASSET_COMMAND],
      validationMode: 'local_alaska_raw_srgb_perceptual_gamut_mapping_runtime',
      workflowArtifacts: proof.artifacts,
    });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
} else {
  report = committedReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
}

if (requireAssets) {
  if (RUN_REPORTS_PATH === undefined) failures.push('--run-reports is required with --require-assets.');
  if (RUN_REPORTS_PATH !== undefined) {
    const proof = await loadProof(RUN_REPORTS_PATH);
    if (proof.gamutMapping !== report.localRawRuntime.gamutMapping) failures.push('gamut mapper mismatch.');
    if (proof.sourceRawHash !== report.sourceRaw.sha256) failures.push('source RAW hash mismatch.');
  }

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
    if (!allowFreshHashes && actualHash !== artifact.hash) {
      failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
    }
  }
}

if (failures.length > 0) {
  console.error('gamut mapping real RAW private proof summary failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `gamut mapping real RAW private proof summary ok (${requireAssets ? 'assets verified' : 'schema verified'})`,
);

async function loadProof(runReportsPath: string) {
  const collection = parseRawOpenEditExportRunReportCollection(JSON.parse(await readFile(runReportsPath, 'utf8')));
  const runReport = collection.reports.find(
    (candidate) => candidate.fixtureId === 'validation.raw-open-edit-export.professional-color.v1',
  );
  if (runReport === undefined) throw new Error('missing professional color private run report');

  const metricValue = (name: MetricName) => {
    const metric = runReport.metrics.find((candidate) => candidate.name === name);
    if (metric === undefined) throw new Error(`missing metric ${name}`);
    return metric.value;
  };

  return {
    artifacts: runReport.artifacts,
    doesNotProve: runReport.colorManagement.doesNotProve,
    fixtureId: runReport.fixtureId,
    gamutMapping: runReport.colorManagement.observedColorPipeline.gamutMapping,
    metrics: metricSchema.parse({
      changedPixelRatio: metricValue('changedPixelRatio'),
      finalFileBitDepth: metricValue('finalFileBitDepth'),
      finalFileIccProfileEmbedded: metricValue('finalFileIccProfileEmbedded'),
      finalFileReopenSucceeded: metricValue('finalFileReopenSucceeded'),
      finalFileSoftProofRgb8MeanAbsDelta: metricValue('finalFileSoftProofRgb8MeanAbsDelta'),
      finalFileTransformApplied: metricValue('finalFileTransformApplied'),
      previewExportMeanAbsDelta: metricValue('previewExportMeanAbsDelta'),
      softProofExportRgb8MeanAbsDelta: metricValue('softProofExportRgb8MeanAbsDelta'),
      sourceHashUnchanged: metricValue('sourceHashUnchanged'),
    }),
    observedExportColorEncoding: runReport.colorManagement.observedColorPipeline.exportColorEncoding,
    observedOutputProfile: runReport.colorManagement.observedColorPipeline.outputProfile,
    sourceRawHash: runReport.sourceRaw.hash,
    sourceRawPath: runReport.sourceRaw.path,
  };
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
