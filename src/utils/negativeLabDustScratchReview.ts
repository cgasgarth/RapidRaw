import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  parseNegativeLabDustScratchReviewReport,
  parseNegativeLabQcProofReport,
  type NegativeLabDustScratchReviewReport,
  type NegativeLabQcProofReport,
} from '../schemas/negativeLabWorkspaceSchemas';

import type { NegativeLabFrameHealthReport } from '../schemas/negativeLabFrameHealthSchemas';

export const buildNegativeLabDustScratchReviewReport = (
  frameHealthReport: NegativeLabFrameHealthReport,
  previewReady: boolean,
): NegativeLabDustScratchReviewReport => {
  const frames = frameHealthReport.frames.map((frame) => {
    if (!frame.included) {
      return {
        findingCodes: ['excluded_not_reviewed'],
        frameId: frame.frameId,
        included: false,
        recommendation: 'Excluded from this batch; include before inspection.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    if (!previewReady) {
      return {
        findingCodes: ['preview_required'],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Generate a conversion preview before dust and scratch review.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    if (frame.batchDisposition === 'review' && frame.batchDispositionReason === 'acquisition_review_required') {
      return {
        findingCodes: ['acquisition_review_required', 'edge_dust_check', 'emulsion_scratch_check'],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Review acquisition source before final export; lossy or unknown input can limit quality.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    if (frame.warningCodes.includes('base_estimate_active_frame_only')) {
      return {
        findingCodes: ['base_fog_only_review', 'edge_dust_check', 'emulsion_scratch_check'],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Confirm this frame after per-frame base sampling before final retouch.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    return {
      findingCodes: ['edge_dust_check', 'emulsion_scratch_check'],
      frameId: frame.frameId,
      included: true,
      recommendation: 'Preview ready for visual dust and scratch pass.',
      scanLabel: frame.scanLabel,
      severity: 'clear',
    };
  });

  return parseNegativeLabDustScratchReviewReport({
    frames,
    reviewCount: frames.filter((frame) => frame.severity === 'review').length,
    retouchCount: frames.filter((frame) => frame.severity === 'retouch').length,
    schemaVersion: NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  });
};

export const buildNegativeLabQcProofReport = (
  reviewReport: NegativeLabDustScratchReviewReport,
  previewReady: boolean,
  exportReady: boolean,
): NegativeLabQcProofReport => {
  const frames = reviewReport.frames.map((frame, index) => {
    const exportBlockedReason = !frame.included
      ? 'Frame excluded from batch.'
      : !previewReady
        ? 'Conversion preview required before QC proof export.'
        : frame.severity === 'retouch'
          ? 'Manual retouch review required before export.'
          : null;

    return {
      contactSheetSlot: index + 1,
      exportBlockedReason,
      findingCodes: frame.findingCodes,
      frameId: frame.frameId,
      included: frame.included,
      needsReview: frame.severity !== 'clear',
      previewReady,
      recommendedAction: frame.recommendation,
      scanLabel: frame.scanLabel,
    };
  });

  return parseNegativeLabQcProofReport({
    contactSheetColumnCount: Math.min(4, Math.max(1, frames.length)),
    exportReady,
    frames,
    includedFrameCount: frames.filter((frame) => frame.included).length,
    reviewFrameCount: frames.filter((frame) => frame.needsReview).length,
    schemaVersion: NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
    totalFrameCount: frames.length,
  });
};
