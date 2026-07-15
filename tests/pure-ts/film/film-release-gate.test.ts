import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import {
  buildFilmOutputGamutReport,
  evaluateFilmBaselineApprovalGate,
  evaluateFilmNativeReleaseGate,
  evaluateFilmOutputGamutGate,
  evaluateFilmStochasticOpticalReleaseGate,
} from '../../../src/utils/film-look/filmReleaseGate';

const manifestPath = resolve(
  import.meta.dir,
  '../../../fixtures/film/validation/reference-film-validation-manifest-v1.json',
);
const fixture = await Bun.file(manifestPath).json();
const approval = await Bun.file(
  resolve(import.meta.dir, '../../../fixtures/film/validation/reference-film-release-approval-v1.json'),
).json();
const report = {
  contract: 'rapidraw.film_native_analytic_report.v1',
  fixtureId: 'film-validation.reference-analytic.v1',
  sourceSha256: 'sha256:61b76551a57e867ebdd8b5e32a20238fed84072ea36a20595627b53ee239deac',
  profileRef: {
    id: 'rapidraw.reference_film.v1',
    version: '1',
    contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
  },
  postFilmDomain: 'acescg_linear_v1',
  maxAbs: 0,
  rmse: 0,
  neutralAxisDrift: 0,
  monotonicViolationCount: 0,
  negativeComponentCount: 1,
  highComponentCount: 1,
  deterministicHash: `sha256:${'a'.repeat(64)}`,
  executionPlan: {
    backendAbiVersion: 'film_backend_abi_v1',
    modelAbiVersion: 'film_model_abi_v1',
    planSha256: 'sha256:plan:reference',
    postFilmHash: 'fnv1a32:1234abcd',
    stageOrder: ['capture_optical_scatter', 'post_film_tap'],
  },
  modelReferenceMaxAbs: 0,
  modelReferenceRmse: 0,
  samples: [
    {
      id: 'neutral',
      input: [0.18, 0.18, 0.18],
      disabledOutput: [0.18, 0.18, 0.18],
      mixZeroOutput: [0.18, 0.18, 0.18],
      fullMixOutput: [0.2, 0.2, 0.2],
      modelReferenceOutput: [0.2, 0.2, 0.2],
    },
    {
      id: 'extended',
      input: [-0.1, 0.2, 1.2],
      disabledOutput: [-0.1, 0.2, 1.2],
      mixZeroOutput: [-0.1, 0.2, 1.2],
      fullMixOutput: [-0.08, 0.3, 1.1],
      modelReferenceOutput: [-0.08, 0.3, 1.1],
    },
  ],
  passed: true,
  failures: [],
};
const stochasticOpticalReport = {
  contract: 'rapidraw.film_native_stochastic_optical_report.v1',
  fixtureId: report.fixtureId,
  sourceSha256: report.sourceSha256,
  profileRef: report.profileRef,
  postFilmDomain: 'acescg_linear_v1',
  grain: {
    deterministicHash: 'sha256:70cfd798c9bb81646dbdc184a76af363ed73466dced1e62f636bf77d685f8519',
    repeatHash: 'sha256:70cfd798c9bb81646dbdc184a76af363ed73466dced1e62f636bf77d685f8519',
    meanResidual: [0.000035848, 0.000011693388, 0.000033934597],
    varianceByChannel: [8.3490517e-7, 7.366045e-7, 0.0000010457491],
    densityVariance: [2.4966462e-7, 8.724196e-7, 0.000031577856],
    channelCorrelation: [0.3699198, 0.19289131, 0.3015372],
    adjacentCorrelation: [0.057384342, 0.049936336, 0.07385361],
    frequencyEnergyRatio: [0.9430043, 0.953403, 0.9278943],
    tileMaxAbs: 0,
  },
  optical: {
    supportedSubset: 'preblurred_scatter_kernel_v1',
    bypassMaxAbs: 0,
    subthresholdLeakage: 0,
    halationEnergy: 0.3551881,
    bloomEnergy: 0.28103322,
    halationRedRatio: 1.2560973,
    bloomNeutralDrift: 0.017999649,
    halationWeightedRadiusPx: 4.52,
    bloomWeightedRadiusPx: 12,
    continuityMaxStep: 0.028938796,
  },
  passed: true,
  failures: [],
};

