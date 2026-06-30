#!/usr/bin/env bun

import { createHash } from 'node:crypto';

import {
  ApprovalClass,
  computationalMergeCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  applySuperResolutionRuntimePlanV1,
  buildSuperResolutionRuntimeDryRunV1,
} from '../../../packages/rawengine-schema/src/super-resolution/superResolutionRuntimePlan.ts';
import {
  buildSuperResolutionArtifactSidecarRecordV1,
  markSuperResolutionArtifactHumanReviewPassed,
  markSuperResolutionArtifactStaleState,
} from '../../../packages/rawengine-schema/src/super-resolution/superResolutionSidecarProvenance.ts';
import { buildSuperResolutionOutputReviewFromArtifact } from '../../../src/utils/superResolutionOutputReview.ts';

const SCALE = 2;
const LOW_WIDTH = 16;
const LOW_HEIGHT = 12;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;
const REVIEWED_AT = '2026-06-21T13:30:00.000Z';

const truth = createTruth();
const frames = [
  { shiftX: 0, shiftY: 0, sourceIndex: 0 },
  { shiftX: 1, shiftY: 0, sourceIndex: 1 },
  { shiftX: 0, shiftY: 1, sourceIndex: 2 },
  { shiftX: 1, shiftY: 1, sourceIndex: 3 },
].map((frame) => ({
  contentHash: `sha256:sr-human-review-source-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_human_review_source',
  height: LOW_HEIGHT,
  pixels: downsample(truth, frame.shiftX, frame.shiftY),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Super-resolution human review handoff check validates dry-run planning.',
    state: 'not_required',
  },
  commandId: 'command_sr_human_review_handoff',
  commandType: 'computationalMerge.createSuperResolution',
  correlationId: 'corr_sr_human_review_handoff',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_sr_human_review_handoff',
  parameters: {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    mode: 'multi_image',
    outputName: 'Synthetic Human Review SR',
    outputScale: SCALE,
    qualityPreference: 'best',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_human_review_${frame.sourceIndex}`,
      imagePath: `/synthetic/sr/human-review-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'sr_frame',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_sr_human_review_handoff', kind: 'project' },
};

const dryRun = buildSuperResolutionRuntimeDryRunV1({
  command: dryRunCommand,
  confidenceMapArtifactId: 'artifact_sr_human_review_confidence',
  frames,
  outputArtifactId: 'artifact_sr_human_review_output',
  previewArtifactId: 'artifact_sr_human_review_preview',
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Super-resolution human review handoff check applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_sr_human_review_handoff_apply',
  correlationId: 'corr_sr_human_review_handoff_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applySuperResolutionRuntimePlanV1({
  command: applyCommand,
  confidenceMapArtifactId: 'artifact_sr_human_review_confidence',
  frames,
  outputArtifactId: 'artifact_sr_human_review_output',
  previewArtifactId: 'artifact_sr_human_review_preview',
});
const parsedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse(applyCommand);
if (parsedApplyCommand.commandType !== 'computationalMerge.createSuperResolution') {
  throw new Error('Expected parsed SR apply command.');
}
const outputArtifact = applied.mutationResult.outputArtifacts.find((artifact) => artifact.kind === 'merge_output');
if (outputArtifact === undefined) throw new Error('Expected SR output artifact.');

const artifact = buildSuperResolutionArtifactSidecarRecordV1({
  command: parsedApplyCommand,
  createdAt: REVIEWED_AT,
  outputArtifact,
  previewArtifacts: [],
  provenance: applied.provenance,
  warningCodes: ['human_review_required'],
});
const pendingReview = buildSuperResolutionOutputReviewFromArtifact(artifact);
if (pendingReview.editableGate !== 'blocked_review_required') {
  throw new Error(`Pending human review must block editable handoff, got ${pendingReview.editableGate}.`);
}

const reviewedArtifact = markSuperResolutionArtifactHumanReviewPassed(artifact, REVIEWED_AT);
const reviewedOutputReview = buildSuperResolutionOutputReviewFromArtifact(reviewedArtifact);
if (reviewedOutputReview.editableGate !== 'ready') {
  throw new Error(`Passed human review must unlock editable handoff, got ${reviewedOutputReview.editableGate}.`);
}
if (reviewedOutputReview.humanReviewStatus !== 'passed') {
  throw new Error(`Passed human review status was not preserved, got ${reviewedOutputReview.humanReviewStatus}.`);
}
if (reviewedOutputReview.warningCodes.includes('human_review_required')) {
  throw new Error('Passed human review must clear the human-review-required warning.');
}
if (reviewedOutputReview.reviewArtifacts.length !== pendingReview.reviewArtifacts.length) {
  throw new Error('Passed human review must preserve SR review artifact metadata.');
}

const staleArtifact = markSuperResolutionArtifactStaleState(
  reviewedArtifact,
  {
    detailPolicy: reviewedArtifact.detailPolicy,
    engine: reviewedArtifact.engine,
    outputContentHash: 'sha256:changed-output',
    requestedAlignmentMode: reviewedArtifact.requestedAlignmentMode,
    requestedOutputScale: reviewedArtifact.requestedOutputScale,
    resolvedAlignmentMode: reviewedArtifact.resolvedAlignmentMode,
    sourceState: reviewedArtifact.sourceState,
  },
  REVIEWED_AT,
);
const staleReview = buildSuperResolutionOutputReviewFromArtifact(staleArtifact);
if (staleReview.editableGate !== 'blocked_stale') {
  throw new Error(`Stale reviewed artifact must block editable handoff, got ${staleReview.editableGate}.`);
}

const proof = {
  editableGateAfterReview: reviewedOutputReview.editableGate,
  outputHash: reviewedOutputReview.outputArtifactHash,
  outputPixelHash: `sha256:${createHash('sha256').update(new Uint8Array(applied.outputPixels.buffer)).digest('hex')}`,
  staleGateAfterInvalidation: staleReview.editableGate,
};

console.log(
  `sr human review editable handoff ok (${proof.editableGateAfterReview}, ${proof.staleGateAfterInvalidation})`,
);

function createTruth(): Float32Array {
  const pixels = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
  for (let y = 0; y < HIGH_HEIGHT; y += 1) {
    for (let x = 0; x < HIGH_WIDTH; x += 1) {
      pixels[y * HIGH_WIDTH + x] = Math.max(0, Math.min(1, x / (HIGH_WIDTH * 2) + (y % 5) / 10));
    }
  }
  return pixels;
}

function downsample(truthPixels: Float32Array, shiftX: number, shiftY: number): Float32Array {
  const pixels = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      pixels[y * LOW_WIDTH + x] = truthPixels[(y * SCALE + shiftY) * HIGH_WIDTH + x * SCALE + shiftX] ?? 0;
    }
  }
  return pixels;
}
