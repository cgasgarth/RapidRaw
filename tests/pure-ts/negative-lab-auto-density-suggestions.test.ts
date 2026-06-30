import { describe, expect, test } from 'bun:test';
import type { NegativeLabPresetParams } from '../../src/schemas/negativeLabPresetCatalogSchemas.ts';
import { buildNegativeLabAutoDensitySuggestionRun } from '../../src/utils/negativeLabAutoDensitySuggestions.ts';
import { buildNegativeLabFrameHealthReport } from '../../src/utils/negativeLabFrameHealth.ts';
import { buildNegativeLabRollNormalizationPlan } from '../../src/utils/negativeLabRollNormalizationPlan.ts';
import {
  buildNegativeLabScanMetricsV1,
  type NegativeLabScanMetricPixel,
} from '../../src/utils/negativeLabScanMetrics.ts';

const params: NegativeLabPresetParams = {
  base_fog_strength: 0.72,
  black_point: 0.02,
  blue_weight: 1,
  contrast: 1.1,
  exposure: 0.1,
  green_weight: 1,
  red_weight: 1,
  white_point: 0.98,
};

const targetPaths = [
  '/synthetic/normal.tif',
  '/synthetic/dense.tif',
  '/synthetic/thin.tif',
  '/synthetic/low-key.tif',
  '/synthetic/high-key.tif',
  '/synthetic/flat.tif',
  '/synthetic/high-contrast.tif',
];

const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.92,
  baseScope: 'roll',
  cropStatusByFrameId: {},
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});

const frameIds = frameHealthReport.frames.map((frame) => frame.frameId);

const buildPixels = (p50: number, range: number, cast: { b: number; g: number; r: number }) =>
  Array.from({ length: 28 * 28 }, (_, index): NegativeLabScanMetricPixel => {
    const x = index % 28;
    const y = Math.floor(index / 28);
    const centeredRamp = (x + y) / 54 - 0.5;
    const lumaDensity = Math.max(0.03, p50 + centeredRamp * range);
    return {
      b: 10 ** -(lumaDensity + cast.b),
      g: 10 ** -(lumaDensity + cast.g),
      r: 10 ** -(lumaDensity + cast.r),
    };
  });

const syntheticFixtures = [
  { cast: { b: 0, g: 0, r: 0 }, label: 'normal', p50: 0.46, range: 0.32 },
  { cast: { b: 0.01, g: 0, r: -0.01 }, label: 'dense', p50: 0.82, range: 0.34 },
  { cast: { b: 0, g: 0, r: 0 }, label: 'thin', p50: 0.12, range: 0.3 },
  { cast: { b: 0.03, g: 0, r: -0.02 }, label: 'low-key', p50: 0.68, range: 0.24 },
  { cast: { b: -0.02, g: 0, r: 0.03 }, label: 'high-key', p50: 0.28, range: 0.26 },
  { cast: { b: 0, g: 0, r: 0 }, label: 'flat', p50: 0.45, range: 0.01 },
  { cast: { b: 0.04, g: 0, r: -0.03 }, label: 'high-contrast', p50: 0.47, range: 0.78 },
] as const;

const frameMetrics = syntheticFixtures.map((fixture, index) => ({
  frameId: frameIds[index] ?? `negative-lab-frame-${index + 1}`,
  metrics: buildNegativeLabScanMetricsV1({
    imageHeight: 28,
    imageWidth: 28,
    insetFraction: 0.08,
    pixels: buildPixels(fixture.p50, fixture.range, fixture.cast),
  }),
  sourcePath: targetPaths[index] ?? `/synthetic/${fixture.label}.tif`,
}));

