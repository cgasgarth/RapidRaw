import Color from 'colorjs.io';

import {
  type FilmNativeAnalyticReportV1,
  type FilmNativeStochasticOpticalReportV1,
  type FilmValidationFixtureV1,
  filmNativeAnalyticReportV1Schema,
  filmNativeStochasticOpticalReportV1Schema,
  filmValidationFixtureV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';
import { classifyLinearRgbGamut, type GamutClassification } from '../color/runtime/gamutMappingRuntime';
import { calculateDeltaE00, type LabColor } from '../deltaE00';

export interface FilmReleaseGateResult {
  failures: string[];
  gamutClassifications: Record<GamutClassification, number>;
  maxIdentityDeltaE00: number;
  passed: boolean;
}

export interface FilmStochasticOpticalReleaseGateResult {
  densityVarianceRatio: number;
  failures: string[];
  passed: boolean;
}

const ap1ToLab = (rgb: readonly [number, number, number]): LabColor => {
  const [l, a, b] = new Color('acescg', [...rgb]).to('lab').coords;
  if (![l, a, b].every((value) => typeof value === 'number' && Number.isFinite(value)))
    throw new Error('film_release_gate_non_finite_lab');
  return { a: a ?? 0, b: b ?? 0, l: l ?? 0 };
};

const countComponents = (samples: FilmNativeAnalyticReportV1['samples'], predicate: (value: number) => boolean) =>
  samples.reduce((count, sample) => count + sample.fullMixOutput.filter(predicate).length, 0);
const isNormalizedRgb = (rgb: readonly number[]) => rgb.every((value) => value >= 0 && value <= 1);

export const evaluateFilmNativeReleaseGate = (rawFixture: unknown, rawReport: unknown): FilmReleaseGateResult => {
  const fixture: FilmValidationFixtureV1 = filmValidationFixtureV1Schema.parse(rawFixture);
  const report: FilmNativeAnalyticReportV1 = filmNativeAnalyticReportV1Schema.parse(rawReport);
  const failures = [...report.failures];
  const profileRef = fixture.render.profileRefs[0];
  if (
    report.fixtureId !== fixture.id ||
    report.sourceSha256 !== fixture.source.sha256 ||
    profileRef === undefined ||
    JSON.stringify(report.profileRef) !== JSON.stringify(profileRef)
  ) {
    failures.push('film_release_identity_mismatch');
  }
  if (report.postFilmDomain !== fixture.input.domain) failures.push('film_release_comparison_domain_mismatch');
  if (report.maxAbs > fixture.thresholds.maxAbs) failures.push('max_abs_threshold_failed');
  if (report.rmse > fixture.thresholds.rmse) failures.push('rmse_threshold_failed');
  if (report.neutralAxisDrift > fixture.thresholds.neutralAxisDrift) failures.push('neutral_axis_threshold_failed');
  if (report.monotonicViolationCount > 0) failures.push('neutral_response_not_monotone');

  let maxIdentityDeltaE00 = 0;
  const gamutClassifications: Record<GamutClassification, number> = {
    high_component: 0,
    in_gamut: 0,
    mixed_out_of_gamut: 0,
    negative_component: 0,
  };
  for (const sample of report.samples) {
    if (
      isNormalizedRgb(sample.input) &&
      isNormalizedRgb(sample.disabledOutput) &&
      isNormalizedRgb(sample.mixZeroOutput)
    ) {
      const inputLab = ap1ToLab(sample.input);
      maxIdentityDeltaE00 = Math.max(
        maxIdentityDeltaE00,
        calculateDeltaE00(inputLab, ap1ToLab(sample.disabledOutput)),
        calculateDeltaE00(inputLab, ap1ToLab(sample.mixZeroOutput)),
      );
    }
    gamutClassifications[classifyLinearRgbGamut(sample.fullMixOutput)] += 1;
  }
  if (maxIdentityDeltaE00 > fixture.thresholds.identityDeltaE00) failures.push('identity_delta_e00_threshold_failed');
  if (countComponents(report.samples, (value) => value < 0) !== report.negativeComponentCount)
    failures.push('negative_component_count_mismatch');
  if (countComponents(report.samples, (value) => value > 1) !== report.highComponentCount)
    failures.push('high_component_count_mismatch');
  if (!report.passed) failures.push('native_analytic_gate_failed');

  const uniqueFailures = [...new Set(failures)];
  return {
    failures: uniqueFailures,
    gamutClassifications,
    maxIdentityDeltaE00,
    passed: uniqueFailures.length === 0,
  };
};

export const evaluateFilmStochasticOpticalReleaseGate = (
  rawFixture: unknown,
  rawReport: unknown,
): FilmStochasticOpticalReleaseGateResult => {
  const fixture = filmValidationFixtureV1Schema.parse(rawFixture);
  const report: FilmNativeStochasticOpticalReportV1 = filmNativeStochasticOpticalReportV1Schema.parse(rawReport);
  const failures = [...report.failures];
  const profileRef = fixture.render.profileRefs[0];
  if (
    report.fixtureId !== fixture.id ||
    report.sourceSha256 !== fixture.source.sha256 ||
    profileRef === undefined ||
    JSON.stringify(report.profileRef) !== JSON.stringify(profileRef) ||
    report.postFilmDomain !== fixture.input.domain
  )
    failures.push('film_stochastic_optical_identity_mismatch');

  const { grain, optical } = report;
  const thresholds = fixture.thresholds;
  if (grain.deterministicHash !== grain.repeatHash) failures.push('grain_repeat_hash_mismatch');
  if (grain.tileMaxAbs > thresholds.grainRepeatTolerance) failures.push('grain_tile_continuity_failed');
  if (grain.meanResidual.some((value) => Math.abs(value) > thresholds.grainMeanDrift))
    failures.push('grain_mean_drift_failed');
  if (
    grain.varianceByChannel.some((value) => value < thresholds.grainVarianceMin || value > thresholds.grainVarianceMax)
  )
    failures.push('grain_variance_bounds_failed');
  if (
    [...grain.channelCorrelation, ...grain.adjacentCorrelation].some(
      (value) => value < thresholds.grainCorrelationMin || value > thresholds.grainCorrelationMax,
    )
  )
    failures.push('grain_correlation_bounds_failed');
  if (
    grain.frequencyEnergyRatio.some(
      (value) => value < thresholds.grainFrequencyEnergyMin || value > thresholds.grainFrequencyEnergyMax,
    )
  )
    failures.push('grain_frequency_energy_failed');
  const densityMin = Math.min(...grain.densityVariance);
  const densityMax = Math.max(...grain.densityVariance);
  const densityVarianceRatio = densityMax / Math.max(densityMin, Number.EPSILON);
  if (densityVarianceRatio < thresholds.grainDensityVarianceRatioMin) failures.push('grain_density_selectivity_failed');

  if (optical.bypassMaxAbs > thresholds.grainRepeatTolerance) failures.push('optical_bypass_failed');
  if (optical.subthresholdLeakage > thresholds.opticalLeakage) failures.push('optical_subthreshold_leakage_failed');
  if (
    optical.halationEnergy <= 0 ||
    optical.bloomEnergy <= 0 ||
    optical.halationEnergy > thresholds.opticalEnergyMax ||
    optical.bloomEnergy > thresholds.opticalEnergyMax
  )
    failures.push('optical_energy_bounds_failed');
  if (optical.halationRedRatio < thresholds.opticalHalationRedRatioMin)
    failures.push('optical_halation_selectivity_failed');
  if (optical.bloomNeutralDrift > thresholds.opticalBloomNeutralDrift) failures.push('optical_bloom_neutrality_failed');
  if (optical.halationWeightedRadiusPx <= 0 || optical.bloomWeightedRadiusPx <= optical.halationWeightedRadiusPx)
    failures.push('optical_radius_support_failed');
  if (optical.continuityMaxStep > thresholds.opticalContinuityMaxStep) failures.push('optical_continuity_failed');
  if (!report.passed) failures.push('native_stochastic_optical_gate_failed');

  const uniqueFailures = [...new Set(failures)];
  return { densityVarianceRatio, failures: uniqueFailures, passed: uniqueFailures.length === 0 };
};
