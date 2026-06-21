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
const mixedAcquisitionReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: null,
  includedPathSet: new Set(['/roll/001.CR3', '/roll/proof.jpg', '/roll/source.unknown']),
  previewReady: false,
  targetPaths: ['/roll/001.CR3', '/roll/proof.jpg', '/roll/source.unknown'],
}).acquisitionHealth;
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

if (
  frameHealthReport.acquisitionHealth.severity !== 'ok' ||
  frameHealthReport.acquisitionHealth.tiffScanCount !== targetPaths.length ||
  frameHealthReport.acquisitionHealth.warningCodes.length !== 0
) {
  throw new Error('Negative Lab acquisition health did not classify TIFF scan workspace as ready.');
}

for (const warningCode of [
  'lossy_source_for_negative_lab',
  'mixed_source_families',
  'unknown_acquisition_state',
] as const) {
  if (!mixedAcquisitionReport.warningCodes.includes(warningCode)) {
    throw new Error(`Negative Lab acquisition health missing mixed-input warning: ${warningCode}`);
  }
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
  'negative-lab-selected-stock-readiness',
  'negative-lab-profile-comparison-matrix',
  "data-selected-profile-provenance-hash={selectedProfileProvenanceHash ?? ''}",
  'data-profile-provenance-hash={candidate.selectedProfileSnapshot.profileProvenanceHash}',
  'data-delta-summary={candidate.deltaSummary}',
  'setAcceptedBatchPlanJson(null);',
  'selectedProfile: selectedProfileSnapshot',
  'negative-lab-stock-readiness-profile',
  'negative-lab-stock-readiness-preview',
  'negative-lab-stock-readiness-export',
  'negative-lab-batch-workload-summary',
  'negative-lab-acquisition-health',
  'data-acquisition-severity={acquisitionHealth.severity}',
  'negative-lab-acquisition-severity',
  'negative-lab-acquisition-source-${sourceFamily}',
  'negative-lab-acquisition-warning-${warningCode}',
  'negative-lab-qc-proof-artifact',
  'data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}',
  'data-planned-apply-count={batchDryRunSummary.plannedApplyCount}',
  'data-review-count={dustScratchReviewReport.reviewCount}',
  'data-skipped-frame-count={batchDryRunSummary.skippedFrameIds.length}',
  'data-preview-ready={String(workspaceProof.previewReady)}',
  'data-export-ready={String(workspaceProof.exportReady)}',
  'data-profile-status={selectedProfile.profileStatus}',
  'data-runtime-status={selectedProfile.runtimeStatus}',
  'modals.negativeConversion.batchWorkloadSummary',
  'modals.negativeConversion.workflowExportBlocked',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab workspace UI marker missing: ${marker}`);
  }
}

console.log(`negative lab workspace ok (${proof.targetCount} frames, heuristic inspection + QC proof only)`);
