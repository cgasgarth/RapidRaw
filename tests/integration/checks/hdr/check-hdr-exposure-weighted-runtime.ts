#!/usr/bin/env bun

import { HdrAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/hdr/hdrAppServerRuntime.ts';
import {
  ApprovalClass,
  hdrRuntimeSidecarReceiptV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';

const WIDTH = 48;
const HEIGHT = 36;
const CLIP_THRESHOLD = 0.99;
const SENSOR_WHITE_RADIANCE = 1;
const BRACKETS = [
  { exposureEv: -2, shiftX: 1, shiftY: -1, sourceIndex: 0 },
  { exposureEv: 0, shiftX: 0, shiftY: 0, sourceIndex: 1 },
  { exposureEv: 2, shiftX: -2, shiftY: 1, sourceIndex: 2 },
];

const scene = createScene(WIDTH, HEIGHT);
const frames = BRACKETS.map((bracket) => ({
  contentHash: `sha256:hdr-exposure-weighted-source-${bracket.sourceIndex}`,
  exposureEv: bracket.exposureEv,
  graphRevision: 'graph_rev_hdr_exposure_weighted_source',
  height: HEIGHT,
  pixels: shift(renderBracket(scene, bracket.exposureEv), WIDTH, HEIGHT, bracket.shiftX, bracket.shiftY),
  sourceIndex: bracket.sourceIndex,
  width: WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'HDR runtime check validates accepted plan identity.',
    state: 'not_required',
  },
  commandId: 'command_hdr_exposure_weighted_runtime',
  commandType: 'computationalMerge.createHdr',
  correlationId: 'corr_hdr_exposure_weighted_runtime',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_hdr_exposure_weighted_runtime',
  parameters: {
    alignmentMode: 'translation',
    bracketValidation: 'required',
    deghosting: 'medium',
    deghostConfidenceMapVisible: false,
    deghostRegionIntensityPercent: 65,
    maxPreviewDimensionPx: 1200,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Deterministic Exposure Weighted HDR',
    qualityPreference: 'balanced',
    sources: BRACKETS.map((bracket) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: bracket.exposureEv,
      imageId: `img_hdr_exposure_weighted_${bracket.sourceIndex}`,
      imagePath: `/public-fixtures/hdr/exposure-weighted-${bracket.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex: bracket.sourceIndex,
    })),
    toneMapPreview: true,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_hdr_exposure_weighted_runtime', kind: 'project' },
} as const;

const bus = new HdrAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: 'computationalmerge.hdr.dry_run_command',
});

if (dryRun.kind !== 'dry_run') {
  throw new Error('HDR runtime dry-run must produce a dry-run result.');
}
if (dryRun.dryRun.dryRunResult.mergePlan.planId !== `hdr_plan_${dryRunCommand.commandId}`) {
  throw new Error('HDR dry-run plan id must be derived from the command id.');
}

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'HDR runtime check applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_hdr_exposure_weighted_runtime_apply',
  correlationId: 'corr_hdr_exposure_weighted_runtime_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: 'computationalmerge.hdr.apply_command',
});
if (applied.kind !== 'apply') {
  throw new Error('HDR runtime apply must produce an apply result.');
}

const runtimeReceipt = hdrRuntimeSidecarReceiptV1Schema.parse(applied.apply.sidecarArtifact.runtimeSidecarReceipt);
if (runtimeReceipt.acceptedDryRunPlanHash !== dryRun.acceptedDryRunPlanHash) {
  throw new Error('HDR runtime receipt must record the accepted dry-run plan hash.');
}
if (runtimeReceipt.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
  throw new Error('HDR runtime receipt must record the accepted dry-run plan id.');
}
if (runtimeReceipt.mergeMethod !== 'exposure_weighted_radiance') {
  throw new Error(`HDR runtime receipt must record the merge method, got ${runtimeReceipt.mergeMethod}.`);
}
if (runtimeReceipt.mergeVersion !== '0.1.0') {
  throw new Error(`HDR runtime receipt must record the merge version, got ${runtimeReceipt.mergeVersion}.`);
}
if (
  !runtimeReceipt.warningCodes?.includes('legacy_full_frame_render') ||
  !runtimeReceipt.warningCodes.includes('motion_detected') ||
  !runtimeReceipt.warningCodes.includes('alignment_low_confidence')
) {
  throw new Error(`HDR runtime receipt must preserve runtime warnings: ${runtimeReceipt.warningCodes?.join(',')}.`);
}
if (runtimeReceipt.output.contentHash !== applied.apply.mutationResult.outputArtifacts[0]?.contentHash) {
  throw new Error('HDR runtime receipt output hash must match the applied output artifact.');
}
if (runtimeReceipt.output.dimensions.width !== WIDTH || runtimeReceipt.output.dimensions.height !== HEIGHT) {
  throw new Error('HDR runtime receipt must record the output dimensions.');
}
if (runtimeReceipt.bracket.sourceRoles.length !== BRACKETS.length) {
  throw new Error('HDR runtime receipt must record all source roles.');
}
if (runtimeReceipt.bracket.sourceRoles[1]?.role !== 'reference') {
  throw new Error('HDR runtime receipt must identify the middle bracket as the reference.');
}

const outputHash = applied.apply.mutationResult.outputArtifacts[0]?.contentHash;
if (outputHash === undefined) {
  throw new Error('HDR apply must produce an output artifact hash.');
}
const sourceHashes = frames.map((frame) => hashHdrRuntimePixels(frame.pixels));
if (outputHash === sourceHashes[0] || outputHash === sourceHashes[1] || outputHash === sourceHashes[2]) {
  throw new Error('HDR weighted output hash must differ from every source bracket hash.');
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanHash: runtimeReceipt.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: runtimeReceipt.acceptedDryRunPlanId,
      outputHash,
      sourceHashes,
      warningCodes: runtimeReceipt.warningCodes,
    },
    null,
    2,
  ),
);

function createScene(width: number, height: number): Float64Array {
  const pixels = new Float64Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.08 + (x / (width - 1)) * 1.7;
      const windowHighlight = isInsideRectangle(x, y, 22, 6, 12, 14) ? 2.15 : 0;
      const lampHighlight = isInsideCircle(x, y, 14, 27, 5) ? 1.1 : 0;
      const shadowDetail = isInsideRectangle(x, y, 4, 5, 12, 11) ? 0.06 : 0;
      pixels[getPixelIndex(x, y, width)] = gradient + windowHighlight + lampHighlight + shadowDetail;
    }
  }

  return pixels;
}

function buildRequest(command: unknown) {
  return {
    clipThreshold: CLIP_THRESHOLD,
    command,
    frames,
    motionThreshold: 0.22,
    outputArtifactId: 'artifact_hdr_exposure_weighted_runtime_output',
    previewArtifactId: 'artifact_hdr_exposure_weighted_runtime_preview',
    searchRadiusPx: 5,
    sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
    syntheticScenePixels: scene,
  };
}

function renderBracket(scenePixels: Float64Array, exposureEv: number): Float64Array {
  const scale = 2 ** exposureEv;
  const capture = new Float64Array(scenePixels.length);

  for (let index = 0; index < scenePixels.length; index += 1) {
    capture[index] = Math.min(1, Math.max(0, (scenePixels[index] ?? 0) * scale));
  }

  return capture;
}

function shift(pixels: Float64Array, width: number, height: number, shiftX: number, shiftY: number): Float64Array {
  const shifted = new Float64Array(pixels.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (!isInsideImage(sourceX, sourceY, width, height)) continue;
      shifted[getPixelIndex(x, y, width)] = pixels[getPixelIndex(sourceX, sourceY, width)] ?? 0;
    }
  }

  return shifted;
}

function hashHdrRuntimePixels(pixels: Float64Array): string {
  let value = 2166136261;
  for (const pixel of pixels) {
    value ^= Math.round(pixel * 1_000_000);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return `sha256:${value.toString(16).padStart(8, '0')}`;
}

function isInsideImage(x: number, y: number, width: number, height: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;
}

function isInsideCircle(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  return (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY) <= radius * radius;
}

function isInsideRectangle(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function getPixelIndex(x: number, y: number, width: number): number {
  return y * width + x;
}
