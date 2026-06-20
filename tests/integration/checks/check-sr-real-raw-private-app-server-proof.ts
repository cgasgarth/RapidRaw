#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/superResolutionAppServerRuntime.ts';
import {
  buildSuperResolutionUiApplyCommandV1,
  buildSuperResolutionUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/superResolutionUiControls.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';
import {
  parseComputationalMergePrivateRunReportCollection,
  type ComputationalMergePrivateRunReportCollection,
} from '../../../src/schemas/computationalMergePrivateRunReportSchemas.ts';
import { privateRawReportMetric } from '../../../scripts/lib/computational-private-report-fixtures.ts';

const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const ARTIFACT_ROOT = 'private-artifacts/validation/computational-merge';
const FIXTURE_ID = 'validation.computational-merge.super-resolution-subpixel.v1';
const SAMPLE_PATH = `${ARTIFACT_ROOT}/sr-subpixel-runtime-sample.json`;
const PROOF_PATH = `${ARTIFACT_ROOT}/sr-subpixel-app-server-runtime-proof.json`;
const REPORT_PATH = `${ARTIFACT_ROOT}/sr-subpixel-private-run-report.json`;
const SCREENSHOT_PATHS = {
  exportReview: `${ARTIFACT_ROOT}/sr-subpixel-export-review.png`,
  modalAfter: `${ARTIFACT_ROOT}/sr-subpixel-modal-after.png`,
  modalBefore: `${ARTIFACT_ROOT}/sr-subpixel-modal-before.png`,
  resultReview: `${ARTIFACT_ROOT}/sr-subpixel-result-review.png`,
};

const runtimeSampleFrameSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    pixels: z.array(z.number().min(0).max(1)).min(1),
    shiftX: z.number().int().nonnegative(),
    shiftY: z.number().int().nonnegative(),
    sourceIndex: z.number().int().nonnegative(),
    sourcePath: z.string().trim().min(1),
  })
  .strict();

const runtimeSampleSchema = z
  .object({
    fixtureId: z.literal(FIXTURE_ID),
    frames: z.array(runtimeSampleFrameSchema).min(2),
    graphRevisionHash: z.string().trim().min(1),
    height: z.number().int().positive(),
    outputScale: z.number().int().min(2).max(4),
    width: z.number().int().positive(),
  })
  .strict()
  .superRefine((sample, context) => {
    const expectedPixelCount = sample.width * sample.height;
    for (const [index, frame] of sample.frames.entries()) {
      if (frame.pixels.length !== expectedPixelCount) {
        context.addIssue({
          code: 'custom',
          message: `Frame ${index} pixel count must equal width * height.`,
          path: ['frames', index, 'pixels'],
        });
      }
    }
  });

type RuntimeSample = z.infer<typeof runtimeSampleSchema>;

const rootValue = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (rootValue === undefined || rootValue.trim().length === 0) {
  await runSelfTest();
  process.exit(0);
}

await runProof(resolve(rootValue));
console.log('SR real RAW private app-server proof ok');

