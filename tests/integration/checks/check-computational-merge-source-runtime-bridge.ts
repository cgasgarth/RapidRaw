#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { FocusStackAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/focus-stack/focusStackAppServerRuntime.ts';
import type { FocusStackRuntimePlanRequestV1 } from '../../../packages/rawengine-schema/src/focus-stack/focusStackRuntimePlan.ts';
import {
  buildFocusStackUiApplyCommandV1,
  buildFocusStackUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/focus-stack/focusStackUiControls.ts';
import { PanoramaAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/panoramaAppServerRuntime.ts';
import type { PanoramaRuntimePlanRequestV1 } from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import {
  buildPanoramaUiApplyCommandV1,
  buildPanoramaUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/panoramaUiControls.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { SuperResolutionAppServerRuntimeToolBusV1 } from '../../../packages/rawengine-schema/src/superResolutionAppServerRuntime.ts';
import type { SuperResolutionRuntimePlanRequestV1 } from '../../../packages/rawengine-schema/src/superResolutionRuntimePlan.ts';
import {
  buildSuperResolutionUiApplyCommandV1,
  buildSuperResolutionUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/superResolutionUiControls.ts';
import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import type { ComputationalMergePrivateSourceSet } from '../../../src/schemas/computationalMergeSourceSetSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';
import { buildComputationalMergePrivateSourceSets } from '../../../src/utils/computationalMergeSourceSets.ts';

const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const focusRoutePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');
const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
);
const collection = buildComputationalMergePrivateSourceSets(manifest, ledger);

let bridgeCount = 0;
for (const sourceSet of collection.sourceSets) {
  if (sourceSet.proofStatus !== 'manifest_only') {
    throw new Error(`${sourceSet.fixtureId}: source-runtime bridge expects manifest-only proof slots.`);
  }

  if (sourceSet.featureFamily === 'panorama_stitch') {
    runPanoramaBridge(sourceSet);
    bridgeCount += 1;
  } else if (sourceSet.featureFamily === 'focus_stack') {
    runFocusBridge(sourceSet);
    bridgeCount += 1;
  } else {
    runSuperResolutionBridge(sourceSet);
    bridgeCount += 1;
  }
}

console.log(`computational merge source runtime bridge ok (${bridgeCount} app-server bridges; not RAW decode/UI E2E)`);

function runPanoramaBridge(sourceSet: ComputationalMergePrivateSourceSet): void {
  const sourceFrames = sourceSet.sourceItems.map((item) => ({
    contentHash: `sha256:source-runtime-panorama-${item.sourceIndex}`,
    expectedOffsetX: item.sourceIndex * 48,
    expectedOffsetY: item.sourceIndex % 2,
    graphRevision: 'graph_rev_source_runtime_panorama_source',
    height: 48,
    sourceIndex: item.sourceIndex,
    width: 72,
  }));
  const controls = {
    blendMode: 'multi_band',
    boundaryMode: 'auto_crop',
    exposureMode: 'gain_compensation',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    outputName: 'Private Source Runtime Panorama',
    projection: 'cylindrical',
    qualityPreference: 'balanced',
    sources: toUiSources(sourceSet),
  };
  const dryRunCommand = buildPanoramaUiDryRunCommandV1(controls, contextFor(sourceSet, 'dry_run'));
  const bus = new PanoramaAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const dryRun = bus.execute({
    request: {
      command: dryRunCommand,
      connectedSourceIndices: sourceSet.sourceItems.map((item) => item.sourceIndex),
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
      seed: sourceSet.fixtureId,
      sourceFrames,
    } satisfies PanoramaRuntimePlanRequestV1,
    toolName: panoramaRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error(`${sourceSet.fixtureId}: expected panorama dry-run.`);

  const applyCommand = buildPanoramaUiApplyCommandV1(controls, {
    ...contextFor(sourceSet, 'apply'),
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    idempotencyKey: `${sourceSet.fixtureId}.apply`,
  });
  const applied = bus.execute({
    request: {
      command: applyCommand,
      connectedSourceIndices: sourceSet.sourceItems.map((item) => item.sourceIndex),
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
      seed: sourceSet.fixtureId,
      sourceFrames,
    } satisfies PanoramaRuntimePlanRequestV1,
    toolName: panoramaRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error(`${sourceSet.fixtureId}: expected panorama apply.`);
}

function runFocusBridge(sourceSet: ComputationalMergePrivateSourceSet): void {
  const width = 72;
  const height = 48;
  const frames = sourceSet.sourceItems.map((item) => ({
    contentHash: `sha256:source-runtime-focus-${item.sourceIndex}`,
    focusDistanceMm: 180 + item.sourceIndex * 60,
    graphRevision: 'graph_rev_source_runtime_focus_source',
    height,
    pixels: createFocusFrame(item.sourceIndex, width, height),
    sourceIndex: item.sourceIndex,
    translationX: 0,
    translationY: 0,
    width,
  }));
  const cells = sourceSet.sourceItems.map((item) => ({
    height,
    lowConfidence: false,
    sourceScores: sourceSet.sourceItems.map((scoreItem) => ({
      relativeConfidence: scoreItem.sourceIndex === item.sourceIndex ? 1 : 0.01,
      sourceIndex: scoreItem.sourceIndex,
    })),
    width: Math.floor(width / sourceSet.sourceItems.length),
    x: item.sourceIndex * Math.floor(width / sourceSet.sourceItems.length),
    y: 0,
  }));
  const controls = {
    alignmentMode: 'translation',
    blendMethod: 'weighted_sharpness',
    maxPreviewDimensionPx: 1200,
    outputName: 'Private Source Runtime Focus Stack',
    qualityPreference: 'best',
    retouchLayerPolicy: 'generate_retouch_layer',
    sources: toUiSources(sourceSet).map((source) => ({
      ...source,
      focusDistanceMm: 180 + source.sourceIndex * 60,
    })),
  };
  const dryRunCommand = buildFocusStackUiDryRunCommandV1(controls, contextFor(sourceSet, 'dry_run'));
  const bus = new FocusStackAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const dryRun = bus.execute({
    request: {
      cells,
      command: dryRunCommand,
      depthConfidenceArtifactId: `${sourceSet.fixtureId}.depth-confidence`,
      frames,
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
      retouchLayerArtifactId: `${sourceSet.fixtureId}.retouch`,
      sharpnessMapArtifactId: `${sourceSet.fixtureId}.sharpness`,
    } satisfies FocusStackRuntimePlanRequestV1,
    toolName: focusRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error(`${sourceSet.fixtureId}: expected focus dry-run.`);

  const applyCommand = buildFocusStackUiApplyCommandV1(controls, {
    ...contextFor(sourceSet, 'apply'),
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    idempotencyKey: `${sourceSet.fixtureId}.apply`,
  });
  const applied = bus.execute({
    request: {
      cells,
      command: applyCommand,
      depthConfidenceArtifactId: `${sourceSet.fixtureId}.depth-confidence`,
      frames,
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
      retouchLayerArtifactId: `${sourceSet.fixtureId}.retouch`,
      sharpnessMapArtifactId: `${sourceSet.fixtureId}.sharpness`,
    } satisfies FocusStackRuntimePlanRequestV1,
    toolName: focusRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error(`${sourceSet.fixtureId}: expected focus apply.`);
}

function runSuperResolutionBridge(sourceSet: ComputationalMergePrivateSourceSet): void {
  const lowWidth = 24;
  const lowHeight = 18;
  const scale = 2;
  const frames = sourceSet.sourceItems.map((item) => ({
    contentHash: `sha256:source-runtime-sr-${item.sourceIndex}`,
    graphRevision: 'graph_rev_source_runtime_sr_source',
    height: lowHeight,
    pixels: createSrFrame(item.sourceIndex, lowWidth, lowHeight),
    shiftX: item.sourceIndex % scale,
    shiftY: Math.floor(item.sourceIndex / scale) % scale,
    sourceIndex: item.sourceIndex,
    width: lowWidth,
  }));
  const controls = {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    outputName: 'Private Source Runtime Super Resolution',
    outputScale: scale,
    qualityPreference: 'best',
    sources: toUiSources(sourceSet),
  };
  const dryRunCommand = buildSuperResolutionUiDryRunCommandV1(controls, contextFor(sourceSet, 'dry_run'));
  const bus = new SuperResolutionAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
  const dryRun = bus.execute({
    request: {
      command: dryRunCommand,
      confidenceMapArtifactId: `${sourceSet.fixtureId}.confidence`,
      frames,
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
    } satisfies SuperResolutionRuntimePlanRequestV1,
    toolName: superResolutionRoutePair.dryRunToolName,
  });
  if (dryRun.kind !== 'dry_run') throw new Error(`${sourceSet.fixtureId}: expected SR dry-run.`);

  const applyCommand = buildSuperResolutionUiApplyCommandV1(controls, {
    ...contextFor(sourceSet, 'apply'),
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    idempotencyKey: `${sourceSet.fixtureId}.apply`,
  });
  const applied = bus.execute({
    request: {
      command: applyCommand,
      confidenceMapArtifactId: `${sourceSet.fixtureId}.confidence`,
      frames,
      outputArtifactId: `${sourceSet.fixtureId}.output`,
      previewArtifactId: `${sourceSet.fixtureId}.preview`,
    } satisfies SuperResolutionRuntimePlanRequestV1,
    toolName: superResolutionRoutePair.applyToolName,
  });
  if (applied.kind !== 'apply') throw new Error(`${sourceSet.fixtureId}: expected SR apply.`);
}

function toUiSources(sourceSet: ComputationalMergePrivateSourceSet) {
  return sourceSet.sourceItems.map((item) => ({
    colorSpaceHint: 'camera_rgb',
    imageId: `${sourceSet.fixtureId}.source.${item.sourceIndex}`,
    imagePath: item.localRelativePath,
    rawDefaultsApplied: true,
    sourceIndex: item.sourceIndex,
  }));
}

function contextFor(sourceSet: ComputationalMergePrivateSourceSet, stage: 'apply' | 'dry_run') {
  return {
    commandId: `${sourceSet.fixtureId}.${stage}`,
    correlationId: `${sourceSet.fixtureId}.correlation`,
    expectedGraphRevision: `${sourceSet.fixtureId}.graph`,
    targetId: `${sourceSet.fixtureId}.project`,
  };
}

function createFocusFrame(sourceIndex: number, width: number, height: number): Float32Array {
  const pixels = new Float32Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = ((index + sourceIndex * 17) % 53) / 52;
  }
  return pixels;
}

function createSrFrame(sourceIndex: number, width: number, height: number): Float32Array {
  const pixels = new Float32Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = ((index * 3 + sourceIndex * 11) % 71) / 70;
  }
  return pixels;
}
