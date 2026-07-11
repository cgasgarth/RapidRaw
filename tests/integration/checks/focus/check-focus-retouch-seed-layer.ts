#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { FocusStackAppServerRuntimeToolBusV1 } from '../../../../packages/rawengine-schema/src/focus-stack/focusStackAppServerRuntime.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleComputationalMergeAppServerToolManifestV1 } from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';
import type { FocusStackUiSettings } from '../../../../src/schemas/focus-stack/focusStackUiSchemas.ts';
import {
  buildFocusStackDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../../src/utils/derivedOutputReceipt.ts';
import { buildFocusStackOutputReviewFromArtifact } from '../../../../src/utils/focusStackOutputReview.ts';
import { buildReopenedDerivedOutputReceipt } from '../../../../src/utils/hdrDerivedSourceReopen.ts';

const nativeReview = readFileSync('src-tauri/src/merge/focus_stack/review.rs', 'utf8');
for (const token of [
  'low_margin',
  'occlusion_risk',
  'alignment_risk',
  'invalid_owner',
  'halo_overshoot',
  'alternate_sources',
  'mask_hash',
]) {
  if (!nativeReview.includes(token)) throw new Error(`Native measured retouch seed is missing ${token}`);
}

const focusRoutePair = {
  applyToolName: 'computationalmerge.focus_stack.apply_command',
  dryRunToolName: 'computationalmerge.focus_stack.dry_run_command',
};

const WIDTH = 72;
const HEIGHT = 48;
const sourceRegions = [
  { height: HEIGHT, sourceIndex: 0, width: 24, x: 0, y: 0 },
  { height: HEIGHT, sourceIndex: 1, width: 24, x: 24, y: 0 },
  { height: HEIGHT, sourceIndex: 2, width: 24, x: 48, y: 0 },
];
const frames = [0, 1, 2].map((sourceIndex) => ({
  contentHash: `sha256:focus-retouch-seed-${sourceIndex}`,
  focusDistanceMm: 180 + sourceIndex * 60,
  graphRevision: 'graph_rev_focus_retouch_seed_source',
  height: HEIGHT,
  pixels: createFocusFrame(sourceIndex),
  sourceIndex,
  translationX: 0,
  translationY: 0,
  width: WIDTH,
}));
const cells = sourceRegions.map((region) => ({
  height: region.height,
  lowConfidence: region.sourceIndex === 1,
  sourceScores: [0, 1, 2].map((sourceIndex) => ({
    relativeConfidence: sourceIndex === region.sourceIndex ? 1 : region.sourceIndex === 1 ? 0.84 : 0.01,
    sourceIndex,
  })),
  width: region.width,
  x: region.x,
  y: region.y,
}));

const controls = {
  alignmentMode: 'translation',
  blendMethod: 'weighted_sharpness',
  haloSuppressionStrengthPercent: 80,
  maxPreviewDimensionPx: 1200,
  memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
  outputName: 'Synthetic Focus Retouch Seed Stack',
  qualityPreference: 'best',
  retouchLayerPolicy: 'generate_retouch_layer',
  sources: frames.map((frame) => ({
    colorSpaceHint: 'camera_rgb',
    focusDistanceMm: frame.focusDistanceMm,
    imageId: `img_focus_retouch_seed_${frame.sourceIndex}`,
    imagePath: `/synthetic/focus/retouch-seed-${frame.sourceIndex}.dng`,
    rawDefaultsApplied: true,
    role: 'focus_slice',
    sourceIndex: frame.sourceIndex,
  })),
};
const uiSettings = {
  alignmentMode: 'translation',
  blendMethod: 'weighted_sharpness',
  haloSuppressionStrengthPercent: 80,
  maxPreviewDimensionPx: 1200,
  qualityPreference: 'best',
  reviewOverlayMode: 'halo_risk',
  reviewOverlayOpacityPercent: 70,
  retouchLayerPolicy: 'generate_retouch_layer',
  sourceMode: 'focus_bracket',
} satisfies FocusStackUiSettings;

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Focus stack retouch seed runtime smoke validates deterministic seed provenance.',
    state: 'not_required',
  },
  commandId: 'command_focus_retouch_seed_dry_run',
  commandType: 'computationalMerge.createFocusStack',
  correlationId: 'corr_focus_retouch_seed',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_focus_retouch_seed',
  parameters: controls,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_focus_retouch_seed', kind: 'project' },
};

