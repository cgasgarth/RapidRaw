import {
  NEGATIVE_LAB_AUTO_DENSITY_SUGGESTION_SCHEMA_VERSION,
  parseNegativeLabAutoDensitySuggestionRun,
  type NegativeLabAutoDensityFrameSuggestion,
  type NegativeLabAutoDensitySuggestionRun,
  type NegativeLabAutoDensitySuggestionState,
  type NegativeLabAutoDensityWarningCode,
} from '../schemas/negativeLabAutoDensitySuggestionSchemas';

import type { NegativeLabFrameHealthEntry } from '../schemas/negativeLabFrameHealthSchemas';
import type { NegativeLabFrameRgbBalanceOffset } from '../schemas/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabPresetParams } from '../schemas/negativeLabPresetCatalogSchemas';
import type { NegativeLabScanMetricsV1 } from '../schemas/negativeLabScanMetricsSchemas';

export interface NegativeLabFrameMetricsInput {
  frameId: string;
  metrics: NegativeLabScanMetricsV1;
  sourcePath: string;
}

export interface BuildNegativeLabAutoDensitySuggestionRunParams {
  acceptedDryRunPlanHash?: string | null;
  acceptedDryRunPlanId?: string | null;
  confidenceThreshold?: number;
  frameMetrics: readonly NegativeLabFrameMetricsInput[];
  frameRows: readonly NegativeLabFrameHealthEntry[];
  params?: NegativeLabPresetParams | null;
  selectedFrameIds: readonly string[];
  state?: NegativeLabAutoDensitySuggestionState;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.58;
const REFERENCE_DENSITY_FALLBACK = 0.46;
const REFERENCE_RANGE_FALLBACK = 0.34;
const EXPOSURE_GAIN = 0.85;
const CONTRAST_GAIN = 0.55;
const CAST_GAIN = 0.35;
const MAX_EXPOSURE_OFFSET_EV = 0.8;
const MAX_CONTRAST_DELTA = 0.35;
const MAX_RGB_OFFSET = 0.18;
const CAST_SIGNAL_FLOOR = 0.018;

const clamp = (value: number, minValue: number, maxValue: number) => Math.min(maxValue, Math.max(minValue, value));
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));
const snapExposure = (value: number) => round(Math.round(value / 0.05) * 0.05);
const snapRgb = (value: number) => round(Math.round(value / 0.01) * 0.01);

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middle] ?? null;
  const left = sortedValues[middle - 1] ?? 0;
  const right = sortedValues[middle] ?? left;
  return (left + right) / 2;
};

const buildPrintCurveParameters = (params: NegativeLabPresetParams | null | undefined) => {
  if (params === null || params === undefined) return null;
  return {
    blackPoint: round(params.black_point, 4),
    contrast: round(params.contrast, 4),
    curveCenter: round(0.6 - params.exposure * 0.25, 4),
    curveStrength: round(4 * params.contrast, 4),
    exposure: round(params.exposure, 4),
    whitePoint: round(params.white_point, 4),
  };
};

const warningCodesFromMetrics = (
  metrics: NegativeLabScanMetricsV1,
  exposureOffsetEv: number,
  confidence: number,
  confidenceThreshold: number,
): NegativeLabAutoDensityWarningCode[] => {
  const warnings = new Set<NegativeLabAutoDensityWarningCode>();
  if (metrics.warningCodes.includes('border_density_contamination')) warnings.add('border_density_contamination');
  if (metrics.warningCodes.includes('insufficient_density_samples')) warnings.add('insufficient_density_samples');
  if (metrics.warningCodes.includes('near_flat_density_field')) warnings.add('flat_density_field');
  if (
    metrics.clippingCounts.nonpositiveTransmittanceCount > 0 ||
    metrics.clippingCounts.unityOrHigherTransmittanceCount > 0
  ) {
    warnings.add('clipped_transmittance_samples');
  }
  if (metrics.texturalDensityRangeP10P90 < 0.05) warnings.add('flat_density_field');
  if (metrics.lumaDensityPercentiles.p50 > 0.74) warnings.add('dense_frame');
  if (metrics.lumaDensityPercentiles.p50 < 0.18) warnings.add('thin_frame');
  if (exposureOffsetEv <= -0.25) warnings.add('high_key_frame');
  if (exposureOffsetEv >= 0.25) warnings.add('low_key_frame');
  if (confidence < confidenceThreshold) warnings.add('confidence_below_apply_threshold');
  return [...warnings].sort();
};

const confidenceFromMetrics = (metrics: NegativeLabScanMetricsV1, referenceRange: number) => {
  let confidence = 0.92;
  if (metrics.sampleCount < 64) confidence -= 0.28;
  if (metrics.warningCodes.includes('border_density_contamination')) confidence -= 0.16;
  if (metrics.warningCodes.includes('insufficient_density_samples')) confidence -= 0.34;
  if (metrics.warningCodes.includes('near_flat_density_field')) confidence -= 0.24;
  if (metrics.clippingCounts.nonpositiveTransmittanceCount > 0) confidence -= 0.12;
  if (metrics.clippingCounts.unityOrHigherTransmittanceCount > 0) confidence -= 0.08;
  const rangeRatio = metrics.texturalDensityRangeP10P90 / Math.max(0.01, referenceRange);
  if (rangeRatio < 0.28 || rangeRatio > 2.8) confidence -= 0.12;
  return round(clamp(confidence, 0.05, 0.98), 2);
};

const channelMedianDeviation = (metrics: NegativeLabScanMetricsV1, channel: 'blue' | 'green' | 'red') =>
  round((metrics.channels[channel].deviationBounds.lower + metrics.channels[channel].deviationBounds.upper) / 2, 4);

