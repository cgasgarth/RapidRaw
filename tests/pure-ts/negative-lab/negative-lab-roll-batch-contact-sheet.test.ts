import { describe, expect, test } from 'bun:test';

import { FRAME_WARNING_SEVERITY_SCORE } from '../../../src/components/modals/negative-lab/NegativeLabRollHealthModel.ts';
import { buildNegativeLabBatchApplyReceipt } from '../../../src/utils/negative-lab/negativeLabBatchApplyReceipt.ts';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../src/utils/negative-lab/negativeLabDustScratchReview.ts';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
} from '../../../src/utils/negative-lab/negativeLabFrameHealth.ts';
import {
  buildNegativeLabAcceptedApplyPlanFingerprint,
  buildNegativeLabAcceptedPlanIdentity,
  getNegativeLabAcceptedApplyPlanStaleReasons,
  isNegativeLabAcceptedApplyPlanCurrent,
} from '../../../src/utils/negative-lab/negativeLabPlanIdentity.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';
import { buildNegativeLabQcContactSheetArtifact } from '../../../src/utils/negative-lab/negativeLabQcContactSheetArtifact.ts';

const targetPaths = [
  '/roll-batch/frame-001.tif',
  '/roll-batch/frame-002.jpg',
  '/roll-batch/frame-003.tif',
  '/roll-batch/frame-004-positive.jpg',
];

const buildAcceptedFingerprint = ({
  dryRunPlanJson,
  outputFormat = 'tiff16',
  pathsToConvert = targetPaths,
  sessionRevision = 0,
}: {
  dryRunPlanJson: string;
  outputFormat?: 'jpeg_proof' | 'tiff16';
  pathsToConvert?: readonly string[];
  sessionRevision?: number;
}) =>
  buildNegativeLabAcceptedApplyPlanFingerprint({
    dryRunPlanJson,
    outputFormat,
    params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
    pathsToConvert,
    selectedProfileSnapshot: null,
    sessionRevision,
    suffix: 'Positive',
    writeConversionBundle: true,
  });

