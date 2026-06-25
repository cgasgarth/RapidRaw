import { readFileSync } from 'node:fs';

import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../src/utils/negativeLabDustScratchReview.ts';
import { buildDustCandidateHealLayer } from '../../../src/utils/dustCandidateHealLayer.ts';
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
  baseFogConfidence: 0.91,
  baseScope: 'roll',
  includedPathSet: new Set(['/roll/001.CR3', '/roll/proof.jpg', '/roll/source.unknown']),
  previewReady: true,
  targetPaths: ['/roll/001.CR3', '/roll/proof.jpg', '/roll/source.unknown'],
});
const basePendingReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: null,
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const reviewReport = buildNegativeLabDustScratchReviewReport(frameHealthReport, true);
const mixedReviewReport = buildNegativeLabDustScratchReviewReport(mixedAcquisitionReport, true);
const basePendingReviewReport = buildNegativeLabDustScratchReviewReport(basePendingReport, true);
const qcProofReport = buildNegativeLabQcProofReport(reviewReport, true, true);
const basePendingQcProofReport = buildNegativeLabQcProofReport(basePendingReviewReport, true, false);
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
const firstReviewFrame = mixedReviewReport.frames.find((frame) =>
  frame.candidates.some((candidate) => candidate.kind === 'dust_spot'),
);
const firstDustCandidate = firstReviewFrame?.candidates.find((candidate) => candidate.kind === 'dust_spot');
const firstScratchCandidate = firstReviewFrame?.candidates.find((candidate) => candidate.kind === 'emulsion_scratch');

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
  'lab_processed_input_for_negative_lab',
  'lossy_source_for_negative_lab',
  'mixed_source_families',
  'unknown_acquisition_state',
] as const) {
  if (!mixedAcquisitionReport.acquisitionHealth.warningCodes.includes(warningCode)) {
    throw new Error(`Negative Lab acquisition health missing mixed-input warning: ${warningCode}`);
  }
}

if (
  mixedAcquisitionReport.frames.filter((frame) => frame.batchDisposition === 'review').length !== 2 ||
  !mixedReviewReport.frames.some((frame) => frame.findingCodes.includes('acquisition_review_required'))
) {
  throw new Error('Negative Lab acquisition warnings did not become actionable review dispositions.');
}

if (!proof.reviewReport.frames.some((frame) => frame.findingCodes.includes('base_fog_only_review'))) {
  throw new Error('Negative Lab workspace review did not flag active-frame-only base sampling.');
}

if (proof.reviewReport.retouchCount !== 0) {
  throw new Error('Negative Lab workspace review should keep candidate findings in review until acknowledged.');
}

if (
  !proof.reviewReport.frames.some((frame) => frame.candidates.some((candidate) => candidate.status === 'acknowledged'))
) {
  throw new Error('Negative Lab workspace review did not persist acknowledged dust/scratch candidate state.');
}

if (!mixedReviewReport.frames.some((frame) => frame.candidates.some((candidate) => candidate.status === 'pending'))) {
  throw new Error('Negative Lab workspace review did not expose pending dust/scratch candidate overlays.');
}

if (firstReviewFrame === undefined || firstDustCandidate === undefined || firstScratchCandidate === undefined) {
  throw new Error('Negative Lab workspace review did not expose dust and scratch candidates for retouch handoff.');
}

const dustHealLayer = buildDustCandidateHealLayer({
  candidate: firstDustCandidate,
  frameId: firstReviewFrame.frameId,
  imageHeight: 800,
  imageWidth: 1000,
  layerId: 'test_dust_heal_layer',
  targetSubMaskId: 'test_dust_target',
});
const dustHealSource = dustHealLayer.retouchCloneSource;
const dustHealProvenance = dustHealSource?.candidateProvenance;

if (
  dustHealSource?.retouchMode !== 'heal' ||
  dustHealProvenance === undefined ||
  dustHealProvenance.candidateId !== firstDustCandidate.candidateId ||
  dustHealProvenance.confidence !== firstDustCandidate.confidence ||
  dustHealSource.sourcePoint.x === dustHealSource.targetPoint.x ||
  dustHealLayer.subMasks[0]?.type !== 'radial'
) {
  throw new Error('Negative Lab dust candidate did not become an editable heal layer handoff.');
}

