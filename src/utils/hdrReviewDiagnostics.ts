import { hdrReviewDiagnosticsSchema, type HdrReviewDiagnostics } from '../schemas/hdrReviewDiagnosticsSchemas';

import type { HdrBracketDetectionResultV1 } from '../../packages/rawengine-schema/src/rawEngineSchemas';
import type { HdrMergeUiSettings } from '../schemas/hdrMergeUiSchemas';

interface BuildHdrReviewDiagnosticsInput {
  bracketPreflight: HdrBracketDetectionResultV1 | null;
  imageCount: number;
  isMergeReady: boolean;
  settings: HdrMergeUiSettings;
}

export const buildHdrReviewDiagnostics = ({
  bracketPreflight,
  imageCount,
  isMergeReady,
  settings,
}: BuildHdrReviewDiagnosticsInput): HdrReviewDiagnostics => {
  const warningCodes = [
    ...(bracketPreflight?.blockCodes ?? []),
    ...(bracketPreflight?.warningCodes ?? []),
    ...(settings.toneMapPreview ? ['tone_mapped_preview_review'] : []),
    ...(settings.deghosting === 'off' ? ['deghosting_disabled'] : []),
  ];
  const warningSeverity = !isMergeReady ? 'blocked' : warningCodes.length > 0 ? 'review' : 'ok';
  const alignmentConfidencePercent =
    bracketPreflight === null ? 50 : Math.round(bracketPreflight.detectionConfidence * 100);
  const clippingRisk = bracketPreflight === null ? 'medium' : bracketPreflight.bracketSpanEv >= 3 ? 'low' : 'high';

  return hdrReviewDiagnosticsSchema.parse({
    alignment: {
      confidencePercent: alignmentConfidencePercent,
      mode: settings.alignmentMode,
      status: settings.alignmentMode === 'none' || alignmentConfidencePercent < 70 ? 'review' : 'ready',
    },
    deghost: {
      confidenceMapVisible: settings.deghostConfidenceMapVisible,
      level: settings.deghosting,
      motionRisk:
        settings.deghosting === 'off'
          ? 'none'
          : settings.deghosting === 'high'
            ? 'high'
            : settings.deghosting === 'medium'
              ? 'medium'
              : 'low',
      regionIntensityPercent: settings.deghostRegionIntensityPercent,
      status: settings.deghosting === 'off' ? 'review' : 'ready',
    },
    nonClaims: ['not_real_raw_e2e_verified', 'not_photographer_accepted', 'not_export_parity_verified'],
    proofLevel: 'synthetic_runtime',
    reviewDecision: isMergeReady && imageCount >= 2 ? 'accepted' : 'rejected',
    tone: {
      clippingRisk,
      policy: settings.toneMapPreview ? 'tone_mapped_preview_review' : 'editable_linear_request',
      status: clippingRisk === 'high' || settings.toneMapPreview ? 'review' : 'ready',
    },
    warningCodes,
    warningSeverity,
  });
};
