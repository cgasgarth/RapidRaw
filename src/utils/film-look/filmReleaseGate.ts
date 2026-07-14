import Color from 'colorjs.io';

import {
  type FilmNativeAnalyticReportV1,
  type FilmValidationFixtureV1,
  filmNativeAnalyticReportV1Schema,
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