describe('negative lab roll batch contact sheet workflow', () => {
  test('honors frame inclusion and health warning sorting before roll apply', () => {
    const includedPathSet = new Set([targetPaths[0], targetPaths[1], targetPaths[2]]);
    const frameHealthReport = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
      baseScope: 'roll',
      cropStatusByFrameId: {},
      includedPathSet,
      previewReady: true,
      targetPaths,
    });
    const dryRunSummary = buildNegativeLabBatchDryRunSummary(frameHealthReport);

    expect(dryRunSummary.affectedFrameIds).toContain('negative-lab-frame-1');
    expect(dryRunSummary.affectedFrameIds).toContain('negative-lab-frame-3');
    expect(dryRunSummary.skippedFrameIds).toContain('negative-lab-frame-4');
    expect(dryRunSummary.reviewFrameIds).toContain('negative-lab-frame-2');

    const reviewRows = frameHealthReport.frames.filter((frame) => frame.warningSeverity === 'review');
    const warningSortedRows = [...frameHealthReport.frames].toSorted(
      (left, right) =>
        FRAME_WARNING_SEVERITY_SCORE[right.warningSeverity] - FRAME_WARNING_SEVERITY_SCORE[left.warningSeverity] ||
        left.pathIndex - right.pathIndex,
    );

    expect(reviewRows.map((frame) => frame.frameId)).toEqual(['negative-lab-frame-2', 'negative-lab-frame-4']);
    expect(warningSortedRows[0]?.frameId).toBe('negative-lab-frame-2');
    expect(warningSortedRows.at(-1)?.frameId).toBe('negative-lab-frame-3');
  });

  test('invalidates accepted plans when the session revision changes', () => {
    const frameHealthReport = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
      baseScope: 'roll',
      cropStatusByFrameId: {},
      includedPathSet: new Set(targetPaths),
      previewReady: true,
      targetPaths,
    });
    const currentPlanJson = JSON.stringify({ dryRunSummary: buildNegativeLabBatchDryRunSummary(frameHealthReport) });
    const acceptedFingerprint = buildAcceptedFingerprint({ dryRunPlanJson: currentPlanJson });
    const staleFingerprint = buildAcceptedFingerprint({
      dryRunPlanJson: currentPlanJson,
      outputFormat: 'jpeg_proof',
      pathsToConvert: targetPaths.slice(0, 3),
      sessionRevision: 1,
    });

    expect(
      isNegativeLabAcceptedApplyPlanCurrent({
        acceptedApplyPlanFingerprint: acceptedFingerprint,
        currentApplyPlanFingerprint: acceptedFingerprint,
      }),
    ).toBe(true);
    expect(
      isNegativeLabAcceptedApplyPlanCurrent({
        acceptedApplyPlanFingerprint: acceptedFingerprint,
        currentApplyPlanFingerprint: staleFingerprint,
      }),
    ).toBe(false);
    expect(
      getNegativeLabAcceptedApplyPlanStaleReasons({
        acceptedApplyPlanFingerprint: acceptedFingerprint,
        currentApplyPlanFingerprint: staleFingerprint,
      }),
    ).toEqual(['session_revision_changed']);
  });

  test('creates roll and per-frame receipts from the QC contact sheet artifact', () => {
    const frameHealthReport = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
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
      outputIntent: 'editable_positive',
      qcDecisionByFrameId: {
        'negative-lab-frame-1': 'approved',
        'negative-lab-frame-2': 'approved',
        'negative-lab-frame-4': 'rejected',
      },
      report: qcReport,
      sessionId: 'negative_lab_roll_batch_contact_sheet_test',
      sourcePathsByFrameId: new Map(frameHealthReport.frames.map((frame) => [frame.frameId, frame.sourcePath])),
    });
    const acceptedPlanIdentity = buildNegativeLabAcceptedPlanIdentity(
      buildAcceptedFingerprint({ dryRunPlanJson: JSON.stringify({ dryRunSummary }) }),
    );
    const receipt = buildNegativeLabBatchApplyReceipt({
      acceptedPlanIdentity,
      dryRunSummary,
      openInEditor: false,
      qcProofArtifact: qcArtifact,
    });

    expect(receipt.contactSheetArtifactId).toBe(qcArtifact.contactSheet.artifact.artifactId);
    expect(receipt.appliedPositiveCount).toBe(dryRunSummary.affectedFrameIds.length);
    expect(receipt.appliedPositives.map((positive) => positive.frameId)).toEqual(dryRunSummary.affectedFrameIds);
    expect(receipt.appliedPositives.every((positive) => positive.savedPath === null)).toBe(true);
    expect(receipt.appliedPositives.every((positive) => positive.generatedContentHash.startsWith('sha256:'))).toBe(
      true,
    );
  });

  test('reflects QC overlay visibility in generated contact sheet overlays', () => {
    const frameHealthReport = buildNegativeLabFrameHealthReport({
      activePathIndex: 0,
      baseFogConfidence: 0.9,
      baseScope: 'roll',
      cropStatusByFrameId: {},
      includedPathSet: new Set(targetPaths),
      previewReady: true,
      targetPaths,
    });
    const qcReport = buildNegativeLabQcProofReport(
      buildNegativeLabDustScratchReviewReport(frameHealthReport, true),
      true,
      false,
    );
    const visibleArtifact = buildNegativeLabQcContactSheetArtifact({
      overlayVisibility: { densityWarnings: true, frameBounds: true, rejectedMarkers: true },
      qcDecisionByFrameId: { 'negative-lab-frame-2': 'rejected' },
      report: qcReport,
      sessionId: 'negative_lab_overlay_visible',
    });
    const hiddenArtifact = buildNegativeLabQcContactSheetArtifact({
      overlayVisibility: { densityWarnings: false, frameBounds: false, rejectedMarkers: false },
      qcDecisionByFrameId: { 'negative-lab-frame-2': 'rejected' },
      report: qcReport,
      sessionId: 'negative_lab_overlay_hidden',
    });

    expect(visibleArtifact.overlays.some((overlay) => overlay.overlayKind === 'frame_boundary')).toBe(true);
    expect(visibleArtifact.overlays.some((overlay) => overlay.overlayKind === 'density_sample')).toBe(true);
    expect(visibleArtifact.overlays.some((overlay) => overlay.overlayKind === 'warning_badge')).toBe(true);
    expect(hiddenArtifact.overlays.some((overlay) => overlay.overlayKind === 'frame_boundary')).toBe(false);
    expect(hiddenArtifact.overlays.some((overlay) => overlay.overlayKind === 'density_sample')).toBe(false);
    expect(hiddenArtifact.overlays.some((overlay) => overlay.overlayKind === 'warning_badge')).toBe(false);
  });
});