async function runProof(rootPath: string): Promise<void> {
  const sample = runtimeSampleSchema.parse(JSON.parse(await readFile(join(rootPath, SAMPLE_PATH), 'utf8')));
  const bus = new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const controls = buildControls(sample);
  const dryRunCommand = buildSuperResolutionUiDryRunCommandV1(controls, {
    commandId: 'command_sr_private_raw_dry_run_v1',
    correlationId: 'corr_sr_private_raw_dry_run_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    targetId: 'project_sr_private_raw_proof',
  });
  const dryRun = bus.execute({
    request: buildRequest(sample, dryRunCommand),
    toolName: superResolutionRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error('Expected SR private app-server dry-run result.');

  const applyCommand = buildSuperResolutionUiApplyCommandV1(controls, {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    commandId: 'command_sr_private_raw_apply_v1',
    correlationId: 'corr_sr_private_raw_apply_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    idempotencyKey: 'idem_sr_private_raw_apply_v1',
    targetId: 'project_sr_private_raw_proof',
  });
  const applied = bus.execute({
    request: buildRequest(sample, applyCommand),
    toolName: superResolutionRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error('Expected SR private app-server apply result.');
  if (applied.apply.provenance.runtimeStatus !== 'apply_rendered') {
    throw new Error(`Expected apply_rendered, got ${applied.apply.provenance.runtimeStatus}.`);
  }
  if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
    throw new Error('SR private app-server proof did not preserve accepted dry-run plan ID.');
  }

  const proof = {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    appliedGraphRevision: applied.apply.mutationResult.appliedGraphRevision,
    fixtureId: FIXTURE_ID,
    outputContentHash: applied.apply.mutationResult.outputArtifacts[0]?.contentHash,
    runtimeStatus: applied.apply.provenance.runtimeStatus,
    sourceCount: sample.frames.length,
  };
  await writeFile(join(rootPath, PROOF_PATH), `${JSON.stringify(proof, null, 2)}\n`);

  const reportPath = join(rootPath, REPORT_PATH);
  const collection = parseComputationalMergePrivateRunReportCollection(JSON.parse(await readFile(reportPath, 'utf8')));
  const upgraded = await upgradeReport(rootPath, collection, {
    applyCommandId: applyCommand.commandId,
    applyRuntimeId: applied.apply.mutationResult.derivedAssetId,
    dryRunCommandId: dryRunCommand.commandId,
    dryRunRuntimeId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    proofHash: await sha256File(join(rootPath, PROOF_PATH)),
  });
  await writeFile(reportPath, `${JSON.stringify(upgraded, null, 2)}\n`);
}

function buildControls(sample: RuntimeSample) {
  return {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: Math.max(sample.width, sample.height),
    outputName: 'Private RAW Super-Resolution Runtime Proof',
    outputScale: sample.outputScale,
    qualityPreference: 'best',
    sources: sample.frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_private_raw_${frame.sourceIndex}`,
      imagePath: frame.sourcePath,
      rawDefaultsApplied: true,
      sourceIndex: frame.sourceIndex,
    })),
  };
}

function buildRequest(sample: RuntimeSample, command: ReturnType<typeof buildSuperResolutionUiDryRunCommandV1>) {
  return {
    command,
    confidenceMapArtifactId: 'artifact_sr_private_raw_confidence',
    frames: sample.frames.map((frame) => ({
      contentHash: frame.contentHash,
      graphRevision: frame.graphRevision,
      height: sample.height,
      pixels: new Float32Array(frame.pixels),
      shiftX: frame.shiftX,
      shiftY: frame.shiftY,
      sourceIndex: frame.sourceIndex,
      width: sample.width,
    })),
    outputArtifactId: 'artifact_sr_private_raw_output',
    previewArtifactId: 'artifact_sr_private_raw_preview',
  };
}

async function upgradeReport(
  rootPath: string,
  collection: ComputationalMergePrivateRunReportCollection,
  proof: {
    applyCommandId: string;
    applyRuntimeId: string;
    dryRunCommandId: string;
    dryRunRuntimeId: string;
    proofHash: string;
  },
): Promise<ComputationalMergePrivateRunReportCollection> {
  const asset = async (path: string) => ({
    hash: await sha256File(join(rootPath, path)),
    path,
    publicRepoAllowed: false,
  });

  return parseComputationalMergePrivateRunReportCollection({
    ...collection,
    reports: await Promise.all(
      collection.reports.map(async (report) => {
        if (report.fixtureId !== FIXTURE_ID) return report;
        return {
          ...report,
          acceptanceStatus: 'runtime_apply_capable',
          artifacts: [
            ...report.artifacts.filter((artifact) => artifact.kind !== 'app_server_runtime_report_private'),
            {
              hash: proof.proofHash,
              kind: 'app_server_runtime_report_private',
              path: PROOF_PATH,
              publicRepoAllowed: false,
            },
          ],
          commandIds: {
            apply: proof.applyCommandId,
            dryRun: proof.dryRunCommandId,
          },
          notes:
            'Private RAW super-resolution decoded samples replayed through the typed app-server dry-run/apply bus. This proves runtime apply capability and review artifact wiring, but does not claim preview/export parity or final UI E2E acceptance.',
          runtimeResultIds: {
            apply: proof.applyRuntimeId,
            dryRun: proof.dryRunRuntimeId,
          },
          screenshotArtifacts: [
            { ...(await asset(SCREENSHOT_PATHS.modalBefore)), label: 'modal_before_apply' },
            { ...(await asset(SCREENSHOT_PATHS.modalAfter)), label: 'modal_after_apply' },
            { ...(await asset(SCREENSHOT_PATHS.resultReview)), label: 'result_review' },
            { ...(await asset(SCREENSHOT_PATHS.exportReview)), label: 'export_review' },
          ],
        };
      }),
    ),
  });
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(await Bun.file(path).arrayBuffer());
  return `sha256:${hasher.digest('hex')}`;
}

async function runSelfTest(): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), 'rawengine-sr-private-app-server-proof-'));
  try {
    await mkdir(join(rootPath, ARTIFACT_ROOT), { recursive: true });
    await writeFile(join(rootPath, SAMPLE_PATH), `${JSON.stringify(sampleRuntimeSample(), null, 2)}\n`);
    await writeFile(join(rootPath, REPORT_PATH), `${JSON.stringify(samplePrivateReportCollection(), null, 2)}\n`);
    for (const path of Object.values(SCREENSHOT_PATHS)) {
      await writeFile(join(rootPath, path), `synthetic ${path}`);
    }
    await runProof(rootPath);

    const upgraded = parseComputationalMergePrivateRunReportCollection(
      JSON.parse(await readFile(join(rootPath, REPORT_PATH), 'utf8')),
    );
    const report = upgraded.reports.find((candidate) => candidate.fixtureId === FIXTURE_ID);
    if (report?.acceptanceStatus !== 'runtime_apply_capable') {
      throw new Error('Expected self-test report to be upgraded to runtime_apply_capable.');
    }
    if (report.previewExportParity !== undefined) {
      throw new Error('SR runtime proof self-test must not synthesize preview/export parity.');
    }
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }

  console.log('SR real RAW private app-server proof self-test ok');
}

function sampleRuntimeSample(): RuntimeSample {
  const width = 12;
  const height = 8;
  const outputScale = 2;
  return runtimeSampleSchema.parse({
    fixtureId: FIXTURE_ID,
    frames: [
      { shiftX: 0, shiftY: 0, sourceIndex: 0 },
      { shiftX: 1, shiftY: 0, sourceIndex: 1 },
      { shiftX: 0, shiftY: 1, sourceIndex: 2 },
      { shiftX: 1, shiftY: 1, sourceIndex: 3 },
    ].map((frame) => ({
      contentHash: `sha256:${String(frame.sourceIndex).repeat(64)}`,
      graphRevision: `sha256:${'a'.repeat(64)}`,
      pixels: Array.from({ length: width * height }, (_value, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return Math.min(1, 0.12 + x * 0.02 + y * 0.015 + frame.sourceIndex * 0.005);
      }),
      shiftX: frame.shiftX,
      shiftY: frame.shiftY,
      sourceIndex: frame.sourceIndex,
      sourcePath: `private-fixtures/super-resolution/subpixel-detail-v1/frame-0${frame.sourceIndex + 1}.arw`,
    })),
    graphRevisionHash: `sha256:${'b'.repeat(64)}`,
    height,
    outputScale,
    width,
  });
}

function samplePrivateReportCollection(): ComputationalMergePrivateRunReportCollection {
  const hash = `sha256:${'0'.repeat(64)}`;
  const asset = (path: string) => ({ hash, path, publicRepoAllowed: false });
  const source = (path: string) => ({ ...asset(path), localRelativePath: path });
  const artifact = (kind: string, path: string) => ({ ...asset(path), kind });

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'private_reconstruction_artifact_smoke',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/super-resolution/subpixel-detail-v1'),
          artifact('decode_report_private', `${ARTIFACT_ROOT}/sr-subpixel-decode-report.json`),
          artifact('alignment_report_private', `${ARTIFACT_ROOT}/sr-subpixel-registration.json`),
          artifact('merge_output_private', `${ARTIFACT_ROOT}/sr-subpixel-reconstruction.tiff`),
          artifact('quality_report_private', `${ARTIFACT_ROOT}/sr-subpixel-quality.json`),
        ],
        featureFamily: 'super_resolution',
        fixtureId: FIXTURE_ID,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 1506,
        notes: 'sample super-resolution reconstruction artifact smoke report',
        qualityMetrics: [
          privateRawReportMetric('decodedSourceCount', 4, 4),
          privateRawReportMetric('decodedFinitePixelRatio', 1, 1),
          privateRawReportMetric('decodedNonzeroDimensionCount', 4, 4),
          privateRawReportMetric('superResolutionDetailGainRatio', 4, 4),
          privateRawReportMetric('superResolutionOutputPixelCount', 384, 384),
          privateRawReportMetric('superResolutionSourceCoverageRatio', 1, 1),
          privateRawReportMetric('superResolutionArtifactScore', 0.02, 0),
          privateRawReportMetric('superResolutionRegistrationResidualPx', 0.25, 0.015),
        ],
        reportId: 'computational-merge-run.super-resolution-subpixel.v1',
        screenshotArtifacts: [],
        sourceHashes: [
          source('private-fixtures/super-resolution/subpixel-detail-v1/frame-01.arw'),
          source('private-fixtures/super-resolution/subpixel-detail-v1/frame-02.arw'),
          source('private-fixtures/super-resolution/subpixel-detail-v1/frame-03.arw'),
          source('private-fixtures/super-resolution/subpixel-detail-v1/frame-04.arw'),
        ],
        uiIssue: 1335,
      },
    ],
    schemaVersion: 1,
    snapshotDate: '2026-06-18',
    validationMode: 'public_schema_private_reports',
  });
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
