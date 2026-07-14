import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { evaluateFilmNativeReleaseGate } from '../../../src/utils/film-look/filmReleaseGate';

const manifestPath = resolve(
  import.meta.dir,
  '../../../fixtures/film/validation/reference-film-validation-manifest-v1.json',
);
const fixture = await Bun.file(manifestPath).json();
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
  samples: [
    {
      id: 'neutral',
      input: [0.18, 0.18, 0.18],
      disabledOutput: [0.18, 0.18, 0.18],
      mixZeroOutput: [0.18, 0.18, 0.18],
      fullMixOutput: [0.2, 0.2, 0.2],
    },
    {
      id: 'extended',
      input: [-0.1, 0.2, 1.2],
      disabledOutput: [-0.1, 0.2, 1.2],
      mixZeroOutput: [-0.1, 0.2, 1.2],
      fullMixOutput: [-0.08, 0.3, 1.1],
    },
  ],
  passed: true,
  failures: [],
};

describe('Film native analytic release gate', () => {
  test('accepts identity-safe native output and reuses gamut classification', () => {
    expect(evaluateFilmNativeReleaseGate(fixture, report)).toEqual({
      failures: [],
      gamutClassifications: {
        high_component: 0,
        in_gamut: 1,
        mixed_out_of_gamut: 1,
        negative_component: 0,
      },
      maxIdentityDeltaE00: 0,
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
});
