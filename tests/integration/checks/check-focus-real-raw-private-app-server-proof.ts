#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { FocusStackAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/focus-stack/focusStackAppServerRuntime.ts';
import {
  buildFocusStackUiApplyCommandV1,
  buildFocusStackUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/focus-stack/focusStackUiControls.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational/proof-budgets.ts';
import { privateRawReportMetric } from '../../../scripts/lib/private-raw/computational-report-fixtures.ts';
import {
  type ComputationalMergePrivateRunReportCollection,
  parseComputationalMergePrivateRunReportCollection,
} from '../../../src/schemas/computationalMergePrivateRunReportSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const focusRoutePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');
const ARTIFACT_ROOT = 'private-artifacts/validation/computational-merge';
const FIXTURE_ID = 'validation.computational-merge.focus-plane-transition.v1';
const SAMPLE_PATH = `${ARTIFACT_ROOT}/focus-plane-runtime-sample.json`;
const PROOF_PATH = `${ARTIFACT_ROOT}/focus-plane-app-server-runtime-proof.json`;
const REPORT_PATH = `${ARTIFACT_ROOT}/focus-plane-private-run-report.json`;
const SCREENSHOT_PATHS = {
  exportReview: `${ARTIFACT_ROOT}/focus-plane-export-review.png`,
  modalAfter: `${ARTIFACT_ROOT}/focus-plane-modal-after.png`,
  modalBefore: `${ARTIFACT_ROOT}/focus-plane-modal-before.png`,
  resultReview: `${ARTIFACT_ROOT}/focus-plane-result-review.png`,
};

const runtimeSampleFrameSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    focusDistanceMm: z.number().positive(),
    graphRevision: z.string().trim().min(1),
    pixels: z.array(z.number().min(0).max(1)).min(1),
    sourceIndex: z.number().int().nonnegative(),
    sourcePath: z.string().trim().min(1),
    translationX: z.number().int(),
    translationY: z.number().int(),
  })
  .strict();

const runtimeSampleSchema = z
  .object({
    fixtureId: z.literal(FIXTURE_ID),
    frames: z.array(runtimeSampleFrameSchema).min(2),
    graphRevisionHash: z.string().trim().min(1),
    height: z.number().int().positive(),
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
console.log('focus real RAW private app-server proof ok');

async function runProof(rootPath: string): Promise<void> {
  const sample = runtimeSampleSchema.parse(JSON.parse(await readFile(join(rootPath, SAMPLE_PATH), 'utf8')));
  const bus = new FocusStackAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const controls = buildControls(sample);
  const dryRunCommand = buildFocusStackUiDryRunCommandV1(controls, {
    commandId: 'command_focus_private_raw_dry_run_v1',
    correlationId: 'corr_focus_private_raw_dry_run_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    targetId: 'project_focus_private_raw_proof',
  });
  const dryRun = bus.execute({
    request: buildRequest(sample, dryRunCommand),
    toolName: focusRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error('Expected focus private app-server dry-run result.');

  const applyCommand = buildFocusStackUiApplyCommandV1(controls, {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    commandId: 'command_focus_private_raw_apply_v1',
    correlationId: 'corr_focus_private_raw_apply_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    idempotencyKey: 'idem_focus_private_raw_apply_v1',
    targetId: 'project_focus_private_raw_proof',
  });
  const applied = bus.execute({
    request: buildRequest(sample, applyCommand),
    toolName: focusRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error('Expected focus private app-server apply result.');
  if (applied.apply.provenance.runtimeStatus !== 'apply_rendered') {
    throw new Error(`Expected apply_rendered, got ${applied.apply.provenance.runtimeStatus}.`);
  }
  if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
    throw new Error('Focus private app-server proof did not preserve accepted dry-run plan ID.');
  }

  const proof = {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    appliedGraphRevision: applied.apply.mutationResult.appliedGraphRevision,
    fixtureId: FIXTURE_ID,
    focusCoverageRatio: applied.apply.provenance.focusCoverageRatio,
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
    blendMethod: 'weighted_sharpness',
    maxPreviewDimensionPx: Math.max(sample.width, sample.height),
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
    outputName: 'Private RAW Focus Stack Runtime Proof',
    qualityPreference: 'best',
    retouchLayerPolicy: 'generate_retouch_layer',
    sources: sample.frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      focusDistanceMm: frame.focusDistanceMm,
      imageId: `img_focus_private_raw_${frame.sourceIndex}`,
      imagePath: frame.sourcePath,
      rawDefaultsApplied: true,
      sourceIndex: frame.sourceIndex,
    })),
  };
}

function buildRequest(sample: RuntimeSample, command: ReturnType<typeof buildFocusStackUiDryRunCommandV1>) {
  return {
    cells: buildCells(sample),
    command,
    depthConfidenceArtifactId: 'artifact_focus_private_raw_depth_confidence',
    frames: sample.frames.map((frame) => ({
      contentHash: frame.contentHash,
      focusDistanceMm: frame.focusDistanceMm,
      graphRevision: frame.graphRevision,
      height: sample.height,
      pixels: new Float32Array(frame.pixels),
      sourceIndex: frame.sourceIndex,
      translationX: frame.translationX,
      translationY: frame.translationY,
      width: sample.width,
    })),
    outputArtifactId: 'artifact_focus_private_raw_output',
    previewArtifactId: 'artifact_focus_private_raw_preview',
    retouchLayerArtifactId: 'artifact_focus_private_raw_retouch',
    sharpnessMapArtifactId: 'artifact_focus_private_raw_sharpness',
  };
}

function buildCells(sample: RuntimeSample) {
  const cellWidth = Math.max(1, Math.floor(sample.width / sample.frames.length));
  return sample.frames.map((frame, index) => {
    const x = index * cellWidth;
    const width = index === sample.frames.length - 1 ? sample.width - x : cellWidth;
    return {
      height: sample.height,
      lowConfidence: false,
      sourceScores: sample.frames.map((candidate) => ({
        relativeConfidence: candidate.sourceIndex === frame.sourceIndex ? 1 : 0.01,
        sourceIndex: candidate.sourceIndex,
      })),
      width,
      x,
      y: 0,
    };
  });
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
            'Private RAW focus-stack decoded samples replayed through the typed app-server dry-run/apply bus. This proves runtime apply capability and review artifact wiring, but does not claim preview/export parity or final UI E2E acceptance.',
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
  const rootPath = await mkdtemp(join(tmpdir(), 'rawengine-focus-private-app-server-proof-'));
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
      throw new Error('Focus runtime proof self-test must not synthesize preview/export parity.');
    }
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }

  console.log('focus real RAW private app-server proof self-test ok');
}