const edgeDustHealLayer = buildDustCandidateHealLayer({
  candidate: {
    ...firstDustCandidate,
    candidateId: 'edge_dust_candidate',
    geometry: {
      height: 0.02,
      width: 0.02,
      x: 0.985,
      y: firstDustCandidate.geometry.y,
    },
  },
  frameId: firstReviewFrame.frameId,
  imageHeight: 800,
  imageWidth: 1000,
});
const edgeDustHealSource = edgeDustHealLayer.retouchCloneSource;
if (
  edgeDustHealSource === undefined ||
  edgeDustHealSource.sourcePoint.x >= edgeDustHealSource.targetPoint.x ||
  edgeDustHealSource.sourcePoint.x === edgeDustHealSource.targetPoint.x
) {
  throw new Error('Negative Lab edge dust candidate did not choose a distinct in-bounds heal source.');
}

try {
  buildDustCandidateHealLayer({
    candidate: firstScratchCandidate,
    frameId: firstReviewFrame.frameId,
    imageHeight: 800,
    imageWidth: 1000,
  });
  throw new Error('Negative Lab scratch candidates should stay review-only in the dust heal handoff slice.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('dust spot candidates')) {
    throw error;
  }
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

if (basePendingQcProofReport.exportReady) {
  throw new Error('Negative Lab QC proof report did not block base-pending export.');
}

for (const marker of [
  'negative-lab-workflow-readiness-strip',
  'negative-lab-selected-stock-readiness',
  'negative-lab-profile-comparison-matrix',
  'negative-lab-profile-comparison-preview-${profile.presetId}',
  'data-comparison-preview={candidate.previewSwatch.deltaCss}',
  'data-preview-tone-bias={candidate.previewSwatch.toneBias}',
  "data-selected-profile-provenance-hash={selectedProfileProvenanceHash ?? ''}",
  'data-profile-provenance-hash={candidate.selectedProfileSnapshot.profileProvenanceHash}',
  'data-delta-summary={candidate.deltaSummary}',
  'setAcceptedBatchPlanJson(null);',
  'selectedProfile: selectedProfileSnapshot',
  'writeConversionBundle',
  'negative-lab-export-conversion-bundle',
  'negative-lab-export-summary-bundle',
  'acquisitionSourceFamilies: frameHealthReport.acquisitionHealth.sourceFamilies',
  'acquisitionWarningCodes: frameHealthReport.acquisitionHealth.warningCodes',
  'selectedAcquisitionProfile',
  'negative-lab-acquisition-profile',
  'data-input-transform={selectedAcquisitionProfile.inputTransform}',
  'negative-lab-stock-readiness-profile',
  'negative-lab-stock-readiness-preview',
  'negative-lab-stock-readiness-export',
  'negative-lab-batch-workload-summary',
  'negative-lab-import-export-walkthrough',
  'negative-lab-walkthrough-status',
  'negative-lab-walkthrough-${row.id}',
  "id: 'setup'",
  "id: 'profile'",
  "id: 'inversion'",
  "id: 'qc'",
  "id: 'handoff'",
  "id: 'export'",
  'negative-lab-walkthrough-proof-boundary',
  'data-ready={String(walkthroughClosureReady)}',
  'data-qc-export-ready={String(qcProofReport.exportReady)}',
  'data-handoff-ready={String(activePositiveVariant !== null)}',
  'walkthroughClosureProofBoundary',
  'negative-lab-acquisition-health',
  'data-acquisition-severity={acquisitionHealth.severity}',
  'negative-lab-acquisition-severity',
  'acquisitionHealthLimit',
  'negative-lab-acquisition-source-${sourceFamily}',
  'negative-lab-acquisition-warning-${warningCode}',
  'acquisitionWarningLabProcessed',
  'negative-lab-scan-input-guidance',
  'data-preflight-basis="path_extension_only"',
  'scanInputGuidancePreferred',
  'scanInputGuidanceAvoidPositive',
  'scanInputGuidanceAvoidProofs',
  'negative-lab-dust-candidate-list-',
  'negative-lab-dust-candidate-${candidate.candidateId}',
  'negative-lab-dust-heal-layer-count',
  'negative-lab-accept-dust-candidate-${candidate.candidateId}',
  'negative-lab-reject-dust-candidate-${candidate.candidateId}',
  'buildDustCandidateHealLayer',
  'handleAcceptDustCandidate',
  'handleRejectDustCandidate',
  'data-candidate-review-decision={candidateDecision}',
  'data-generated-heal-layer-id={healLayer?.id ??',
  'negative-lab-qc-proof-artifact',
  'negative-lab-qc-overlay-controls',
  'data-overlay-count={qcProofArtifact.overlays.length}',
  'handleToggleQcOverlay',
  'NEGATIVE_LAB_QC_OVERLAY_STORAGE_KEY',
  'activePositiveVariant',
  'negative-lab-positive-handoff',
  'negative-lab-positive-handoff-readiness',
  'negative-lab-positive-frame',
  'negative-lab-positive-profile',
  'negative-lab-positive-base',
  'negative-lab-positive-format',
  'negative-lab-positive-sidecar',
  'negative-lab-positive-provenance',
  'negative-lab-positive-open-in-editor',
  'data-source-frame-id={activePositiveVariant.frameId}',
  'data-profile-id={selectedProfileId}',
  'data-base-scope={baseFogScope}',
  'data-output-format={saveOptions.outputFormat}',
  "data-open-saved-positive-in-editor={openSavedPositiveInEditor ? 'true' : 'false'}",
  'data-provenance-link={provenanceLink}',
  'positiveHandoffOpenInEditor',
  'data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}',
  'data-planned-apply-count={batchDryRunSummary.plannedApplyCount}',
  'data-review-frame-count={batchDryRunSummary.reviewFrameIds.length}',
  'data-review-count={dustScratchReviewReport.reviewCount}',
  'data-skipped-frame-count={batchDryRunSummary.skippedFrameIds.length}',
  'negative-lab-review-frame-count',
  'negative-lab-qc-approved-count',
  'negative-lab-qc-rejected-count',
  'negative-lab-qc-visible-actions',
  'negative-lab-qc-approved-visible',
  'negative-lab-qc-rejected-visible',
  'negative-lab-qc-pending-visible',
  'handleSetVisibleQcDecision',
  'cropStatusByFrameId',
  'negative-lab-active-frame-crop-actions',
  'negative-lab-accept-detected-crop',
  'negative-lab-set-manual-crop',
  'negative-lab-reset-frame-crop',
  'negative-lab-frame-disposition-',
  'negative-lab-frame-qc-decision-',
  'negative-lab-frame-qc-${decision}-',
  'negative-lab-frame-exposure-override-',
  'negative-lab-frame-rgb-balance-override-',
  'negative-lab-frame-exposure-override-control',
  'negative-lab-frame-rgb-balance-override-control',
  'negative-lab-suggest-neutral-patch-rgb',
  'negative-lab-neutral-patch-rgb-suggestion',
  'negative-lab-neutral-patch-application-risk',
  'negative-lab-neutral-patch-correction-magnitude',
  'negative-lab-neutral-patch-apply-warning',
  'negative-lab-apply-neutral-patch-rgb',
  'SuggestNegativeLabNeutralPatchRgbBalance',
  'negative-lab-black-point-control',
  'negative-lab-white-point-control',
  'negative-lab-reset-print-endpoints',
  'data-agent-command-source={agentCommandSource}',
  'data-agent-commit-state={agentCommitState}',
  'data-agent-dry-run-state={agentDryRunState}',
  'data-agent-plan-id={agentPlanId}',
  'data-agent-proof-hash={agentProofHash}',
  'data-agent-rollback-target={agentRollbackTarget}',
  'negative-lab-agent-plan-id',
  'negative-lab-agent-proof-hash',
  'negative-lab-agent-rollback-target',
  'negative_lab_batch_plan_pending_acceptance',
  'accept_dry_run_plan_first',
  'negative-lab-base-sampling-studio',
  'negative-lab-base-sample-active-label',
  'negative-lab-base-sample-warning-count',
  'negative-lab-base-sample-warning-list',
  'negative-lab-base-sample-comparison',
  'negative-lab-accept-base-sample',
  'negative-lab-reject-base-sample',
  'negative-lab-roll-frame-disposition-',
  'negative-lab-roll-selected-disposition',
  'batchDisposition: batchDryRunSummary.dispositionCounts',
  'batchScope: conversionScope',
  'frameExposureOverrides: frameExposureOverridePayload',
  'frameRgbBalanceOverrides: frameRgbBalanceOverridePayload',
  'negative-lab-scope-ready',
  'omittedDispositionFrameIds',
  'qcApprovedFrameIds: approvedQcFrameIds',
  'qcRejectedFrameIds: rejectedQcFrameIds',
  'reviewFrameIds: batchDryRunSummary.reviewFrameIds',
  'data-preview-ready={String(workspaceProof.previewReady)}',
  'data-export-ready={String(workspaceProof.exportReady)}',
  'data-profile-status={selectedProfile.profileStatus}',
  'data-runtime-status={selectedProfile.runtimeStatus}',
  'modals.negativeConversion.batchWorkloadSummary',
  'modals.negativeConversion.workflowExportBlocked',
  'negative-lab-convert-save-action',
  'negative-lab-convert-save-blocked-reason',
  "data-save-blocked-reason={saveBlockedReasonKey ?? ''}",
  "data-can-save={canSave ? 'true' : 'false'}",
  'disabled:opacity-100',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab workspace UI marker missing: ${marker}`);
  }
}

console.log(`negative lab workspace ok (${proof.targetCount} frames, defect candidates + QC proof)`);
