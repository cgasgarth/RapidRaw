#!/usr/bin/env bun

import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
} from '../../../src/utils/negativeLabFrameHealth.ts';

const paths = ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'];
const includedPathSet = new Set([paths[0], paths[1]]);
const report = buildNegativeLabFrameHealthReport({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPathSet,
  previewReady: false,
  targetPaths: paths,
});

const failures = [];
const dryRunSummary = buildNegativeLabBatchDryRunSummary(report);
const rollScopedReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  baseScope: 'roll',
  includedPathSet,
  previewReady: true,
  targetPaths: paths,
});
const acquisitionReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.82,
  baseScope: 'roll',
  includedPathSet: new Set(['/roll/001.tif', '/roll/002.jpg']),
  previewReady: true,
  targetPaths: ['/roll/001.tif', '/roll/002.jpg'],
});
const acquisitionDryRunSummary = buildNegativeLabBatchDryRunSummary(acquisitionReport);

if (report.frames.length !== 3) failures.push('expected 3 frame health entries');
if (report.includedCount !== 2) failures.push('expected 2 included frames');
if (report.queuedCount !== 2) failures.push('expected 2 queued frames');
if (report.activeFrameId !== 'negative-lab-frame-2') failures.push('expected frame 2 active');
if (report.frames[1]?.baseStatus !== 'estimated' || report.frames[1]?.baseConfidence !== 0.82) {
  failures.push('active frame should carry base confidence');
}
if (report.frames[1]?.warningSeverity !== 'review' || report.frames[1]?.conversionStatus !== 'preview_pending') {
  failures.push('active frame should be review severity while preview is pending');
}
if (report.frames[1]?.cropStatus !== 'active_frame_editable') {
  failures.push('active frame should expose editable crop status');
}
if (report.frames[0]?.warningSeverity !== 'info' || report.frames[0]?.conversionStatus !== 'queued') {
  failures.push('included inactive frame should be info severity and queued for conversion');
}
if (!report.frames[2]?.warningCodes.includes('excluded_from_batch')) {
  failures.push('excluded frame should carry excluded_from_batch warning');
}
if (
  report.frames[2]?.warningSeverity !== 'review' ||
  report.frames[2]?.cropStatus !== 'skipped' ||
  report.frames[2]?.qcStatus !== 'skipped'
) {
  failures.push('excluded frame should expose review severity with skipped crop/QC state');
}
if (!report.frames[0]?.warningCodes.includes('base_estimate_active_frame_only')) {
  failures.push('non-active included frame should disclose active-frame-only base estimate');
}
if (!report.warningCodes.includes('preview_not_ready')) failures.push('report should roll up preview warning');
if (dryRunSummary.plannedApplyCount !== 2) failures.push('dry-run summary should apply 2 frames');
if (dryRunSummary.skippedFrameIds[0] !== 'negative-lab-frame-3') failures.push('dry-run summary should skip frame 3');
if (!dryRunSummary.rollWarningCodes.includes('excluded_from_batch')) {
  failures.push('dry-run summary should roll up excluded frame warning');
}
if (rollScopedReport.frames[0]?.baseScope !== 'roll' || rollScopedReport.frames[0]?.baseConfidence !== 0.82) {
  failures.push('roll-scoped base estimate should apply to included inactive frames');
}
if (rollScopedReport.frames[0]?.warningCodes.includes('base_estimate_active_frame_only')) {
  failures.push('roll-scoped base estimate should clear active-frame-only warning');
}
if (rollScopedReport.frames[2]?.baseScope !== 'frame' || rollScopedReport.frames[2]?.baseConfidence !== null) {
  failures.push('roll-scoped base estimate must not apply to excluded frames');
}
if (acquisitionReport.frames[1]?.acquisitionSourceFamily !== 'jpeg_lossy') {
  failures.push('JPEG frame should carry lossy acquisition source family');
}
if (!acquisitionReport.frames[1]?.acquisitionWarningCodes.includes('lossy_source_for_negative_lab')) {
  failures.push('JPEG frame should carry lossy acquisition warning');
}
if (acquisitionReport.frames[1]?.warningSeverity !== 'review') {
  failures.push('JPEG acquisition warning should promote frame severity to review');
}
if (acquisitionDryRunSummary.acquisitionReviewFrameIds[0] !== 'negative-lab-frame-2') {
  failures.push('dry-run summary should identify acquisition review frame');
}
if (
  acquisitionReport.frames[0]?.batchDisposition !== 'apply' ||
  acquisitionReport.frames[0]?.batchDispositionReason !== 'ready_to_apply'
) {
  failures.push('TIFF acquisition should be ready to apply');
}
if (
  acquisitionReport.frames[1]?.batchDisposition !== 'review' ||
  acquisitionReport.frames[1]?.batchDispositionReason !== 'acquisition_review_required'
) {
  failures.push('JPEG acquisition should require batch review disposition');
}
if (
  acquisitionDryRunSummary.dispositionCounts.apply !== 1 ||
  acquisitionDryRunSummary.dispositionCounts.review !== 1 ||
  acquisitionDryRunSummary.dispositionCounts.skip !== 0
) {
  failures.push('dry-run summary should count apply/review/skip dispositions');
}
if (acquisitionDryRunSummary.reviewFrameIds[0] !== 'negative-lab-frame-2') {
  failures.push('dry-run summary should identify review disposition frame');
}

if (failures.length > 0) {
  console.error('Negative Lab frame health report validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `negative lab frame health ok (${report.frames.length} frames, ${dryRunSummary.plannedApplyCount} apply, ${report.warningCodes.length} warnings)`,
);