function sampleRuntimeSample(): RuntimeSample {
  const width = 12;
  const height = 8;
  const sourcePaths = [
    'private-fixtures/focus-stack/alaska-plane-v1/_DSC7509.ARW',
    'private-fixtures/focus-stack/alaska-plane-v1/_DSC7510.ARW',
    'private-fixtures/focus-stack/alaska-plane-v1/_DSC7511.ARW',
  ];
  return runtimeSampleSchema.parse({
    fixtureId: FIXTURE_ID,
    frames: [0, 1, 2].map((sourceIndex) => {
      const sourcePath = sourcePaths[sourceIndex];
      if (sourcePath === undefined) throw new Error(`Missing focus sample source path ${sourceIndex}.`);
      return {
        contentHash: `sha256:${String(sourceIndex).repeat(64)}`,
        focusDistanceMm: 180 + sourceIndex * 60,
        graphRevision: `sha256:${'a'.repeat(64)}`,
        pixels: Array.from({ length: width * height }, (_value, index) => {
          const x = index % width;
          const active = Math.floor((x / width) * 3) === sourceIndex;
          return active ? 0.8 : 0.12 + sourceIndex * 0.01;
        }),
        sourceIndex,
        sourcePath,
        translationX: 0,
        translationY: 0,
      };
    }),
    graphRevisionHash: `sha256:${'b'.repeat(64)}`,
    height,
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
        acceptanceStatus: 'private_focus_stack_artifact_smoke',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/focus-stack/alaska-plane-v1'),
          artifact('decode_report_private', `${ARTIFACT_ROOT}/focus-plane-decode-report.json`),
          artifact('alignment_report_private', `${ARTIFACT_ROOT}/focus-plane-alignment.json`),
          artifact('merge_output_private', `${ARTIFACT_ROOT}/focus-plane-merge.tiff`),
          artifact('quality_report_private', `${ARTIFACT_ROOT}/focus-plane-quality.json`),
        ],
        featureFamily: 'focus_stack',
        fixtureId: FIXTURE_ID,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 1507,
        notes: 'sample focus stack artifact smoke report',
        qualityMetrics: [
          privateRawReportMetric('decodedSourceCount', 3, 3),
          privateRawReportMetric('decodedFinitePixelRatio', 1, 1),
          privateRawReportMetric('decodedNonzeroDimensionCount', 3, 3),
          privateRawReportMetric('focusStackWinnerSourceCount', 2, 3),
          privateRawReportMetric('focusStackSourceCoverageRatio', 0.67, 1),
          privateRawReportMetric('focusStackOutputPixelCount', 1, 96),
          privateRawReportMetric('sharpnessGainRatio', 1.15, 1.2),
          privateRawReportMetric('focusTransitionArtifactScore', 0.9, 0.2),
          privateRawReportMetric('focusStackLowConfidenceCellRatio', 0.5, 0.1),
        ],
        reportId: 'computational-merge-run.focus-plane-transition.v1',
        screenshotArtifacts: [],
        sourceHashes: [
          source('private-fixtures/focus-stack/alaska-plane-v1/_DSC7509.ARW'),
          source('private-fixtures/focus-stack/alaska-plane-v1/_DSC7510.ARW'),
          source('private-fixtures/focus-stack/alaska-plane-v1/_DSC7511.ARW'),
        ],
        uiIssue: 1334,
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
