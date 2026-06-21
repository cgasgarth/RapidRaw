#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

const files = {
  modal: readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8'),
  smoke: readFileSync('scripts/capture-visual-smoke.ts', 'utf8'),
  util: readFileSync('src/utils/negativeLabFrameHealth.ts', 'utf8'),
};

const failures = [];
const requireMarker = (source, marker, label) => {
  if (!source.includes(marker)) {
    failures.push(`${label}: missing ${marker}`);
  }
};

for (const marker of [
  'buildNegativeLabFrameHealthReport',
  'buildNegativeLabBatchDryRunSummary',
  'negative-lab-frame-health-grid',
  'negative-lab-frame-health-controls',
  'negative-lab-frame-health-filter',
  'negative-lab-frame-health-sort',
  'negative-lab-frame-health-visible-count',
  'negative-lab-frame-health-row-',
  'negative-lab-frame-health-status-',
  'negative-lab-frame-source-',
  'negative-lab-frame-severity-',
  'negative-lab-frame-crop-status-',
  'negative-lab-frame-conversion-status-',
  'negative-lab-frame-qc-status-',
  'negative-lab-roll-frame-navigator',
  'negative-lab-roll-frame-navigator-proof',
  'negative-lab-roll-frame-strip',
  'negative-lab-roll-frame-status-',
  'negative-lab-roll-frame-source-',
  'negative-lab-roll-frame-acquisition-warning-',
  'negative-lab-roll-frame-runtime-',
  'negative-lab-roll-frame-disposition-',
  'negative-lab-roll-selected-disposition',
  'negative-lab-base-scope',
  'negative-lab-base-scope-label',
  'negative-lab-promote-base-roll',
  'negative-lab-workflow-readiness-strip',
  'negative-lab-workflow-queued',
  'negative-lab-workflow-preview',
  'negative-lab-workflow-export',
  'negative-lab-selected-stock-readiness',
  'negative-lab-frame-warning-chip-',
  'negative-lab-frame-acquisition-warning-chip-',
  'negative-lab-planned-apply-count',
  'negative-lab-skipped-frame-count',
  'negative-lab-review-frame-count',
  'negative-lab-qc-approved-count',
  'negative-lab-qc-rejected-count',
  'negative-lab-frame-exposure-override-control',
  'negative-lab-reset-frame-exposure',
  'negative-lab-recipe-frame-exposure-offset',
  'negative-lab-scope-ready',
  'negative-lab-copy-batch-plan',
  'negative-lab-accept-batch-plan',
  'acceptedBatchPlanIdentity',
  'batchScope: conversionScope',
  'omittedDispositionFrameIds',
  'qcApprovedFrameIds: approvedQcFrameIds',
  'qcDecisionByFrameId',
  'frameExposureOffsetByFrameId',
  'frameExposureOverridePayload',
  'qcRejectedFrameIds: rejectedQcFrameIds',
  'visibleFrameHealthRows',
  'frameHealthFilter',
  'frameHealthSort',
]) {
  requireMarker(files.modal, marker, 'modal');
}

for (const marker of [
  'frameHealthReport.frames',
  'acquisitionReviewFrameIds',
  'dispositionCounts',
  'reviewFrameIds',
  'acquisitionSourceFamily',
  'acquisitionWarningCodes',
  'batchDisposition',
  'batchDispositionReason',
  'warningSeverity',
  'conversionStatus',
  'cropStatus',
  'qcStatus',
  'warningCodes',
  'excluded_from_batch',
  'base_estimate_active_frame_only',
  'baseScope',
  'preview_not_ready',
]) {
  requireMarker(files.util, marker, 'frame health');
}

for (const marker of [
  'negative-lab-frame-count',
  'negative-lab-roll-frame-navigator',
  'negative-lab-roll-frame-1',
  'negative-lab-roll-frame-status-1',
  'negative-lab-roll-frame-runtime-1',
  'negative-lab-roll-warning-count',
  'negative-lab-planned-apply-count',
  'negative-lab-skipped-frame-count',
  'negative-lab-copy-batch-plan',
  'negative-lab-accept-batch-plan',
  '"plannedApplyCount"',
  '"skippedFrameIds"',
]) {
  requireMarker(files.smoke, marker, 'visual smoke');
}

if (failures.length > 0) {
  console.error(`negative lab roll cockpit failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('negative lab roll cockpit ok');
