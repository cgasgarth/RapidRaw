import type { NegativeLabAutoDensitySuggestionRun } from '../schemas/negative-lab/negativeLabAutoDensitySuggestionSchemas';
import {
  type NegativeLabFrameExposureOverridePayload,
  parseNegativeLabFrameExposureOverridePayload,
} from '../schemas/negative-lab/negativeLabFrameExposureOverrideSchemas';
import type { NegativeLabFrameHealthReport } from '../schemas/negative-lab/negativeLabFrameHealthSchemas';
import {
  type NegativeLabFrameRgbBalanceOffset,
  type NegativeLabFrameRgbBalanceOverridePayload,
  parseNegativeLabFrameRgbBalanceOverridePayload,
} from '../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabPresetParams } from '../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import {
  NEGATIVE_LAB_ROLL_NORMALIZATION_SCHEMA_VERSION,
  type NegativeLabRollNormalizationMode,
  type NegativeLabRollNormalizationPlan,
  parseNegativeLabRollNormalizationPlan,
} from '../schemas/negative-lab/negativeLabRollNormalizationSchemas';
import {
  buildNegativeLabAutoDensitySuggestionRun,
  type NegativeLabFrameMetricsInput,
} from './negativeLabAutoDensitySuggestions';
import { DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET } from './negativeLabFrameRgbBalanceOverrides';

export interface BuildNegativeLabRollNormalizationPlanParams {
  anchorFrameIds: readonly string[];
  baselineExposure: number;
  autoDensitySuggestionRun?: NegativeLabAutoDensitySuggestionRun | null;
  frameHealthReport: NegativeLabFrameHealthReport;
  frameScanMetrics?: readonly NegativeLabFrameMetricsInput[];
  mode: NegativeLabRollNormalizationMode;
  params?: NegativeLabPresetParams | null;
  preserveCreativeAdjustments: boolean;
  selectedFrameIds: readonly string[];
}

export const buildNegativeLabRollNormalizationPlan = ({
  anchorFrameIds,
  autoDensitySuggestionRun,
  baselineExposure,
  frameHealthReport,
  frameScanMetrics = [],
  mode,
  params = null,
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
  const suggestionRun =
    autoDensitySuggestionRun ??
    (frameScanMetrics.length > 0
      ? buildNegativeLabAutoDensitySuggestionRun({
          frameMetrics: frameScanMetrics,
          frameRows: affectedFrames,
          params,
          selectedFrameIds: affectedFrameIds,
        })
      : null);
  const suggestedExposureOffsets = new Map(
    suggestionRun?.frameSuggestions.map((suggestion) => [suggestion.frameId, suggestion.exposureOffsetEv]) ?? [],
  );
  const suggestedRgbOffsets = new Map(
    suggestionRun?.frameSuggestions.flatMap((suggestion) =>
      suggestion.castBalanceSuggestion === null ? [] : [[suggestion.frameId, suggestion.castBalanceSuggestion]],
    ) ?? [],
  );
  const proposedExposureDeltaEv =
    mode === 'white_balance_only'
      ? 0
      : Number(
          (
            affectedFrames.reduce((sum, frame) => sum + (suggestedExposureOffsets.get(frame.frameId) ?? 0), 0) /
            Math.max(1, affectedFrames.length)
          ).toFixed(2),
        );
  const proposedWhiteBalanceDelta =
    mode === 'exposure_only'
      ? 0
      : Number(
          (
            [...suggestedRgbOffsets.values()].reduce(
              (sum, offset) =>
                sum + Math.max(Math.abs(offset.blueWeight), Math.abs(offset.greenWeight), Math.abs(offset.redWeight)),
              0,
            ) / Math.max(1, suggestedRgbOffsets.size)
          ).toFixed(2),
        );
  const exposureOverrides = buildExposureOverrides(
    affectedFrames,
    baselineExposure,
    mode === 'white_balance_only' ? new Map() : suggestedExposureOffsets,
  );
  const rgbBalanceOverrides = buildRgbBalanceOverrides(
    affectedFrames,
    mode === 'exposure_only' ? new Map() : suggestedRgbOffsets,
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
    autoDensitySuggestionRun: suggestionRun,
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
  exposureOffsetsByFrameId: ReadonlyMap<string, number>,
): NegativeLabFrameExposureOverridePayload =>
  parseNegativeLabFrameExposureOverridePayload({
    overrides: affectedFrames.flatMap((frame) => {
      const exposureOffset = exposureOffsetsByFrameId.get(frame.frameId) ?? 0;
      if (exposureOffset === 0) return [];
      return [
        {
          effectiveExposure: Number((baselineExposure + exposureOffset).toFixed(2)),
          exposureOffset,
          frameId: frame.frameId,
          sourcePath: frame.sourcePath,
        },
      ];
    }),
    schemaVersion: 1,
  });

const buildRgbBalanceOverrides = (
  affectedFrames: NegativeLabFrameHealthReport['frames'],
  rgbBalanceOffsetsByFrameId: ReadonlyMap<string, NegativeLabFrameRgbBalanceOffset | null>,
): NegativeLabFrameRgbBalanceOverridePayload =>
  parseNegativeLabFrameRgbBalanceOverridePayload({
    overrides: affectedFrames.flatMap((frame) => {
      const rgbBalanceOffset =
        rgbBalanceOffsetsByFrameId.get(frame.frameId) ?? DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET;
      if (rgbBalanceOffset.blueWeight === 0 && rgbBalanceOffset.greenWeight === 0 && rgbBalanceOffset.redWeight === 0) {
        return [];
      }
      return [
        {
          frameId: frame.frameId,
          rgbBalanceOffset,
          sourcePath: frame.sourcePath,
        },
      ];
    }),
    schemaVersion: 1,
  });