describe('Film native analytic release gate', () => {
  test('accepts identity-safe native output and reuses gamut classification', () => {
    expect(evaluateFilmNativeReleaseGate(fixture, report)).toEqual({
      colorimetricPatches: [
        {
          comparisonDomain: 'lab_d50_deltae00',
          deltaC: 0,
          deltaE00: 0,
          deltaL: 0,
          hueAngleDeltaDeg: 0,
          id: 'neutral',
        },
        {
          comparisonDomain: 'extended_ap1_range_only',
          deltaC: null,
          deltaE00: null,
          deltaL: null,
          hueAngleDeltaDeg: null,
          id: 'extended',
        },
      ],
      failures: [],
      gamutClassifications: {
        high_component: 0,
        in_gamut: 1,
        mixed_out_of_gamut: 1,
        negative_component: 0,
      },
      maxIdentityDeltaE00: 0,
      maxReferenceDeltaE00: 0,
      meanReferenceDeltaE00: 0,
      neutralChromaMax: 0,
      passed: true,
    });
  });

  test('fails closed on perceptual identity drift and dishonest range counts', () => {
    const result = evaluateFilmNativeReleaseGate(fixture, {
      ...report,
      negativeComponentCount: 0,
      samples: [{ ...report.samples[0], disabledOutput: [0.25, 0.18, 0.18] }, report.samples[1]],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain('identity_delta_e00_threshold_failed');
    expect(result.failures).toContain('negative_component_count_mismatch');
  });

  test('records every color patch and fails model-reference perceptual drift', () => {
    const result = evaluateFilmNativeReleaseGate(fixture, {
      ...report,
      samples: [{ ...report.samples[0], fullMixOutput: [0.35, 0.2, 0.2] }, report.samples[1]],
    });
    expect(result.colorimetricPatches).toHaveLength(2);
    expect(result.passed).toBeFalse();
    expect(result.failures).toContain('reference_delta_e00_max_failed');
    expect(result.failures).toContain('reference_delta_e00_mean_failed');
    expect(result.failures).toContain('neutral_chroma_failed');
  });
});

describe('Film stochastic and optical release gate', () => {
  test('accepts deterministic production grain and bounded optical subset evidence', () => {
    const result = evaluateFilmStochasticOpticalReleaseGate(fixture, stochasticOpticalReport);
    expect(result.passed).toBeTrue();
    expect(result.failures).toEqual([]);
    expect(result.densityVarianceRatio).toBeGreaterThan(100);
  });

  test('fails closed on repeat drift, subthreshold leakage, and radius inversion', () => {
    const result = evaluateFilmStochasticOpticalReleaseGate(fixture, {
      ...stochasticOpticalReport,
      grain: { ...stochasticOpticalReport.grain, repeatHash: `sha256:${'b'.repeat(64)}` },
      optical: {
        ...stochasticOpticalReport.optical,
        bloomWeightedRadiusPx: 2,
        subthresholdLeakage: 0.02,
      },
    });
    expect(result.passed).toBeFalse();
    expect(result.failures).toContain('grain_repeat_hash_mismatch');
    expect(result.failures).toContain('optical_subthreshold_leakage_failed');
    expect(result.failures).toContain('optical_radius_support_failed');
  });
});

describe('Film output gamut and baseline approval gates', () => {
  test('keeps the post-Film hash invariant while producing distinct mapped output receipts', async () => {
    const output = await buildFilmOutputGamutReport(fixture, report);
    expect(output.targets.map(({ target }) => target).sort()).toEqual(['display_p3', 'srgb']);
    expect(output.targets.every(({ postMapOutOfGamutChannelCount }) => postMapOutOfGamutChannelCount === 0)).toBeTrue();
    expect(new Set(output.targets.map(({ outputHash }) => outputHash)).size).toBe(2);
    expect(evaluateFilmOutputGamutGate(fixture, report, output)).toEqual({ failures: [], passed: true });
  });

  test('fails closed on hidden clipping, output-domain aliasing, and excessive perceptual drift', async () => {
    const output = await buildFilmOutputGamutReport(fixture, report);
    const first = output.targets[0];
    const second = output.targets[1];
    if (first === undefined || second === undefined) throw new Error('Expected governed output targets.');
    const result = evaluateFilmOutputGamutGate(fixture, report, {
      ...output,
      targets: [
        {
          ...first,
          maxHueAngleDriftDeg: fixture.thresholds.gamutHueDriftMax + 1,
          outputHash: second.outputHash,
          postMapOutOfGamutChannelCount: 1,
        },
        second,
      ],
    });
    expect(result.passed).toBeFalse();
    expect(result.failures).toContain('film_output_gamut_mapper_left_invalid_components');
    expect(result.failures).toContain('film_output_gamut_hue_drift_failed');
    expect(result.failures).toContain('film_output_gamut_targets_not_distinct');
  });

  test('rejects unapproved baselines and production pixel changes without #5030 proof', () => {
    const approvedAnalytic = {
      ...report,
      deterministicHash: approval.approvedBaselines.postFilmHash,
    };
    expect(evaluateFilmBaselineApprovalGate(fixture, approvedAnalytic, stochasticOpticalReport, approval)).toEqual({
      failures: [],
      passed: true,
    });
    expect(
      evaluateFilmBaselineApprovalGate(
        fixture,
        { ...approvedAnalytic, deterministicHash: `sha256:${'f'.repeat(64)}` },
        stochasticOpticalReport,
        approval,
      ).failures,
    ).toContain('film_post_film_baseline_unapproved');

    expect(() =>
      evaluateFilmBaselineApprovalGate(fixture, approvedAnalytic, stochasticOpticalReport, {
        ...approval,
        releasePolicy: { ...approval.releasePolicy, productionFilmPixelsChanged: true },
      }),
    ).toThrow();
  });
});
