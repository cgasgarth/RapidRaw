import type { NegativeLabFrameHealthReport } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  type NegativeLabDustScratchReviewReport,
  type NegativeLabQcProofReport,
  parseNegativeLabDustScratchReviewReport,
  parseNegativeLabQcProofReport,
} from '../../schemas/negative-lab/negativeLabWorkspaceSchemas';
import { detectNegativeLabLongScratches, type NegativeLabScratchAnalysisInput } from './negativeLabScratchDetector';

type NegativeLabDustScratchCandidate = NegativeLabDustScratchReviewReport['frames'][number]['candidates'][number];

export type NegativeLabNativeDustCandidate = Pick<
  NegativeLabDustScratchCandidate,
  'candidateId' | 'confidence' | 'geometry' | 'polarity' | 'status' | 'supportCount' | 'warningCodes'
> & {
  detectorVersion: string;
};

const buildReviewCandidates = (
  _frameId: string,
  reviewNeeded: boolean,
  scratchAnalysis: NegativeLabScratchAnalysisInput | undefined,
  nativeDustCandidates: NegativeLabNativeDustCandidate[] | undefined,
  status: NegativeLabDustScratchCandidate['status'] = 'pending',
): NegativeLabDustScratchCandidate[] => {
  if (!reviewNeeded) return [];

  const candidates: NegativeLabDustScratchCandidate[] = (nativeDustCandidates ?? []).map((candidate) => ({
    ...candidate,
    kind: 'dust_spot',
    status,
  }));
  if (scratchAnalysis !== undefined) {
    candidates.push(...detectNegativeLabLongScratches(scratchAnalysis).map((candidate) => ({ ...candidate, status })));
  }
  return candidates;
};

export const buildNegativeLabDustScratchReviewReport = (
  frameHealthReport: NegativeLabFrameHealthReport,
  previewReady: boolean,
  scratchAnalysisByFrameId: Readonly<Record<string, NegativeLabScratchAnalysisInput | undefined>> = {},
  nativeDustCandidatesByFrameId: Readonly<Record<string, NegativeLabNativeDustCandidate[] | undefined>> = {},
): NegativeLabDustScratchReviewReport => {
  const frames = frameHealthReport.frames.map((frame) => {
    if (!frame.included) {
      return {
        candidates: [],
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
        candidates: [],
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
        candidates: buildReviewCandidates(
          frame.frameId,
          true,
          scratchAnalysisByFrameId[frame.frameId],
          nativeDustCandidatesByFrameId[frame.frameId],
        ),
        findingCodes: [
          'acquisition_review_required',
          'candidate_dust_spot',
          'candidate_emulsion_scratch',
          'edge_dust_check',
          'emulsion_scratch_check',
        ],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Review acquisition source before final export; lossy or unknown input can limit quality.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    if (frame.batchDisposition === 'review' && frame.batchDispositionReason === 'bounds_review_required') {
      return {
        candidates: [],
        findingCodes: ['bounds_review_required'],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Review density bounds and base/fog warnings before final export.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    if (frame.warningCodes.includes('base_estimate_active_frame_only')) {
      return {
        candidates: buildReviewCandidates(
          frame.frameId,
          true,
          scratchAnalysisByFrameId[frame.frameId],
          nativeDustCandidatesByFrameId[frame.frameId],
          'acknowledged',
        ),
        findingCodes: [
          'base_fog_only_review',
          'candidate_dust_spot',
          'candidate_emulsion_scratch',
          'edge_dust_check',
          'emulsion_scratch_check',
        ],
        frameId: frame.frameId,
        included: true,
        recommendation: 'Confirm this frame after per-frame base sampling before final retouch.',
        scanLabel: frame.scanLabel,
        severity: 'review',
      };
    }

    return {
      candidates: [],
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
      candidates: frame.candidates,
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
