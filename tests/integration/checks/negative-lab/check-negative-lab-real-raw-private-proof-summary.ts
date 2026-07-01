#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const REPORT_PATH = 'docs/validation/proofs/negative-lab/negative-lab-real-raw-private-proof-2026-06-22.json';
const PRIVATE_REPORT_PATH = 'private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-report.json';
const PRIVATE_ROOT = '/tmp/rawengine-negative-lab-alaska-proof';
const PRIVATE_SOURCE = '/Users/cgas/Pictures/Capture One/Alaska';
const SOURCE_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} RAWENGINE_PRIVATE_RAW_SOURCE="${PRIVATE_SOURCE}" bun scripts/private-raw/proofs/raw-workflow/run-negative-lab-real-raw-private-proof.ts -- --require-assets`;
const ASSET_COMMAND = `RAWENGINE_PRIVATE_RAW_ROOT=${PRIVATE_ROOT} bun scripts/private-raw/proofs/raw-workflow/run-negative-lab-real-raw-private-proof.ts -- --require-assets`;
const UPDATE_REPORT = process.argv.includes('--update');
const requireAssets = process.argv.includes('--require-assets');
const allowFreshHashes = process.argv.includes('--allow-fresh-hashes');
const privateRoot = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: z.enum(['source_raw_private', 'positive_jpeg_private', 'sidecar_private', 'conversion_bundle_private']),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const sampleRectSchema = z
  .object({
    height: z.number().gt(0).lte(1),
    width: z.number().gt(0).lte(1),
    x: z.number().min(0).lt(1),
    y: z.number().min(0).lt(1),
  })
  .strict();

const densityDomainInversionSchema = z
  .object({
    algorithm: z.literal('density_rgb_v1'),
    baseSample: sampleRectSchema
      .extend({
        estimatedBaseDensity: z.array(z.number().positive()).length(3),
        estimatedBaseRgb: z.array(z.number().min(0).max(1)).length(3),
        source: z.literal('manual_real_raw_border_sample'),
      })
      .strict(),
    densityAssumptions: z
      .object({
        baseFogStrength: z.literal(1),
        channelBounds: z
          .object({
            blue: z.object({ max: z.number().gt(0), min: z.number().min(0) }).strict(),
            green: z.object({ max: z.number().gt(0), min: z.number().min(0) }).strict(),
            red: z.object({ max: z.number().gt(0), min: z.number().min(0) }).strict(),
          })
          .strict(),
        densityTransform: z.literal('-log10(clamp(linear_rgb, 1e-6, 1.0))'),
        epsilonPolicy: z.literal('clamp_linear_rgb_min_1e-6'),
        normalization: z.literal('subtract_sampled_base_density_then_divide_by_density_range'),
        printCurve: z.literal('sigmoid_density_curve_gamma_2_2_preview'),
        referenceDownscaleMaxEdge: z.literal(1080),
      })
      .strict(),
    neutralBalance: z
      .object({
        blueWeight: z.number().positive(),
        greenWeight: z.number().positive(),
        redWeight: z.number().positive(),
      })
      .strict(),
    positiveOutput: z
      .object({
        contentHash: hashSchema,
        dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
        format: z.literal('jpeg_proof'),
        path: z.literal('private-artifacts/validation/negative-lab-real-raw/alaska-negative-lab-v1-Positive.jpg'),
      })
      .strict(),
  })
  .strict()
  .superRefine((proof, context) => {
    for (const channel of ['red', 'green', 'blue'] as const) {
      const bounds = proof.densityAssumptions.channelBounds[channel];
      if (bounds.max <= bounds.min) {
        context.addIssue({
          code: 'custom',
          message: `Expected ${channel} density max to exceed min.`,
          path: ['densityAssumptions', 'channelBounds', channel],
        });
      }
    }
  });

const colorManagementSchema = z
  .object({
    acquisitionProfileId: z.literal('camera_raw_linear_v1'),
    channelBasis: z.literal('linear_raw_rgb'),
    decodePath: z.literal('load_base_image_from_bytes'),
    outputIntent: z.literal('jpeg_proof_review'),
    previewOutputTransfer: z.literal('gamma_2_2_display_proof'),
  })
  .strict();

const privateWorkflowReportSchema = z
  .object({
    artifacts: z.array(artifactSchema).length(4),
    doesNotProve: z.array(z.string().min(1)).min(6),
    fixtureId: z.literal('validation.negative-lab-real-raw.alaska.v1'),
    issue: z.literal(4527),
    colorManagement: colorManagementSchema,
    densityDomainInversion: densityDomainInversionSchema,
    localRawRuntime: z
      .object({
        decodePath: z.literal('load_base_image_from_bytes'),
        execution: z.literal('tauri_test_negative_lab_private_raw_export'),
        outputFormat: z.literal('jpeg_proof'),
        proofContext: z
          .object({
            acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
            acceptedDryRunPlanId: z.string().trim().min(1),
            conversionBundleWritten: z.literal(true),
            sidecarWritten: z.literal(true),
          })
          .strict(),
        sourceHashUnchanged: z.literal(true),
        sourceIsRaw: z.literal(true),
      })
      .strict(),
    metrics: z
      .object({
        changedPixelRatio: z.number().gt(0.05),
        inputToOutputMeanAbsDelta: z.number().gt(0.01),
      })
      .strict(),
    proofBoundary: z.literal('private_raw_negative_lab_runtime_not_final_negative_quality'),
    proofStatus: z.literal('private_raw_negative_lab_positive_export_rendered'),
    schemaVersion: z.literal(1),
    validationMode: z.literal('local_alaska_raw_negative_lab_runtime'),
  })
  .strict();

const committedReportSchema = z
  .object({
    doesNotProve: z.array(z.string().min(1)).min(6),
    fixtureId: z.literal('validation.negative-lab-real-raw.alaska.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(4527),
    colorManagement: colorManagementSchema,
    densityDomainInversion: densityDomainInversionSchema,
    localRawRuntime: z
      .object({
        artifactRoot: z.literal('private-artifacts/validation/negative-lab-real-raw'),
        command: z.literal(SOURCE_COMMAND),
        metrics: z
          .object({
            changedPixelRatio: z.number().gt(0.05),
            inputToOutputMeanAbsDelta: z.number().gt(0.01),
            sourceHashUnchanged: z.literal(true),
          })
          .strict(),
        privateWorkflowReportPath: z.literal(PRIVATE_REPORT_PATH),
        proofContext: z
          .object({
            acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
            acceptedDryRunPlanId: z.string().trim().min(1),
            conversionBundleWritten: z.literal(true),
            sidecarWritten: z.literal(true),
          })
          .strict(),
        status: z.literal('passed'),
      })
      .strict(),
    proofBoundary: z.literal('private_raw_negative_lab_runtime_not_final_negative_quality'),
    proofStatus: z.literal('private_raw_negative_lab_positive_export_rendered'),
    schemaVersion: z.literal(1),
    sourceRaw: z
      .object({
        licenseEvidence: z.literal(
          'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
        ),
        licenseSummary: z.literal('Project-owned local RAW sample for software development validation.'),
        localPath: z.literal('private-fixtures/negative-lab/alaska-negative-lab-v1.arw'),
        sha256: hashSchema,
        sourceFolder: z.literal(PRIVATE_SOURCE),
      })
      .strict(),
    validationCommands: z.array(z.enum([SOURCE_COMMAND, ASSET_COMMAND])).length(2),
    validationMode: z.literal('local_alaska_raw_negative_lab_runtime'),
    workflowArtifacts: z.array(artifactSchema).length(4),
  })
  .strict();

const failures: Array<string> = [];

if ((UPDATE_REPORT || requireAssets) && privateRoot === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets or --update.');
}

let report: z.infer<typeof committedReportSchema>;
if (UPDATE_REPORT) {
  const workflowReport = await readPrivateWorkflowReport();
  report = committedReportSchema.parse({
    doesNotProve: workflowReport.doesNotProve,
    fixtureId: workflowReport.fixtureId,
    generatedAt: new Date().toISOString(),
    issue: 4527,
    colorManagement: workflowReport.colorManagement,
    densityDomainInversion: workflowReport.densityDomainInversion,
    localRawRuntime: {
      artifactRoot: 'private-artifacts/validation/negative-lab-real-raw',
      command: SOURCE_COMMAND,
      metrics: {
        changedPixelRatio: workflowReport.metrics.changedPixelRatio,
        inputToOutputMeanAbsDelta: workflowReport.metrics.inputToOutputMeanAbsDelta,
        sourceHashUnchanged: workflowReport.localRawRuntime.sourceHashUnchanged,
      },
      privateWorkflowReportPath: PRIVATE_REPORT_PATH,
      proofContext: workflowReport.localRawRuntime.proofContext,
      status: 'passed',
    },
    proofBoundary: workflowReport.proofBoundary,
    proofStatus: workflowReport.proofStatus,
    schemaVersion: 1,
    sourceRaw: {
      licenseEvidence:
        'User explicitly provided /Users/cgas/Pictures/Capture One/Alaska as project-owned RAW validation input for this repo.',
      licenseSummary: 'Project-owned local RAW sample for software development validation.',
      localPath: 'private-fixtures/negative-lab/alaska-negative-lab-v1.arw',
      sha256: workflowReport.artifacts.find((artifact) => artifact.kind === 'source_raw_private')?.hash,
      sourceFolder: PRIVATE_SOURCE,
    },
    validationCommands: [SOURCE_COMMAND, ASSET_COMMAND],
    validationMode: workflowReport.validationMode,
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
    if (artifact.kind === 'conversion_bundle_private' || artifact.kind === 'sidecar_private') continue;
    const actualHash = hashBuffer(await readFile(absolutePath));
    if (!allowFreshHashes && actualHash !== artifact.hash) {
      failures.push(`${artifact.kind}: hash mismatch for ${artifact.path}`);
    }
  }
}

if (failures.length > 0) {
  console.error('negative lab real RAW private proof summary failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `negative lab real RAW private proof summary ok (${requireAssets ? 'assets verified' : 'schema verified'})`,
);

async function readPrivateWorkflowReport(): Promise<z.infer<typeof privateWorkflowReportSchema>> {
  if (privateRoot === undefined) throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required.');
  return privateWorkflowReportSchema.parse(
    JSON.parse(await readFile(resolve(privateRoot, PRIVATE_REPORT_PATH), 'utf8')),
  );
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
