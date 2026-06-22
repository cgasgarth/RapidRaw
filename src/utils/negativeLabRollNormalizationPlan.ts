import { DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET } from './negativeLabFrameRgbBalanceOverrides';
import {
  parseNegativeLabFrameExposureOverridePayload,
  type NegativeLabFrameExposureOverridePayload,
} from '../schemas/negativeLabFrameExposureOverrideSchemas';
import {
  parseNegativeLabFrameRgbBalanceOverridePayload,
  type NegativeLabFrameRgbBalanceOffset,
  type NegativeLabFrameRgbBalanceOverridePayload,
} from '../schemas/negativeLabFrameRgbBalanceOverrideSchemas';
import {
  NEGATIVE_LAB_ROLL_NORMALIZATION_SCHEMA_VERSION,
  parseNegativeLabRollNormalizationPlan,
  type NegativeLabRollNormalizationMode,
  type NegativeLabRollNormalizationPlan,
} from '../schemas/negativeLabRollNormalizationSchemas';

import type { NegativeLabFrameHealthReport } from '../schemas/negativeLabFrameHealthSchemas';

export interface BuildNegativeLabRollNormalizationPlanParams {
  anchorFrameIds: readonly string[];
  baselineExposure: number;
  frameHealthReport: NegativeLabFrameHealthReport;
  mode: NegativeLabRollNormalizationMode;
  preserveCreativeAdjustments: boolean;
  selectedFrameIds: readonly string[];
}

export const buildNegativeLabRollNormalizationPlan = ({
  anchorFrameIds,
  baselineExposure,
  frameHealthReport,
  mode,
  preserveCreativeAdjustments,
  selectedFrameIds,
}: BuildNegativeLabRollNormalizationPlanParams): NegativeLabRollNormalizationPlan => {
  const selectedFrameIdSet = new Set(selectedFrameIds);
  const affectedFrames = frameHealthReport.frames.filter(
    (frame) => frame.included && selectedFrameIdSet.has(frame.frameId),
  );
  const affectedFrameIds = affectedFrames.map((frame) => frame.frameId);
  const skippedFrameIds = frameHealthReport.frames
    .filter((frame) => !frame.included || frame.healthStatus === 'skipped')
    .map((frame) => frame.frameId);
  const unaffectedFrameIds = frameHealthReport.frames
    .filter((frame) => !affectedFrameIds.includes(frame.frameId))
    .map((frame) => frame.frameId);
  const proposedExposureDeltaEv = mode === 'white_balance_only' ? 0 : 0.15;
  const proposedWhiteBalanceDelta = mode === 'exposure_only' ? 0 : 0.04;
  const exposureOverrides = buildExposureOverrides(
    affectedFrames,
    baselineExposure,
    mode === 'white_balance_only' ? 0 : proposedExposureDeltaEv,
  );
  const rgbBalanceOverrides = buildRgbBalanceOverrides(
    affectedFrames,
    mode === 'exposure_only'
      ? DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET
      : buildRgbOffset(proposedWhiteBalanceDelta),
  );
  const warningCodes = [
    ...(affectedFrameIds.length === 0 ? ['no_selected_frames' as const] : []),
    ...(affectedFrames.some((frame) => frame.batchDisposition === 'review')
      ? ['acquisition_review_required' as const]
      : []),
    'normalization_preview_only' as const,
  ];

  return parseNegativeLabRollNormalizationPlan({
    affectedFrameIds,
    anchorFrameIds,
    exposureOverrides,
    mode,
    positiveVariantIds: affectedFrameIds.map((frameId) => `positive_variant_${frameId}_roll_normalized`),
    preserveCreativeAdjustments,
    proposedExposureDeltaEv,
    proposedWhiteBalanceDelta,
    rgbBalanceOverrides,
    schemaVersion: NEGATIVE_LAB_ROLL_NORMALIZATION_SCHEMA_VERSION,
    skippedFrameIds,
    unaffectedFrameIds,
    warningCodes,
  });
};

const buildExposureOverrides = (
  affectedFrames: NegativeLabFrameHealthReport['frames'],
  baselineExposure: number,
  exposureDeltaEv: number,
): NegativeLabFrameExposureOverridePayload =>
  parseNegativeLabFrameExposureOverridePayload({
    overrides:
      exposureDeltaEv === 0
        ? []
        : affectedFrames.map((frame) => ({
            effectiveExposure: Number((baselineExposure + exposureDeltaEv).toFixed(2)),
            exposureOffset: exposureDeltaEv,
            frameId: frame.frameId,
            sourcePath: frame.sourcePath,
          })),
    schemaVersion: 1,
  });

const buildRgbBalanceOverrides = (
  affectedFrames: NegativeLabFrameHealthReport['frames'],
  rgbBalanceOffset: NegativeLabFrameRgbBalanceOffset,
): NegativeLabFrameRgbBalanceOverridePayload =>
  parseNegativeLabFrameRgbBalanceOverridePayload({
    overrides: affectedFrames.map((frame) => ({
      frameId: frame.frameId,
      rgbBalanceOffset,
      sourcePath: frame.sourcePath,
    })),
    schemaVersion: 1,
  });

const buildRgbOffset = (delta: number): NegativeLabFrameRgbBalanceOffset => ({
  blueWeight: Number((-delta).toFixed(2)),
  greenWeight: 0,
  redWeight: Number(delta.toFixed(2)),
});
