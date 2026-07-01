#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { openComputationalMergeDerivedSourceV1 } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeDerivedSourceRuntime.ts';
import { createRawEngineLocalAppServerBridge } from '../../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import { PanoramaAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaAppServerRuntime.ts';
import {
  buildPanoramaUiApplyCommandV1,
  buildPanoramaUiDryRunCommandV1,
} from '../../../../packages/rawengine-schema/src/panorama/panoramaUiControls.ts';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  toneColorCommandEnvelopeV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleRawEngineSceneColorPipelineV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';
import { privateRawReportMetric } from '../../../../scripts/lib/private-raw/computational-report-fixtures.ts';
import {
  type ComputationalMergePrivateRunReportCollection,
  parseComputationalMergePrivateRunReportCollection,
} from '../../../../src/schemas/computational-merge/computationalMergePrivateRunReportSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import {
  buildPanoramaDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../../src/utils/derivedOutputReceipt.ts';

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const ARTIFACT_ROOT = 'private-artifacts/validation/computational-merge';
const FIXTURE_ID = 'validation.computational-merge.panorama-overlap.v1';
const SAMPLE_PATH = `${ARTIFACT_ROOT}/panorama-overlap-runtime-sample.json`;
const PROOF_PATH = `${ARTIFACT_ROOT}/panorama-overlap-app-server-runtime-proof.json`;
const REPORT_PATH = `${ARTIFACT_ROOT}/panorama-overlap-private-run-report.json`;
const MAX_PRIVATE_PANORAMA_SYNTHETIC_SOURCE_PIXELS = 100_000;
const DERIVED_PANORAMA_OUTPUT_PATH = `${ARTIFACT_ROOT}/panorama-overlap-merge.tiff`;
const REVIEW_ARTIFACTS = [
  ['modal_before_apply', `${ARTIFACT_ROOT}/panorama-overlap-modal-before.png`],
  ['modal_after_apply', `${ARTIFACT_ROOT}/panorama-overlap-modal-after.png`],
  ['result_review', `${ARTIFACT_ROOT}/panorama-overlap-result-review.png`],
  ['export_review', `${ARTIFACT_ROOT}/panorama-overlap-export-review.png`],
] as const;

const runtimeSampleSchema = z
  .object({
    connectedSourceIndices: z.array(z.number().int().nonnegative()).min(1),
    fixtureId: z.literal(FIXTURE_ID),
    frames: z
      .array(
        z
          .object({
            contentHash: z.string().trim().min(1),
            expectedOffsetX: z.number().int().nonnegative(),
            expectedOffsetY: z.number().int(),
            graphRevision: z.string().trim().min(1),
            height: z.number().int().positive(),
            sourceIndex: z.number().int().nonnegative(),
            sourcePath: z.string().trim().min(1),
            width: z.number().int().positive(),
          })
          .strict(),
      )
      .min(2),
    graphRevisionHash: z.string().trim().min(1),
  })
  .strict();

type PanoramaPrivateRuntimeSample = z.infer<typeof runtimeSampleSchema>;
type PanoramaPrivateRuntimeFrame = PanoramaPrivateRuntimeSample['frames'][number];
type PanoramaApplyResult = Extract<ReturnType<PanoramaAppServerRuntimeToolBusV1['execute']>, { kind: 'apply' }>;

const rootValue = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (rootValue === undefined || rootValue.trim().length === 0) {
  await runSelfTest();
  process.exit(0);
}

await runProof(resolve(rootValue));
console.log('panorama real RAW private app-server proof ok');