const bus = new FocusStackAppServerRuntimeToolBusV1(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = bus.execute({
  request: buildRequest(dryRunCommand),
  toolName: focusRoutePair.dryRunToolName,
});
if (dryRun.kind !== 'dry_run') throw new Error('Expected focus retouch seed dry-run result.');

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Focus stack retouch seed runtime smoke applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_focus_retouch_seed_apply',
  correlationId: 'corr_focus_retouch_seed_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = bus.execute({
  request: buildRequest(applyCommand),
  toolName: focusRoutePair.applyToolName,
});
if (applied.kind !== 'apply') throw new Error('Expected focus retouch seed apply result.');
if (applied.apply.sidecarArtifact.retouchSeed?.availability !== 'available') {
  throw new Error('Expected focus retouch seed artifact to be available.');
}
if (applied.apply.sidecarArtifact.retouchSeed?.staleState !== 'current') {
  throw new Error('Expected focus retouch seed artifact to be current.');
}
if ((applied.apply.sidecarArtifact.retouchSeed?.maskRegions.length ?? 0) === 0) {
  throw new Error('Expected focus retouch seed artifact to include mask regions.');
}
if ((applied.apply.sidecarArtifact.retouchSeed?.sourceCandidates.length ?? 0) === 0) {
  throw new Error('Expected focus retouch seed artifact to include source candidates.');
}
if (!applied.apply.sidecarArtifact.retouchSeed?.reasonCodes.includes('low_confidence')) {
  throw new Error('Expected focus retouch seed artifact to record the low-confidence reason.');
}

const acceptedArtifact = {
  ...applied.apply.sidecarArtifact,
  haloReview: {
    ...applied.apply.sidecarArtifact.haloReview,
    editableHandoffStatus: 'ready',
    reviewStatus: 'apply_ready',
  },
};
const outputReview = buildFocusStackOutputReviewFromArtifact(acceptedArtifact);
if (outputReview.retouchSeed?.acceptedDryRunPlanId !== dryRun.dryRun.dryRunResult.mergePlan.planId) {
  throw new Error('Expected focus retouch seed review to preserve the accepted plan id.');
}

const derivedReceipt = buildFocusStackDerivedOutputReceipt({
  acceptedDryRunPlanHash: applied.apply.provenance.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: applied.apply.provenance.acceptedDryRunPlanId,
  review: outputReview,
  settings: uiSettings,
});
if (derivedReceipt.focusStack?.retouchSeed.availability !== 'available') {
  throw new Error('Expected focus retouch seed derived receipt to expose availability.');
}
if (derivedReceipt.focusStack?.retouchSeed.staleState !== 'current') {
  throw new Error('Expected focus retouch seed derived receipt to expose current seed state.');
}

const reopenedReceipt = buildReopenedDerivedOutputReceipt({
  imagePath: derivedReceipt.outputPath ?? outputReview.artifactPath,
  metadata: {
    rawEngineArtifacts: {
      derivedOutputProvenanceSidecars: [derivedReceipt.provenanceSidecar],
      focusStackArtifacts: [acceptedArtifact],
      schemaVersion: 1,
    },
  },
});
if (reopenedReceipt === null) throw new Error('Expected focus retouch seed reopen to reconstruct a receipt.');
if (
  reopenedReceipt.focusStack?.retouchSeed.acceptedDryRunPlanId !==
  derivedReceipt.focusStack?.retouchSeed.acceptedDryRunPlanId
) {
  throw new Error('Expected focus retouch seed reopen to preserve accepted plan id.');
}

const staleReceipt = deriveDerivedOutputReceiptState({
  current: {
    ...reopenedReceipt,
    sourceContentHashes: reopenedReceipt.sourceContentHashes.map((hash, index) =>
      index === 0 ? 'sha256:focus-retouch-seed-source-changed' : hash,
    ),
  },
  receipt: reopenedReceipt,
});
if (staleReceipt.staleState !== 'stale' || !staleReceipt.staleReasons?.includes('source_content_hash_changed')) {
  throw new Error('Expected focus retouch seed receipt to go stale when source content changes.');
}

const result = {
  acceptedPlanId: derivedReceipt.focusStack?.retouchSeed.acceptedDryRunPlanId,
  maskRegionCount: derivedReceipt.focusStack?.retouchSeed.maskRegions.length,
  outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.apply.outputPixels.buffer)).digest('hex'),
  previewHash: derivedReceipt.focusStack?.retouchSeed.previewContentHash,
};
console.log(`focus retouch seed layer ok (${result.acceptedPlanId})`);

function buildRequest(command) {
  return {
    cells,
    command,
    depthConfidenceArtifactId: 'artifact_focus_retouch_seed_depth_confidence',
    frames,
    haloMapArtifactId: 'artifact_focus_retouch_seed_halo_map',
    outputArtifactId: 'artifact_focus_retouch_seed_output',
    previewArtifactId: 'artifact_focus_retouch_seed_preview',
    retouchLayerArtifactId: 'artifact_focus_retouch_seed_retouch',
    sharpnessMapArtifactId: 'artifact_focus_retouch_seed_sharpness',
  };
}

function createFocusFrame(sourceIndex) {
  const pixels = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const localPattern = ((x * 7 + y * 11 + sourceIndex * 19) % 31) / 255;
      const sourceRegion = sourceRegions.find((region) => x >= region.x && x < region.x + region.width);
      const focusBoost = sourceRegion?.sourceIndex === sourceIndex ? 0.72 : 0.08;
      pixels[y * WIDTH + x] = Math.min(1, 0.12 + localPattern + focusBoost);
    }
  }
  return pixels;
}
