#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { HdrAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/hdr/hdrAppServerRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  type ComputationalMergeCommandEnvelopeV1,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { privateRawReportMetric } from '../../../../scripts/lib/private-raw/computational-report-fixtures.ts';
import {
  type ComputationalMergePrivateRunReportCollection,
  parseComputationalMergePrivateRunReportCollection,
} from '../../../../src/schemas/computational-merge/computationalMergePrivateRunReportSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';

const hdrRoutePair = getComputationalMergeAppServerRoutePairSummary('hdr');
const ARTIFACT_ROOT = 'private-artifacts/validation/computational-merge';
const FIXTURE_ID = 'validation.computational-merge.hdr-bracket-alignment.v1';
const SAMPLE_PATH = `${ARTIFACT_ROOT}/hdr-bracket-runtime-sample.json`;
const PROOF_PATH = `${ARTIFACT_ROOT}/hdr-bracket-app-server-runtime-proof.json`;
const REPORT_PATH = `${ARTIFACT_ROOT}/hdr-bracket-private-run-report.json`;

const runtimeSampleSchema = z
  .object({
    fixtureId: z.literal(FIXTURE_ID),
    frames: z
      .array(
        z
          .object({
            contentHash: z.string().trim().min(1),
            exposureEv: z.number(),
            graphRevision: z.string().trim().min(1),
            pixels: z.array(z.number().min(0).max(1)).min(1),
            sourceIndex: z.number().int().nonnegative(),
            sourcePath: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(2),
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

const rootValue = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (rootValue === undefined || rootValue.trim().length === 0) {
  await runSelfTest();
  process.exit(0);
}
const root = resolve(rootValue);
await runProof(root);
console.log('hdr real RAW private app-server proof ok');

async function runProof(rootPath: string): Promise<void> {
  const sample = runtimeSampleSchema.parse(JSON.parse(await readFile(join(rootPath, SAMPLE_PATH), 'utf8')));
  const bus = new HdrAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const dryRunCommand = buildCommand(sample, true);
  const dryRun = bus.execute({
    request: buildRequest(sample, dryRunCommand),
    toolName: hdrRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error('Expected HDR private app-server dry-run result.');

  const applyCommand = buildCommand(sample, false, {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  });
  const applied = bus.execute({
    request: buildRequest(sample, applyCommand),
    toolName: hdrRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error('Expected HDR private app-server apply result.');
  if (applied.apply.provenance.runtimeStatus !== 'apply_rendered') {
    throw new Error(`Expected apply_rendered, got ${applied.apply.provenance.runtimeStatus}.`);
  }

  const proofRelativePath = PROOF_PATH;
  const proof = {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    alignmentConfidence: applied.apply.provenance.alignmentConfidence,
    appliedGraphRevision: applied.apply.mutationResult.appliedGraphRevision,
    fixtureId: FIXTURE_ID,
    outputContentHash: applied.apply.mutationResult.outputArtifacts[0]?.contentHash,
    runtimeStatus: applied.apply.provenance.runtimeStatus,
    sourceCount: sample.frames.length,
  };
  await writeFile(join(rootPath, proofRelativePath), `${JSON.stringify(proof, null, 2)}\n`);

  const proofHash = await sha256File(join(rootPath, proofRelativePath));
  const reportPath = join(rootPath, REPORT_PATH);
  const collection = parseComputationalMergePrivateRunReportCollection(JSON.parse(await readFile(reportPath, 'utf8')));
  const upgraded = upgradeReport(collection, {
    applyCommandId: applyCommand.commandId,
    applyRuntimeId: applied.apply.mutationResult.derivedAssetId,
    dryRunCommandId: dryRunCommand.commandId,
    dryRunRuntimeId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    proofHash,
    proofRelativePath,
  });
  await writeFile(reportPath, `${JSON.stringify(upgraded, null, 2)}\n`);
}

function buildRequest(sampleValue: z.infer<typeof runtimeSampleSchema>, command: ComputationalMergeCommandEnvelopeV1) {
  return {
    clipThreshold: 0.99,
    command,
    frames: sampleValue.frames.map((frame) => ({
      contentHash: frame.contentHash,
      exposureEv: frame.exposureEv,
      graphRevision: frame.graphRevision,
      height: sampleValue.height,
      pixels: new Float64Array(frame.pixels),
      sourceIndex: frame.sourceIndex,
      width: sampleValue.width,
    })),
    outputArtifactId: 'artifact_hdr_private_raw_output',
    previewArtifactId: 'artifact_hdr_private_raw_preview',
    searchRadiusPx: 0,
    sensorWhiteRadiance: 1,
  };
}

function buildCommand(
  sampleValue: z.infer<typeof runtimeSampleSchema>,
  dryRun: boolean,
  acceptedPlan?: { acceptedDryRunPlanHash: string; acceptedDryRunPlanId: string },
): ComputationalMergeCommandEnvelopeV1 {
  const commandId = dryRun ? 'command_hdr_private_raw_dry_run_v1' : 'command_hdr_private_raw_apply_v1';
  return {
    actor: { id: 'agent_rawengine_private_hdr', kind: ActorKind.Agent },
    approval: {
      approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: dryRun ? 'Private HDR app-server dry-run proof.' : 'Private HDR app-server apply proof.',
      state: dryRun ? 'not_required' : 'approved',
    },
    commandId,
    commandType: 'computationalMerge.createHdr',
    correlationId: dryRun ? 'corr_hdr_private_raw_dry_run_v1' : 'corr_hdr_private_raw_apply_v1',
    dryRun,
    expectedGraphRevision: sampleValue.graphRevisionHash,
    parameters: {
      alignmentMode: 'none',
      bracketValidation: 'required',
      deghosting: 'medium',
      maxPreviewDimensionPx: Math.max(sampleValue.width, sampleValue.height),
      mergeStrategy: 'scene_linear_radiance',
      outputName: 'Private RAW HDR runtime proof',
      qualityPreference: 'balanced',
      sources: sampleValue.frames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: frame.exposureEv,
        imageId: `img_hdr_private_raw_${frame.sourceIndex}`,
        imagePath: frame.sourcePath,
        rawDefaultsApplied: true,
        role: 'hdr_bracket',
        sourceIndex: frame.sourceIndex,
      })),
      toneMapPreview: true,
      ...acceptedPlan,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_hdr_private_raw_proof', kind: 'project' },
  };
}

function upgradeReport(
  collection: ComputationalMergePrivateRunReportCollection,
  proof: {
    applyCommandId: string;
    applyRuntimeId: string;
    dryRunCommandId: string;
    dryRunRuntimeId: string;
    proofHash: string;
    proofRelativePath: string;
  },
): ComputationalMergePrivateRunReportCollection {
  return parseComputationalMergePrivateRunReportCollection({
    ...collection,
    reports: collection.reports.map((report) => {
      if (report.fixtureId !== FIXTURE_ID) return report;
      return {
        ...report,
        acceptanceStatus: 'runtime_apply_capable',
        artifacts: [
          ...report.artifacts.filter((artifact) => artifact.kind !== 'app_server_runtime_report_private'),
          {
            hash: proof.proofHash,
            kind: 'app_server_runtime_report_private',
            path: proof.proofRelativePath,
            publicRepoAllowed: false,
          },
        ],
        commandIds: {
          apply: proof.applyCommandId,
          dryRun: proof.dryRunCommandId,
        },
        notes:
          'Private RAW HDR decoded samples replayed through the typed app-server dry-run/apply bus; full browser E2E quality remains tracked separately.',
        runtimeResultIds: {
          apply: proof.applyRuntimeId,
          dryRun: proof.dryRunRuntimeId,
        },
      };
    }),
  });
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(await Bun.file(path).arrayBuffer());
  return `sha256:${hasher.digest('hex')}`;
}

async function runSelfTest(): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), 'rawengine-hdr-private-app-server-proof-'));
  try {
    await mkdir(join(rootPath, ARTIFACT_ROOT), { recursive: true });
    await writeFile(join(rootPath, SAMPLE_PATH), `${JSON.stringify(sampleRuntimeSample(), null, 2)}\n`);
    await writeFile(join(rootPath, REPORT_PATH), `${JSON.stringify(samplePrivateReportCollection(), null, 2)}\n`);
    await runProof(rootPath);

    const upgraded = parseComputationalMergePrivateRunReportCollection(
      JSON.parse(await readFile(join(rootPath, REPORT_PATH), 'utf8')),
    );
    const report = upgraded.reports.find((candidate) => candidate.fixtureId === FIXTURE_ID);
    if (report?.acceptanceStatus !== 'runtime_apply_capable') {
      throw new Error('Expected self-test report to be upgraded to runtime_apply_capable.');
    }
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }

  console.log('hdr real RAW private app-server proof self-test ok');
}

function sampleRuntimeSample(): z.infer<typeof runtimeSampleSchema> {
  const width = 8;
  const height = 6;
  const basePixels = Array.from({ length: width * height }, (_value, index) => 0.05 + (index % width) * 0.01);
  return runtimeSampleSchema.parse({
    fixtureId: FIXTURE_ID,
    frames: [-2, 0, 2].map((exposureEv, sourceIndex) => ({
      contentHash: `sha256:${String(sourceIndex).repeat(64)}`,
      exposureEv,
      graphRevision: 'graph_rev_hdr_private_self_test',
      pixels: basePixels.map((pixel) => Math.min(1, pixel * 2 ** exposureEv)),
      sourceIndex,
      sourcePath: `private-fixtures/hdr/bracket-alignment-v1/frame-0${sourceIndex + 1}.arw`,
    })),
    graphRevisionHash: `sha256:${'a'.repeat(64)}`,
    height,
    width,
  });
}

function samplePrivateReportCollection(): ComputationalMergePrivateRunReportCollection {
  const hash = `sha256:${'0'.repeat(64)}`;
  const asset = (path: string) => ({ hash, path, publicRepoAllowed: false });
  const source = (path: string) => ({ ...asset(path), localRelativePath: path });
  const artifact = (kind: string, path: string) => ({ ...asset(path), kind });
  const previewExportParity = privateRawReportMetric('previewExportMeanAbsDelta', 0.015, 0);

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'private_preview_export_smoke',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/hdr/bracket-alignment-v1'),
          artifact('decode_report_private', `${ARTIFACT_ROOT}/hdr-bracket-decode.json`),
          artifact('alignment_report_private', `${ARTIFACT_ROOT}/hdr-bracket-alignment.json`),
          artifact('merge_output_private', `${ARTIFACT_ROOT}/hdr-bracket-merge.tiff`),
          artifact('preview_after_private', `${ARTIFACT_ROOT}/hdr-bracket-preview.png`),
          artifact('export_after_private', `${ARTIFACT_ROOT}/hdr-bracket-export.tiff`),
          artifact('quality_report_private', `${ARTIFACT_ROOT}/hdr-bracket-quality.json`),
        ],
        commandIds: { apply: 'command_hdr_apply', dryRun: 'command_hdr_dry_run' },
        featureFamily: 'hdr_merge',
        fixtureId: FIXTURE_ID,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 2062,
        notes: 'sample private HDR preview/export smoke report',
        previewExportParity,
        qualityMetrics: [
          privateRawReportMetric('exposureBracketCoverageEv', 4, 4),
          privateRawReportMetric('highlightRecoveryRatio', 1.1, 1.1),
          privateRawReportMetric('ghostSuppressionScore', 0.85, 0.85),
          previewExportParity,
        ],
        reportId: 'computational-merge-run.hdr-bracket-alignment.v1',
        runtimeResultIds: { apply: 'runtime_hdr_apply', dryRun: 'runtime_hdr_dry_run' },
        screenshotArtifacts: [
          { ...asset(`${ARTIFACT_ROOT}/hdr-bracket-modal-before.png`), label: 'modal_before_apply' },
          { ...asset(`${ARTIFACT_ROOT}/hdr-bracket-modal-after.png`), label: 'modal_after_apply' },
        ],
        sourceHashes: [
          source('private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw'),
          source('private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw'),
          source('private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw'),
        ],
        uiIssue: 171,
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