const buildCastBalanceSuggestion = (
  metrics: NegativeLabScanMetricsV1,
  confidence: number,
  confidenceThreshold: number,
): { offset: NegativeLabFrameRgbBalanceOffset | null; lowConfidence: boolean } => {
  const red = channelMedianDeviation(metrics, 'red');
  const green = channelMedianDeviation(metrics, 'green');
  const blue = channelMedianDeviation(metrics, 'blue');
  const maxSignal = Math.max(Math.abs(red), Math.abs(green), Math.abs(blue));
  if (maxSignal < CAST_SIGNAL_FLOOR) return { lowConfidence: false, offset: null };
  if (confidence < confidenceThreshold + 0.08) return { lowConfidence: true, offset: null };

  return {
    lowConfidence: false,
    offset: {
      blueWeight: snapRgb(clamp(-blue * CAST_GAIN, -MAX_RGB_OFFSET, MAX_RGB_OFFSET)),
      greenWeight: snapRgb(clamp(-green * CAST_GAIN, -MAX_RGB_OFFSET, MAX_RGB_OFFSET)),
      redWeight: snapRgb(clamp(-red * CAST_GAIN, -MAX_RGB_OFFSET, MAX_RGB_OFFSET)),
    },
  };
};

export const buildNegativeLabAutoDensitySuggestionRun = ({
  acceptedDryRunPlanHash = null,
  acceptedDryRunPlanId = null,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  frameMetrics,
  frameRows,
  params = null,
  selectedFrameIds,
  state = 'suggested_only',
}: BuildNegativeLabAutoDensitySuggestionRunParams): NegativeLabAutoDensitySuggestionRun => {
  const selectedFrameIdSet = new Set(selectedFrameIds);
  const metricsByFrameId = new Map(frameMetrics.map((entry) => [entry.frameId, entry]));
  const selectedMetrics = frameMetrics.filter((entry) => selectedFrameIdSet.has(entry.frameId));
  const referenceDensityP50 =
    median(selectedMetrics.map((entry) => entry.metrics.lumaDensityPercentiles.p50)) ?? REFERENCE_DENSITY_FALLBACK;
  const referenceTexturalRangeP10P90 =
    median(selectedMetrics.map((entry) => entry.metrics.texturalDensityRangeP10P90)) ?? REFERENCE_RANGE_FALLBACK;
  const frameSuggestions: NegativeLabAutoDensityFrameSuggestion[] = [];
  const runWarnings = new Set<NegativeLabAutoDensityWarningCode>();
  const printCurveParameters = buildPrintCurveParameters(params);

  for (const frame of frameRows.filter((row) => selectedFrameIdSet.has(row.frameId))) {
    const metricEntry = metricsByFrameId.get(frame.frameId);
    if (metricEntry === undefined) {
      runWarnings.add('scan_metrics_unavailable');
      continue;
    }

    const metrics = metricEntry.metrics;
    const confidence = confidenceFromMetrics(metrics, referenceTexturalRangeP10P90);
    const exposureOffsetEv = snapExposure(
      clamp(
        (metrics.lumaDensityPercentiles.p50 - referenceDensityP50) * EXPOSURE_GAIN,
        -MAX_EXPOSURE_OFFSET_EV,
        MAX_EXPOSURE_OFFSET_EV,
      ),
    );
    const rangeDelta = referenceTexturalRangeP10P90 - metrics.texturalDensityRangeP10P90;
    const contrastDelta = round(clamp(rangeDelta * CONTRAST_GAIN, -MAX_CONTRAST_DELTA, MAX_CONTRAST_DELTA), 2);
    const contrastGrade =
      Math.abs(contrastDelta) < 0.04 ? 'hold' : contrastDelta > 0 ? 'lift_contrast' : 'soften_contrast';
    const castBalance = buildCastBalanceSuggestion(metrics, confidence, confidenceThreshold);
    const warningCodes = warningCodesFromMetrics(metrics, exposureOffsetEv, confidence, confidenceThreshold);
    if (castBalance.lowConfidence) warningCodes.push('cast_balance_low_confidence');
    for (const warningCode of warningCodes) runWarnings.add(warningCode);

    frameSuggestions.push({
      castBalanceSuggestion: castBalance.offset,
      confidence,
      contrastDelta,
      contrastGrade,
      exposureOffsetEv: confidence >= confidenceThreshold ? exposureOffsetEv : 0,
      frameId: frame.frameId,
      metricsAudit: {
        blueMedianDeviation: channelMedianDeviation(metrics, 'blue'),
        greenMedianDeviation: channelMedianDeviation(metrics, 'green'),
        lumaDensityP50: round(metrics.lumaDensityPercentiles.p50, 4),
        redMedianDeviation: channelMedianDeviation(metrics, 'red'),
        texturalDensityRangeP10P90: round(metrics.texturalDensityRangeP10P90, 4),
      },
      printCurveParameters,
      sourcePath: frame.sourcePath,
      state,
      warningCodes: [...new Set(warningCodes)].sort(),
    });
  }

  return parseNegativeLabAutoDensitySuggestionRun({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    confidenceThreshold,
    frameSuggestions,
    generatedFrom: 'src/utils/negativeLabAutoDensitySuggestions.ts',
    referenceDensityP50: round(referenceDensityP50, 4),
    referenceTexturalRangeP10P90: round(referenceTexturalRangeP10P90, 4),
    schemaVersion: NEGATIVE_LAB_AUTO_DENSITY_SUGGESTION_SCHEMA_VERSION,
    state,
    warningCodes: [...runWarnings].sort(),
  });
};