describe('negative lab auto density suggestions', () => {
  test('produces bounded deterministic suggestions for synthetic density classes', () => {
    const run = buildNegativeLabAutoDensitySuggestionRun({
      frameMetrics,
      frameRows: frameHealthReport.frames,
      params,
      selectedFrameIds: frameIds,
    });
    const repeat = buildNegativeLabAutoDensitySuggestionRun({
      frameMetrics,
      frameRows: frameHealthReport.frames,
      params,
      selectedFrameIds: frameIds,
    });

    expect(run).toEqual(repeat);
    expect(run.frameSuggestions).toHaveLength(7);
    for (const suggestion of run.frameSuggestions) {
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
      expect(suggestion.exposureOffsetEv).toBeGreaterThanOrEqual(-0.8);
      expect(suggestion.exposureOffsetEv).toBeLessThanOrEqual(0.8);
      expect(suggestion.contrastDelta).toBeGreaterThanOrEqual(-0.35);
      expect(suggestion.contrastDelta).toBeLessThanOrEqual(0.35);
      expect(suggestion.printCurveParameters?.curveStrength).toBe(4.4);
    }

    const dense = run.frameSuggestions[1];
    const thin = run.frameSuggestions[2];
    const flat = run.frameSuggestions[5];
    const highContrast = run.frameSuggestions[6];
    expect(dense?.exposureOffsetEv).toBeGreaterThan(0);
    expect(thin?.exposureOffsetEv).toBeLessThan(0);
    expect(flat?.warningCodes).toContain('confidence_below_apply_threshold');
    expect(flat?.contrastGrade).toBe('lift_contrast');
    expect(highContrast?.contrastGrade).toBe('soften_contrast');
  });

  test('does not force every frame to neutral gray', () => {
    const run = buildNegativeLabAutoDensitySuggestionRun({
      frameMetrics,
      frameRows: frameHealthReport.frames,
      params,
      selectedFrameIds: frameIds,
    });
    const castSuggestions = run.frameSuggestions.filter((suggestion) => suggestion.castBalanceSuggestion !== null);
    const untouchedSuggestions = run.frameSuggestions.filter((suggestion) => suggestion.castBalanceSuggestion === null);

    expect(castSuggestions.length).toBeGreaterThan(0);
    expect(untouchedSuggestions.length).toBeGreaterThan(0);
  });

  test('roll normalization keeps suggestions suggested-only until accepted into a dry-run plan', () => {
    const suggestedPlan = buildNegativeLabRollNormalizationPlan({
      anchorFrameIds: [frameIds[0] ?? 'negative-lab-frame-1'],
      baselineExposure: params.exposure,
      frameHealthReport,
      frameScanMetrics: frameMetrics,
      mode: 'density_and_balance',
      params,
      preserveCreativeAdjustments: true,
      selectedFrameIds: frameIds,
    });
    const acceptedRun = buildNegativeLabAutoDensitySuggestionRun({
      acceptedDryRunPlanHash: 'fnv1a32:1234abcd',
      acceptedDryRunPlanId: 'negative_lab_batch_plan_1234abcd',
      frameMetrics,
      frameRows: frameHealthReport.frames,
      params,
      selectedFrameIds: frameIds,
      state: 'accepted_into_plan',
    });
    const acceptedPlan = buildNegativeLabRollNormalizationPlan({
      anchorFrameIds: [frameIds[0] ?? 'negative-lab-frame-1'],
      autoDensitySuggestionRun: acceptedRun,
      baselineExposure: params.exposure,
      frameHealthReport,
      mode: 'density_and_balance',
      params,
      preserveCreativeAdjustments: true,
      selectedFrameIds: frameIds,
    });

    expect(suggestedPlan.autoDensitySuggestionRun?.state).toBe('suggested_only');
    expect(suggestedPlan.exposureOverrides.overrides.length).toBeGreaterThan(0);
    expect(acceptedPlan.autoDensitySuggestionRun?.state).toBe('accepted_into_plan');
    expect(acceptedPlan.autoDensitySuggestionRun?.acceptedDryRunPlanHash).toBe('fnv1a32:1234abcd');
  });
});
