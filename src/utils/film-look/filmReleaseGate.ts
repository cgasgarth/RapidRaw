import Color from 'colorjs.io';

import {
  type FilmNativeAnalyticReportV1,
  type FilmNativeStochasticOpticalReportV1,
  type FilmOutputGamutReportV1,
  type FilmReleaseApprovalV1,
  type FilmValidationFixtureV1,
  filmAnalyticVectorSetV1Schema,
  filmNativeAnalyticReportV1Schema,
  filmNativeStochasticOpticalReportV1Schema,
  filmOutputGamutReportV1Schema,
  filmReleaseApprovalV1Schema,
  filmValidationFixtureV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';
import {
  applyPerceptualOklchChromaReduceReference,
  applyRelativeColorimetricClipFallback,
  classifyLinearRgbGamut,
  type GamutClassification,
  type GamutMappingDestination,
} from '../color/runtime/gamutMappingRuntime';
import { calculateDeltaE00, type LabColor } from '../deltaE00';

export interface FilmReleaseGateResult {
  colorimetricPatches: FilmColorimetricPatchResult[];
  failures: string[];
  gamutClassifications: Record<GamutClassification, number>;
  maxIdentityDeltaE00: number;
  maxReferenceDeltaE00: number;
  meanReferenceDeltaE00: number;
  neutralChromaMax: number;
  passed: boolean;
}

export interface FilmColorimetricPatchResult {
  comparisonDomain: 'lab_d50_deltae00' | 'extended_ap1_range_only';
  deltaC: number | null;
  deltaE00: number | null;
  deltaL: number | null;
  hueAngleDeltaDeg: number | null;
  id: string;
}

export interface FilmOutputGamutGateResult {
  failures: string[];
  passed: boolean;
}

export interface FilmBaselineApprovalGateResult {
  failures: string[];
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

const labChroma = ({ a, b }: LabColor) => Math.hypot(a, b);
const labHueDeg = ({ a, b }: LabColor) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const hueAngleDeltaDeg = (left: number, right: number) => {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
};
const isNeutral = (rgb: readonly [number, number, number]) => Math.max(...rgb) - Math.min(...rgb) <= 1e-9;

const digestJson = async (value: unknown): Promise<`sha256:${string}`> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const countComponents = (samples: FilmNativeAnalyticReportV1['samples'], predicate: (value: number) => boolean) =>
  samples.reduce((count, sample) => count + sample.fullMixOutput.filter(predicate).length, 0);
const isNormalizedRgb = (rgb: readonly number[]) => rgb.every((value) => value >= 0 && value <= 1);

export const evaluateFilmNativeReleaseGate = (
  rawFixture: unknown,
  rawVectors: unknown,
  rawReport: unknown,
): FilmReleaseGateResult => {
  const fixture: FilmValidationFixtureV1 = filmValidationFixtureV1Schema.parse(rawFixture);
  const vectors = filmAnalyticVectorSetV1Schema.parse(rawVectors);
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
  if (
    vectors.workingSpace !== fixture.input.domain ||
    JSON.stringify(vectors.profileRef) !== JSON.stringify(profileRef) ||
    vectors.samples.length !== report.samples.length ||
    vectors.samples.some((sample, index) => {
      const observed = report.samples[index];
      return (
        observed === undefined ||
        observed.id !== sample.id ||
        JSON.stringify(observed.input) !== JSON.stringify(sample.input)
      );
    })
  )
    failures.push('film_release_vector_set_mismatch');
  if (report.maxAbs > fixture.thresholds.maxAbs) failures.push('max_abs_threshold_failed');
  if (report.rmse > fixture.thresholds.rmse) failures.push('rmse_threshold_failed');
  if (report.neutralAxisDrift > fixture.thresholds.neutralAxisDrift) failures.push('neutral_axis_threshold_failed');
  if (report.monotonicViolationCount > 0) failures.push('neutral_response_not_monotone');
  if (report.modelReferenceMaxAbs > fixture.thresholds.modelReferenceMaxAbs)
    failures.push('model_reference_max_abs_failed');
  if (report.modelReferenceRmse > fixture.thresholds.modelReferenceRmse) failures.push('model_reference_rmse_failed');
  if (report.previewExportMaxAbs > fixture.thresholds.previewExportMaxAbs)
    failures.push('preview_export_max_abs_failed');
  if (report.previewExportRmse > fixture.thresholds.previewExportRmse) failures.push('preview_export_rmse_failed');
  if (report.previewPostFilmHash !== report.exportPostFilmHash) failures.push('preview_export_post_film_hash_mismatch');
  if (
    report.executionPlan.modelAbiVersion.trim() === '' ||
    report.executionPlan.backendAbiVersion.trim() === '' ||
    report.executionPlan.stageOrder.length === 0
  )
    failures.push('film_execution_identity_missing');

  let maxIdentityDeltaE00 = 0;
  let neutralChromaMax = 0;
  const colorimetricPatches: FilmColorimetricPatchResult[] = [];
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
    if (isNormalizedRgb(sample.fullMixOutput) && isNormalizedRgb(sample.modelReferenceOutput)) {
      const observedLab = ap1ToLab(sample.fullMixOutput);
      const referenceLab = ap1ToLab(sample.modelReferenceOutput);
      const observedChroma = labChroma(observedLab);
      const referenceChroma = labChroma(referenceLab);
      colorimetricPatches.push({
        comparisonDomain: 'lab_d50_deltae00',
        deltaC: Math.abs(observedChroma - referenceChroma),
        deltaE00: calculateDeltaE00(referenceLab, observedLab),
        deltaL: Math.abs(observedLab.l - referenceLab.l),
        hueAngleDeltaDeg: hueAngleDeltaDeg(labHueDeg(observedLab), labHueDeg(referenceLab)),
        id: sample.id,
      });
      if (isNeutral(sample.input)) neutralChromaMax = Math.max(neutralChromaMax, observedChroma);
    } else {
      colorimetricPatches.push({
        comparisonDomain: 'extended_ap1_range_only',
        deltaC: null,
        deltaE00: null,
        deltaL: null,
        hueAngleDeltaDeg: null,
        id: sample.id,
      });
    }
    gamutClassifications[classifyLinearRgbGamut(sample.fullMixOutput)] += 1;
  }
  const referenceDeltaE00 = colorimetricPatches.flatMap(({ deltaE00 }) => (deltaE00 === null ? [] : [deltaE00]));
  const maxReferenceDeltaE00 = Math.max(0, ...referenceDeltaE00);
  const meanReferenceDeltaE00 =
    referenceDeltaE00.reduce((sum, deltaE00) => sum + deltaE00, 0) / Math.max(referenceDeltaE00.length, 1);
  if (maxReferenceDeltaE00 > fixture.thresholds.referenceDeltaE00Max) failures.push('reference_delta_e00_max_failed');
  if (meanReferenceDeltaE00 > fixture.thresholds.referenceDeltaE00Mean)
    failures.push('reference_delta_e00_mean_failed');
  if (neutralChromaMax > fixture.thresholds.neutralChromaMax) failures.push('neutral_chroma_failed');
  if (maxIdentityDeltaE00 > fixture.thresholds.identityDeltaE00) failures.push('identity_delta_e00_threshold_failed');
  if (countComponents(report.samples, (value) => value < 0) !== report.negativeComponentCount)
    failures.push('negative_component_count_mismatch');
  if (countComponents(report.samples, (value) => value > 1) !== report.highComponentCount)
    failures.push('high_component_count_mismatch');
  if (!report.passed) failures.push('native_analytic_gate_failed');

  const uniqueFailures = [...new Set(failures)];
  return {
    colorimetricPatches,
    failures: uniqueFailures,
    gamutClassifications,
    maxIdentityDeltaE00,
    maxReferenceDeltaE00,
    meanReferenceDeltaE00,
    neutralChromaMax,
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

const OUTPUT_COLOR_SPACE: Record<GamutMappingDestination, 'p3-linear' | 'srgb-linear'> = {
  display_p3: 'p3-linear',
  srgb: 'srgb-linear',
};

export const buildFilmOutputGamutReport = async (
  rawFixture: unknown,
  rawReport: unknown,
): Promise<FilmOutputGamutReportV1> => {
  const fixture = filmValidationFixtureV1Schema.parse(rawFixture);
  const report = filmNativeAnalyticReportV1Schema.parse(rawReport);
  const profileRef = fixture.render.profileRefs[0];
  if (profileRef === undefined) throw new Error('film_output_gamut_profile_missing');
  const requiredTargets = ['srgb', 'display_p3'] as const;
  if (requiredTargets.some((target) => !fixture.render.outputProfiles.includes(target)))
    throw new Error('film_output_gamut_target_missing');

  const targets = await Promise.all(
    requiredTargets.map(async (target) => {
      let hardClipChangedChannelCount = 0;
      let maxHueAngleDriftDeg = 0;
      let maxNeutralAxisDrift = 0;
      let maxPerceptualDeltaL1 = 0;
      let postMapOutOfGamutChannelCount = 0;
      let preMapOutOfGamutChannelCount = 0;
      const samples = report.samples.map((sample) => {
        const coords = new Color('acescg', [...sample.fullMixOutput]).to(OUTPUT_COLOR_SPACE[target]).coords;
        const preMapLinearRgb = coords.map((value) => value ?? Number.NaN) as [number, number, number];
        if (!preMapLinearRgb.every(Number.isFinite)) throw new Error('film_output_gamut_non_finite_transform');
        const clip = applyRelativeColorimetricClipFallback(preMapLinearRgb);
        const mapped = applyPerceptualOklchChromaReduceReference(preMapLinearRgb, target);
        preMapOutOfGamutChannelCount += clip.outOfGamutChannelCount;
        hardClipChangedChannelCount += preMapLinearRgb.filter(
          (value, index) => Math.abs(value - (clip.clippedLinearRgb[index] ?? value)) > 1e-12,
        ).length;
        postMapOutOfGamutChannelCount += mapped.perceptualLinearRgb.filter(
          (value) => value < -1e-12 || value > 1 + 1e-12,
        ).length;
        maxHueAngleDriftDeg = Math.max(maxHueAngleDriftDeg, mapped.hueAngleDriftDeg);
        maxNeutralAxisDrift = Math.max(maxNeutralAxisDrift, mapped.neutralAxisDrift);
        maxPerceptualDeltaL1 = Math.max(maxPerceptualDeltaL1, mapped.perceptualDeltaL1);
        return { id: sample.id, mappedLinearRgb: mapped.perceptualLinearRgb, preMapLinearRgb };
      });
      return {
        hardClipChangedChannelCount,
        maxHueAngleDriftDeg,
        maxNeutralAxisDrift,
        maxPerceptualDeltaL1,
        outputHash: await digestJson({ samples, target }),
        postMapOutOfGamutChannelCount,
        preMapOutOfGamutChannelCount,
        samples,
        target,
      };
    }),
  );

  return filmOutputGamutReportV1Schema.parse({
    contract: 'rapidraw.film_output_gamut_report.v1',
    fixtureId: fixture.id,
    postFilmHash: report.deterministicHash,
    profileRef,
    sourceSha256: fixture.source.sha256,
    targets,
  });
};

export const evaluateFilmOutputGamutGate = (
  rawFixture: unknown,
  rawAnalyticReport: unknown,
  rawOutputReport: unknown,
): FilmOutputGamutGateResult => {
  const fixture = filmValidationFixtureV1Schema.parse(rawFixture);
  const analytic = filmNativeAnalyticReportV1Schema.parse(rawAnalyticReport);
  const output = filmOutputGamutReportV1Schema.parse(rawOutputReport);
  const failures: string[] = [];
  if (
    output.fixtureId !== fixture.id ||
    output.sourceSha256 !== fixture.source.sha256 ||
    output.postFilmHash !== analytic.deterministicHash ||
    JSON.stringify(output.profileRef) !== JSON.stringify(fixture.render.profileRefs[0])
  )
    failures.push('film_output_gamut_identity_mismatch');
  if (output.targets.some(({ postMapOutOfGamutChannelCount }) => postMapOutOfGamutChannelCount !== 0))
    failures.push('film_output_gamut_mapper_left_invalid_components');
  if (output.targets.some(({ maxHueAngleDriftDeg }) => maxHueAngleDriftDeg > fixture.thresholds.gamutHueDriftMax))
    failures.push('film_output_gamut_hue_drift_failed');
  if (
    output.targets.some(({ maxNeutralAxisDrift }) => maxNeutralAxisDrift > fixture.thresholds.gamutNeutralAxisDriftMax)
  )
    failures.push('film_output_gamut_neutral_drift_failed');
  if (
    output.targets.some(
      ({ maxPerceptualDeltaL1 }) => maxPerceptualDeltaL1 > fixture.thresholds.gamutPerceptualDeltaL1Max,
    )
  )
    failures.push('film_output_gamut_perceptual_delta_failed');
  if (new Set(output.targets.map(({ outputHash }) => outputHash)).size !== output.targets.length)
    failures.push('film_output_gamut_targets_not_distinct');
  if (output.targets.some(({ samples }) => samples.length !== analytic.samples.length))
    failures.push('film_output_gamut_sample_count_mismatch');
  return { failures, passed: failures.length === 0 };
};

export const evaluateFilmBaselineApprovalGate = (
  rawFixture: unknown,
  rawAnalyticReport: unknown,
  rawStochasticOpticalReport: unknown,
  rawOutputGamutReport: unknown,
  rawApproval: unknown,
): FilmBaselineApprovalGateResult => {
  const fixture = filmValidationFixtureV1Schema.parse(rawFixture);
  const analytic = filmNativeAnalyticReportV1Schema.parse(rawAnalyticReport);
  const stochastic = filmNativeStochasticOpticalReportV1Schema.parse(rawStochasticOpticalReport);
  const output = filmOutputGamutReportV1Schema.parse(rawOutputGamutReport);
  const approval: FilmReleaseApprovalV1 = filmReleaseApprovalV1Schema.parse(rawApproval);
  const failures: string[] = [];
  if (
    approval.fixtureId !== fixture.id ||
    approval.sourceSha256 !== fixture.source.sha256 ||
    JSON.stringify(approval.profileRef) !== JSON.stringify(fixture.render.profileRefs[0])
  )
    failures.push('film_baseline_approval_identity_mismatch');
  if (
    approval.executionIdentity.modelAbiVersion !== analytic.executionPlan.modelAbiVersion ||
    approval.executionIdentity.backendAbiVersion !== analytic.executionPlan.backendAbiVersion ||
    approval.executionIdentity.planSha256 !== analytic.executionPlan.planSha256
  )
    failures.push('film_baseline_execution_identity_mismatch');
  if (
    JSON.stringify(approval.validationIdentity.viewTransforms) !== JSON.stringify(fixture.render.viewTransforms) ||
    JSON.stringify(approval.validationIdentity.outputProfiles) !== JSON.stringify(fixture.render.outputProfiles) ||
    JSON.stringify(approval.validationIdentity.bitDepths) !== JSON.stringify(fixture.render.bitDepths) ||
    JSON.stringify(approval.validationIdentity.proofCrops) !== JSON.stringify(fixture.render.proofCrops)
  )
    failures.push('film_baseline_validation_identity_mismatch');
  if (approval.approvedBaselines.postFilmHash !== analytic.deterministicHash)
    failures.push('film_post_film_baseline_unapproved');
  if (approval.approvedBaselines.grainHash !== stochastic.grain.deterministicHash)
    failures.push('film_grain_baseline_unapproved');
  const outputHashes = Object.fromEntries(output.targets.map(({ outputHash, target }) => [target, outputHash]));
  if (
    approval.approvedBaselines.outputGamutHashes.srgb !== outputHashes['srgb'] ||
    approval.approvedBaselines.outputGamutHashes.displayP3 !== outputHashes['display_p3']
  )
    failures.push('film_output_gamut_baseline_unapproved');
  return { failures, passed: failures.length === 0 };
};
