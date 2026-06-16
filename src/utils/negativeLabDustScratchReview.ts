import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  parseNegativeLabDustScratchReviewReport,
  type NegativeLabDustScratchReviewReport,
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
