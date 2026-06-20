import { readFileSync } from 'node:fs';

import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../src/utils/negativeLabDustScratchReview.ts';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';
import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  negativeLabWorkspaceProofSchema,
} from '../../../src/schemas/negativeLabWorkspaceSchemas.ts';

const targetPaths = [
  '/fixtures/negative-lab/synthetic-color-negative-001.tif',
  '/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif',
];

const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.91,
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const reviewReport = buildNegativeLabDustScratchReviewReport(frameHealthReport, true);
const qcProofReport = buildNegativeLabQcProofReport(reviewReport, true, true);
const proof = negativeLabWorkspaceProofSchema.parse({
  activeStage: 'inspection',
  exportReady: true,
  previewReady: true,
  queuedCount: frameHealthReport.queuedCount,
  reviewReport,
  schemaVersion: NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  targetCount: targetPaths.length,
});
const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');

if (proof.reviewReport.frames.length !== targetPaths.length) {
  throw new Error('Negative Lab workspace review did not cover every frame.');
}

if (!proof.reviewReport.frames.some((frame) => frame.findingCodes.includes('base_fog_only_review'))) {
  throw new Error('Negative Lab workspace review did not flag active-frame-only base sampling.');
}

if (proof.reviewReport.retouchCount !== 0) {
  throw new Error('Negative Lab workspace review must not claim pixel retouch findings from heuristic proof.');
}

if (
  qcProofReport.totalFrameCount !== proof.targetCount ||
  qcProofReport.contactSheetColumnCount !== targetPaths.length
) {
  throw new Error('Negative Lab QC proof report did not preserve contact-sheet frame coverage.');
}

if (qcProofReport.frames.some((frame) => frame.exportBlockedReason !== null)) {
  throw new Error('Negative Lab QC proof report blocked export-ready proof rows.');
}

for (const marker of [
  'negative-lab-workflow-readiness-strip',
  'data-preview-ready={String(workspaceProof.previewReady)}',
  'data-export-ready={String(workspaceProof.exportReady)}',
  'modals.negativeConversion.workflowExportBlocked',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab workspace UI marker missing: ${marker}`);
  }
}

console.log(`negative lab workspace ok (${proof.targetCount} frames, heuristic inspection + QC proof only)`);