async function runProof(rootPath: string): Promise<void> {
  const sample = runtimeSampleSchema.parse(JSON.parse(await readFile(join(rootPath, SAMPLE_PATH), 'utf8')));
  const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const dryRunCommand = buildPanoramaUiDryRunCommandV1(buildControls(sample), {
    commandId: 'command_panorama_private_raw_dry_run_v1',
    correlationId: 'corr_panorama_private_raw_dry_run_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    targetId: 'project_panorama_private_raw_proof',
  });
  const dryRun = bus.execute({
    request: buildRequest(sample, dryRunCommand),
    toolName: panoramaRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error('Expected panorama private app-server dry-run result.');

  const applyCommand = buildPanoramaUiApplyCommandV1(buildControls(sample), {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    commandId: 'command_panorama_private_raw_apply_v1',
    correlationId: 'corr_panorama_private_raw_apply_v1',
    expectedGraphRevision: sample.graphRevisionHash,
    idempotencyKey: 'idem_panorama_private_raw_apply_v1',
    targetId: 'project_panorama_private_raw_proof',
  });
  const applied = bus.execute({
    request: buildRequest(sample, applyCommand),
    toolName: panoramaRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error('Expected panorama private app-server apply result.');
  if (applied.apply.provenance.runtimeStatus !== 'apply_rendered') {
    throw new Error(`Expected apply_rendered, got ${applied.apply.provenance.runtimeStatus}.`);
  }
  if (applied.apply.provenance.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
    throw new Error('Panorama private app-server proof did not preserve accepted dry-run plan ID.');
  }
  if (applied.apply.provenance.stitchedSourceCount !== sample.connectedSourceIndices.length) {
    throw new Error(
      `Expected ${sample.connectedSourceIndices.length} stitched panorama sources, got ${applied.apply.provenance.stitchedSourceCount}.`,
    );
  }
  const outputContentHash = applied.apply.mutationResult.outputArtifacts[0]?.contentHash;
  if (outputContentHash === undefined) {
    throw new Error('Panorama private app-server proof did not produce an output content hash.');
  }

  const collection = parseComputationalMergePrivateRunReportCollection(
    JSON.parse(await readFile(join(rootPath, REPORT_PATH), 'utf8')),
  );
  const sourceHashIntegrity = await verifySourceHashesUnchanged(rootPath, collection);
  const derivedSettings = buildDerivedSettings();
  const derivedReceipt = buildPanoramaDerivedOutputReceipt({
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    review: buildReview(sample, applied),
    settings: derivedSettings,
  });
  const openResult = openComputationalMergeDerivedSourceV1({
    actor: applyCommand.actor,
    approval: applyCommand.approval,
    command: applyCommand,
    correlationId: 'corr_panorama_private_raw_open_derived_v1',
    currentGraphRevision: applied.apply.mutationResult.appliedGraphRevision,
    mutationResult: {
      ...applied.apply.mutationResult,
      changedNodeIds: [derivedReceipt.outputArtifactId],
      derivedAssetId: derivedReceipt.outputArtifactId,
      outputArtifacts: [
        {
          artifactId: derivedReceipt.outputArtifactId,
          contentHash: derivedReceipt.outputContentHash,
          dimensions: derivedReceipt.outputDimensions,
          kind: 'merge_output' as const,
          storage: 'export_path' as const,
        },
      ],
    },
    receipt: {
      acceptedDryRunPlanHash: derivedReceipt.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: derivedReceipt.acceptedDryRunPlanId,
      family: derivedReceipt.family,
      openInEditorAction: {
        path: derivedReceipt.openInEditorAction.path,
        state: derivedReceipt.openInEditorAction.state,
      },
      outputArtifactId: derivedReceipt.outputArtifactId,
      outputContentHash: derivedReceipt.outputContentHash,
      outputPath: derivedReceipt.outputPath,
      provenanceSidecarPath: derivedReceipt.provenanceSidecar?.sidecarPath,
      receiptId: derivedReceipt.receiptId,
      settingsHash: derivedReceipt.settingsHash,
      sourceGraphRevisions: derivedReceipt.sourceGraphRevisions,
      staleReasons: derivedReceipt.staleReasons,
      staleState: derivedReceipt.staleState,
    },
    requestId: 'request_panorama_private_raw_open_derived_v1',
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  });
  const normalEdit = await applyNormalToneColorEdit(openResult.openPath, openResult.derivedSourceId);
  const staleBySettings = deriveDerivedOutputReceiptState({
    current: buildPanoramaDerivedOutputReceipt({
      acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
      review: buildReview(sample, applied),
      settings: { ...derivedSettings, projection: 'cylindrical' },
    }),
    receipt: derivedReceipt,
  });
  if (!staleBySettings.staleReasons?.includes('settings_hash_changed')) {
    throw new Error('Panorama private proof did not produce settings stale-state metadata.');
  }

  const proof = {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    appliedGraphRevision: applied.apply.mutationResult.appliedGraphRevision,
    applyToolName: panoramaRoutePair.applyToolName,
    derivedHandoff: {
      editableGate: derivedReceipt.editableGate,
      family: openResult.family,
      openDerivedSourceId: openResult.derivedSourceId,
      openPath: openResult.openPath,
      outputDimensions: derivedReceipt.outputDimensions,
      outputPath: derivedReceipt.outputPath,
      provenanceSidecarPath: derivedReceipt.provenanceSidecar?.sidecarPath,
      sourceCount: derivedReceipt.sourceCount,
    },
    dryRunToolName: panoramaRoutePair.dryRunToolName,
    fixtureId: FIXTURE_ID,
    normalEdit,
    outputContentHash,
    provenance: {
      alignmentEdgeCount: applied.apply.provenance.alignment.graph.selectedEdges.length,
      colorSpace: 'camera_rgb_to_derived_artifact_source',
      graphRevisionHash: sample.graphRevisionHash,
      projection: applied.apply.provenance.projectionSettings.effectiveProjection,
      sourceHashes: sourceHashIntegrity.sourceHashes,
      staleState: derivedReceipt.staleState,
      staleStateAfterSettingsChange: staleBySettings.staleState,
      staleStateReasonsAfterSettingsChange: staleBySettings.staleReasons ?? [],
    },
    runtimeStatus: applied.apply.provenance.runtimeStatus,
    sourceHashIntegrity,
    stitchedSourceCount: applied.apply.provenance.stitchedSourceCount,
  };
  await writeFile(join(rootPath, PROOF_PATH), `${JSON.stringify(proof, null, 2)}\n`);

  const upgraded = await upgradeReport(rootPath, collection, {
    applyCommandId: applyCommand.commandId,
    applyRuntimeId: applied.apply.mutationResult.derivedAssetId,
    dryRunCommandId: dryRunCommand.commandId,
    dryRunRuntimeId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    proofHash: await sha256File(join(rootPath, PROOF_PATH)),
  });
  await writeFile(join(rootPath, REPORT_PATH), `${JSON.stringify(upgraded, null, 2)}\n`);
}

function buildControls(sample: z.infer<typeof runtimeSampleSchema>) {
  return {
    blendMode: 'multi_band',
    boundaryMode: 'auto_crop',
    exposureMode: 'gain_compensation',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
    outputName: 'Private RAW Panorama runtime proof',
    projection: 'rectilinear',
    qualityPreference: 'balanced',
    sources: sample.frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_private_raw_${frame.sourceIndex}`,
      imagePath: frame.sourcePath,
      sourceIndex: frame.sourceIndex,
    })),
  } as const;
}

function buildDerivedSettings() {
  return {
    blendMode: 'multi_band',
    boundaryMode: 'auto_crop',
    exposureMode: 'gain_compensation',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
    outputName: 'Private RAW Panorama runtime proof',
    projection: 'rectilinear',
    qualityPreference: 'balanced',
  } as const;
}

function buildReview(sample: PanoramaPrivateRuntimeSample, applied: PanoramaApplyResult) {
  const outputArtifact = applied.apply.mutationResult.outputArtifacts[0];
  if (outputArtifact === undefined) throw new Error('Panorama private proof did not emit an output artifact.');

  return {
    boundaryMode: 'auto_crop',
    capabilityLevel: 'runtime_apply_capable' as const,
    crop: {
      height: applied.apply.sidecarArtifact.crop.height,
      mode: 'auto',
      preCropHeight: applied.apply.provenance.projectedBounds.height,
      preCropWidth: applied.apply.provenance.projectedBounds.width,
      width: applied.apply.sidecarArtifact.crop.width,
      x: applied.apply.sidecarArtifact.crop.x,
      y: applied.apply.sidecarArtifact.crop.y,
    },
    exposureNormalizationSummary: {
      appliedGainCount: applied.apply.provenance.exposureNormalizationResult.appliedGainCount ?? 0,
      mode: applied.apply.provenance.exposureNormalizationResult.mode,
    },
    outputDimensions: outputArtifact.dimensions,
    outputPath: DERIVED_PANORAMA_OUTPUT_PATH,
    projection: applied.apply.provenance.projectionSettings.effectiveProjection,
    seamReview: {
      policy: 'adaptive_dp_feather_v1' as const,
      reviewStatus: 'ready' as const,
      seamCount: applied.apply.provenance.seamReview.overlapEdgeCount,
      seams: applied.apply.provenance.alignment.graph.selectedEdges.map((edge) => ({
        confidence: 'high' as const,
        featherWidthPx: 100,
        fromSourceIndex: edge.fromSourceIndex,
        p95ErrorPx: 0.25,
        toSourceIndex: edge.toSourceIndex,
      })),
    },
    sourceContribution: {
      excludedSourceCount: sample.frames.length - sample.connectedSourceIndices.length,
      regions: sample.frames.map((frame) => ({
        coverageRatio: sample.connectedSourceIndices.includes(frame.sourceIndex)
          ? 1 / sample.connectedSourceIndices.length
          : 0,
        role: sample.connectedSourceIndices.includes(frame.sourceIndex) ? ('stitched' as const) : ('excluded' as const),
        sourceIndex: frame.sourceIndex,
      })),
      stitchedSourceCount: sample.connectedSourceIndices.length,
    },
    sourceCount: sample.frames.length,
    sourceRefs: sample.frames.map((frame) => ({
      contentHash: frame.contentHash,
      graphRevision: frame.graphRevision,
      path: frame.sourcePath,
      sourceIndex: frame.sourceIndex,
    })),
    warningCodes: applied.apply.mutationResult.warnings,
  };
}

async function applyNormalToneColorEdit(openPath: string, derivedSourceId: string) {
  const bridge = createRawEngineLocalAppServerBridge();
  const dryRunCommand = toneColorCommandEnvelopeV1Schema.parse({
    ...sampleToneColorCommandEnvelopeV1,
    actor: { id: 'codex-panorama-private-proof', kind: 'agent' },
    approval: {
      approvalClass: 'preview_only',
      reason: 'Preview a normal tone/color edit against the opened derived panorama source.',
      state: 'not_required',
    },
    colorPipeline: sampleRawEngineSceneColorPipelineV1,
    commandId: 'command_panorama_private_raw_derived_tone_dry_run_v1',
    correlationId: 'corr_panorama_private_raw_derived_tone_v1',
    dryRun: true,
    expectedGraphRevision: `graph_rev_${derivedSourceId}`,
    parameters: {
      blackPoint: -2,
      clarity: 4,
      contrast: 7,
      exposureEv: 0.18,
      highlights: -10,
      saturation: 5,
      shadows: 12,
      whitePoint: 3,
    },
    target: {
      imagePath: openPath,
      kind: 'image',
      virtualCopyId: `vc_${derivedSourceId}`,
    },
  });
  const dryRun = await bridge.dispatch(dryRunCommand, {
    now: () => new Date('2026-07-01T12:00:00.000Z'),
    requestId: 'request_panorama_private_raw_derived_tone_dry_run_v1',
  });
  if (!dryRun.ok) throw new Error(`Panorama derived tone/color dry-run failed: ${dryRun.reason}`);
  const dryRunResult = dryRun.result;
  if (dryRunResult.dryRunPlanHash === undefined || dryRunResult.dryRunPlanId === undefined) {
    throw new Error('Panorama derived tone/color dry-run did not return a plan identity.');
  }

  const applyCommand = toneColorCommandEnvelopeV1Schema.parse({
    ...dryRunCommand,
    approval: {
      approvalClass: 'edit_apply',
      reason: 'Apply the accepted tone/color edit to the derived panorama source.',
      state: 'approved',
    },
    commandId: 'command_panorama_private_raw_derived_tone_apply_v1',
    dryRun: false,
    parameters: {
      ...dryRunCommand.parameters,
      acceptedDryRunPlanHash: dryRunResult.dryRunPlanHash,
      acceptedDryRunPlanId: dryRunResult.dryRunPlanId,
    },
  });
  const applied = await bridge.dispatch(applyCommand, {
    now: () => new Date('2026-07-01T12:00:01.000Z'),
    requestId: 'request_panorama_private_raw_derived_tone_apply_v1',
  });
  if (!applied.ok) throw new Error(`Panorama derived tone/color apply failed: ${applied.reason}`);
  if (!applied.result.mutates) throw new Error('Panorama derived tone/color apply did not mutate the edit graph.');

  return {
    appliedGraphRevision: applied.result.appliedGraphRevision,
    applyCommandId: applyCommand.commandId,
    changedNodeIds: applied.result.changedNodeIds,
    dryRunCommandId: dryRunCommand.commandId,
    dryRunPlanHash: dryRunResult.dryRunPlanHash,
    dryRunPlanId: dryRunResult.dryRunPlanId,
    targetImagePath: openPath,
  };
}

async function verifySourceHashesUnchanged(rootPath: string, collection: ComputationalMergePrivateRunReportCollection) {
  const report = collection.reports.find((candidate) => candidate.fixtureId === FIXTURE_ID);
  if (report === undefined) throw new Error(`Missing private run report for ${FIXTURE_ID}.`);
  const sourceHashes = await Promise.all(
    report.sourceHashes.map(async (source) => {
      const actualHash = await sha256File(join(rootPath, source.localRelativePath));
      if (actualHash !== source.hash) {
        throw new Error(`${source.localRelativePath}: source RAW hash changed (${source.hash} -> ${actualHash}).`);
      }
      return {
        hash: actualHash,
        localRelativePath: source.localRelativePath,
      };
    }),
  );

  return {
    sourceHashes,
    state: 'unchanged' as const,
  };
}

function buildRequest(
  sample: PanoramaPrivateRuntimeSample,
  command: ReturnType<typeof buildPanoramaUiDryRunCommandV1>,
) {
  return {
    command,
    connectedSourceIndices: sample.connectedSourceIndices,
    outputArtifactId: 'artifact_panorama_private_raw_output',
    previewArtifactId: 'artifact_panorama_private_raw_preview',
    seed: 'rawengine-panorama-private-raw-v1',
    sourceFrames: sample.frames.map(scaleFrameForSyntheticReplay),
  };
}

function scaleFrameForSyntheticReplay(frame: PanoramaPrivateRuntimeFrame) {
  const pixelCount = frame.width * frame.height;
  const scale = Math.min(1, Math.sqrt(MAX_PRIVATE_PANORAMA_SYNTHETIC_SOURCE_PIXELS / pixelCount));

  return {
    contentHash: frame.contentHash,
    expectedOffsetX: Math.max(0, Math.round(frame.expectedOffsetX * scale)),
    expectedOffsetY: Math.round(frame.expectedOffsetY * scale),
    graphRevision: frame.graphRevision,
    height: Math.max(1, Math.round(frame.height * scale)),
    sourceIndex: frame.sourceIndex,
    width: Math.max(1, Math.round(frame.width * scale)),
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
  return parseComputationalMergePrivateRunReportCollection({
    ...collection,
    reports: await Promise.all(
      collection.reports.map(async (report) => {
        if (report.fixtureId !== FIXTURE_ID) return report;
        const previewExportParity = report.qualityMetrics.find((metric) => metric.name === 'previewExportMeanAbsDelta');
        if (previewExportParity === undefined) throw new Error('Missing panorama preview/export parity metric.');
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
            'Private RAW panorama preview/export artifacts replayed through typed app-server dry-run/apply, opened as an editable derived source, then received a normal tone/color edit while source RAW hashes remained unchanged; full browser E2E review and full-resolution quality acceptance remain tracked separately.',
          previewExportParity,
          runtimeResultIds: {
            apply: proof.applyRuntimeId,
            dryRun: proof.dryRunRuntimeId,
          },
          screenshotArtifacts: await Promise.all(
            REVIEW_ARTIFACTS.map(async ([label, path]) => ({
              hash: await sha256File(join(rootPath, path)),
              label,
              path,
              publicRepoAllowed: false,
            })),
          ),
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
  const rootPath = await mkdtemp(join(tmpdir(), 'rawengine-panorama-private-app-server-proof-'));
  try {
    await mkdir(join(rootPath, ARTIFACT_ROOT), { recursive: true });
    await writeFile(join(rootPath, SAMPLE_PATH), `${JSON.stringify(sampleRuntimeSample(), null, 2)}\n`);
    for (const [, path] of REVIEW_ARTIFACTS) {
      await writeFile(join(rootPath, path), 'png-placeholder');
    }
    for (const frame of sampleRuntimeSample().frames) {
      await mkdir(dirname(join(rootPath, frame.sourcePath)), { recursive: true });
      await writeFile(join(rootPath, frame.sourcePath), `fake-private-panorama-raw-${frame.sourceIndex}`);
    }
    await writeFile(
      join(rootPath, REPORT_PATH),
      `${JSON.stringify(await samplePrivateReportCollection(rootPath), null, 2)}\n`,
    );
    await runProof(rootPath);

    const upgraded = parseComputationalMergePrivateRunReportCollection(
      JSON.parse(await readFile(join(rootPath, REPORT_PATH), 'utf8')),
    );
    const report = upgraded.reports.find((candidate) => candidate.fixtureId === FIXTURE_ID);
    if (report?.acceptanceStatus !== 'runtime_apply_capable') {
      throw new Error('Expected self-test report to be upgraded to runtime_apply_capable.');
    }
    if (report.screenshotArtifacts.length !== REVIEW_ARTIFACTS.length) {
      throw new Error('Expected panorama self-test to attach review artifacts.');
    }
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }

  console.log('panorama real RAW private app-server proof self-test ok');
}

function sampleRuntimeSample(): z.infer<typeof runtimeSampleSchema> {
  return runtimeSampleSchema.parse({
    connectedSourceIndices: [0, 1, 2],
    fixtureId: FIXTURE_ID,
    frames: [0, 1, 2].map((sourceIndex) => ({
      contentHash: `sha256:panorama-private-${sourceIndex}`,
      expectedOffsetX: sourceIndex * 48,
      expectedOffsetY: sourceIndex % 2 === 0 ? 0 : 2,
      graphRevision: 'graph_rev_panorama_private_self_test',
      height: 48,
      sourceIndex,
      sourcePath: `private-fixtures/panorama/overlap-stitch-v1/frame-0${sourceIndex + 1}.arw`,
      width: 72,
    })),
    graphRevisionHash: `sha256:${'a'.repeat(64)}`,
  });
}

async function samplePrivateReportCollection(rootPath: string): Promise<ComputationalMergePrivateRunReportCollection> {
  const hash = `sha256:${'0'.repeat(64)}`;
  const asset = (path: string) => ({ hash, path, publicRepoAllowed: false });
  const source = async (path: string) => ({
    hash: await sha256File(join(rootPath, path)),
    localRelativePath: path,
    path,
    publicRepoAllowed: false,
  });
  const artifact = (kind: string, path: string) => ({ ...asset(path), kind });
  const previewExportParity = privateRawReportMetric('previewExportMeanAbsDelta', 0.015, 0);

  return parseComputationalMergePrivateRunReportCollection({
    $schema: 'https://rawengine.dev/schemas/computational-merge-private-run-reports-v1.json',
    issue: 1817,
    reports: [
      {
        acceptanceStatus: 'private_preview_export_smoke',
        artifacts: [
          artifact('source_raw_sequence_private', 'private-fixtures/panorama/overlap-stitch-v1'),
          artifact('decode_report_private', `${ARTIFACT_ROOT}/panorama-overlap-decode-report.json`),
          artifact('alignment_report_private', `${ARTIFACT_ROOT}/panorama-overlap-alignment.json`),
          artifact('merge_output_private', `${ARTIFACT_ROOT}/panorama-overlap-merge.tiff`),
          artifact('preview_after_private', `${ARTIFACT_ROOT}/panorama-overlap-preview.png`),
          artifact('export_after_private', `${ARTIFACT_ROOT}/panorama-overlap-export.tiff`),
          artifact('quality_report_private', `${ARTIFACT_ROOT}/panorama-overlap-quality.json`),
        ],
        featureFamily: 'panorama_stitch',
        fixtureId: FIXTURE_ID,
        generatedAt: '2026-06-18T00:00:00.000Z',
        graphRevisionHash: hash,
        implementationIssue: 4493,
        notes: 'sample private panorama preview/export report',
        qualityMetrics: [
          privateRawReportMetric('decodedSourceCount', 3, 3),
          privateRawReportMetric('decodedFinitePixelRatio', 1, 1),
          privateRawReportMetric('alignmentInlierRatio', 0.55, 0.65),
          privateRawReportMetric('panoramaStitchedSourceCount', 3, 3),
          previewExportParity,
        ],
        reportId: 'computational-merge-run.panorama-overlap.v1',
        screenshotArtifacts: [],
        sourceHashes: await Promise.all([
          source('private-fixtures/panorama/overlap-stitch-v1/frame-01.arw'),
          source('private-fixtures/panorama/overlap-stitch-v1/frame-02.arw'),
          source('private-fixtures/panorama/overlap-stitch-v1/frame-03.arw'),
        ]),
        uiIssue: 1333,
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
