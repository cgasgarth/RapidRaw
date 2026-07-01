#!/usr/bin/env bun

import { z } from 'zod';

import { DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID } from '../../../../src/utils/negative-lab/negativeLabAcquisitionProfiles.ts';
import { buildNegativeLabBatchApplyReceipt } from '../../../../src/utils/negative-lab/negativeLabBatchApplyReceipt.ts';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../../src/utils/negative-lab/negativeLabDustScratchReview.ts';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
} from '../../../../src/utils/negative-lab/negativeLabFrameHealth.ts';
import { buildNegativeLabAcceptedPlanIdentity } from '../../../../src/utils/negative-lab/negativeLabPlanIdentity.ts';
import { buildNegativeLabQcContactSheetArtifact } from '../../../../src/utils/negative-lab/negativeLabQcContactSheetArtifact.ts';

const transcriptSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
    appliedPositiveCount: z.number().int().positive(),
    generatedArtifactIds: z.array(z.string().trim().min(1)).min(1),
    proofWarningCount: z.number().int().nonnegative(),
    queuedFrameCount: z.number().int().positive(),
    reviewFrameCount: z.number().int().nonnegative(),
    savedPaths: z.array(z.string().trim().min(1)).min(1),
    savedPositiveVariantIds: z.array(z.string().trim().min(1)).min(1),
    skippedFrameCount: z.number().int().nonnegative(),
  })
  .strict();

const targetPaths = [
  '/proof-roll/negative-lab/contact-sheet/frame-0001.tif',
  '/proof-roll/negative-lab/contact-sheet/frame-0002.tif',
  '/proof-roll/negative-lab/contact-sheet/frame-0003-positive.jpg',
];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.92,
  baseScope: 'roll',
  cropStatusByFrameId: {},
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const dryRunSummary = buildNegativeLabBatchDryRunSummary(frameHealthReport);
const qcReport = buildNegativeLabQcProofReport(
  buildNegativeLabDustScratchReviewReport(frameHealthReport, true),
  true,
  true,
);
const qcArtifact = buildNegativeLabQcContactSheetArtifact({
  qcDecisionByFrameId: {
    'negative-lab-frame-1': 'approved',
    'negative-lab-frame-2': 'approved',
    'negative-lab-frame-3': 'pending',
  },
  report: qcReport,
  sessionId: 'negative_lab_batch_apply_receipt_check',
  sourcePathsByFrameId: new Map(frameHealthReport.frames.map((frame) => [frame.frameId, frame.sourcePath] as const)),
});
const acceptedPlanIdentity = buildNegativeLabAcceptedPlanIdentity(JSON.stringify({ dryRunSummary }));
const dryApplyReceipt = buildNegativeLabBatchApplyReceipt({
  acceptedPlanIdentity,
  dryRunSummary,
  openInEditor: true,
  qcProofArtifact: qcArtifact,
});

if (dryApplyReceipt.savedPaths.length !== 0) {
  throw new Error('Dry batch apply receipt must not claim saved output paths before handoff.');
}
if (dryApplyReceipt.appliedPositiveCount !== dryRunSummary.affectedFrameIds.length) {
  throw new Error('Batch apply receipt must generate a positive for every affected frame.');
}
if (!dryApplyReceipt.acquisitionReviewFrameIds.includes('negative-lab-frame-3')) {
  throw new Error('Batch apply receipt must preserve acquisition review frame warnings.');
}

const savedPositiveHandoffs = dryApplyReceipt.appliedPositives.slice(0, 2).map((positive, index) => ({
  artifactId: `artifact_saved_${index + 1}`,
  conversionBundlePath: `/tmp/negative-lab-batch/${positive.frameId}.json`,
  dimensions: { height: 400, width: 600 },
  frameExposureOverrides: {},
  frameRgbBalanceOverrides: {},
  outputArtifactId: positive.generatedArtifactId,
  outputFormat: 'tiff16' as const,
  outputHash: `fnv1a64:${String(index + 1).padStart(16, '0')}`,
  outputPath: `/tmp/negative-lab-batch/${positive.frameId}-Positive.tif`,
  path: `/tmp/negative-lab-batch/${positive.frameId}-Positive.tif`,
  positiveVariantId: `positive_variant_${index + 1}`,
  profileProvenanceHash: null,
  replayPlanHash: acceptedPlanIdentity.acceptedDryRunPlanHash,
  selectedAcquisitionProfile: { profileId: DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID },
  selectedProfile: null,
  sidecarPath: `/tmp/negative-lab-batch/${positive.frameId}-Positive.json`,
  sourceImageRef: positive.sourcePath,
  sourcePath: positive.sourcePath,
}));
const savedReceipt = buildNegativeLabBatchApplyReceipt({
  acceptedPlanIdentity,
  activePositivePath: savedPositiveHandoffs[0]?.path ?? null,
  dryRunSummary,
  openInEditor: true,
  qcProofArtifact: qcArtifact,
  savedPositiveHandoffs,
});

if (savedReceipt.appliedPositives[0]?.savedPath !== savedPositiveHandoffs[0]?.path) {
  throw new Error('Batch apply receipt did not attach saved path to generated positive.');
}
if (savedReceipt.editorHandoff.activePositivePath !== savedPositiveHandoffs[0]?.path) {
  throw new Error('Batch apply receipt did not preserve editor handoff target.');
}
if (savedReceipt.reviewFrameCount !== dryRunSummary.reviewFrameIds.length) {
  throw new Error('Batch apply receipt review count drifted from dry-run summary.');
}

const transcript = transcriptSchema.parse({
  acceptedDryRunPlanHash: savedReceipt.acceptedDryRunPlanHash,
  acceptedDryRunPlanId: savedReceipt.acceptedDryRunPlanId,
  appliedPositiveCount: savedReceipt.appliedPositiveCount,
  generatedArtifactIds: savedReceipt.appliedPositives.map((positive) => positive.generatedArtifactId),
  proofWarningCount: savedReceipt.proofWarningCount,
  queuedFrameCount: savedReceipt.queuedFrameCount,
  reviewFrameCount: savedReceipt.reviewFrameCount,
  savedPaths: savedReceipt.savedPaths,
  savedPositiveVariantIds: savedReceipt.savedPositiveVariantIds,
  skippedFrameCount: savedReceipt.skippedFrameCount,
});

console.log(JSON.stringify(transcript));
