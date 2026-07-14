import {
  type FilmValidationFixtureV1,
  type FilmValidationReportV1,
  filmValidationFixtureV1Schema,
  filmValidationReportV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';
export type FilmAnalyticVector = {
  id: string;
  before: [number, number, number];
  after: [number, number, number];
};

const stableJson = (value: unknown): string => JSON.stringify(value);
const isFiniteRgb = (rgb: readonly number[]) => rgb.every((value) => Number.isFinite(value));
const maxAbsDelta = (vectors: readonly FilmAnalyticVector[]): number =>
  Math.max(
    0,
    ...vectors.flatMap((vector) => vector.before.map((value, index) => Math.abs(value - (vector.after[index] ?? 0)))),
  );
const rmse = (vectors: readonly FilmAnalyticVector[]): number => {
  const deltas = vectors.flatMap((vector) => vector.before.map((value, index) => value - (vector.after[index] ?? 0)));
  return deltas.length === 0 ? 0 : Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0) / deltas.length);
};

export const runFilmAnalyticConformance = async (
  rawFixture: unknown,
  vectors: readonly FilmAnalyticVector[],
): Promise<FilmValidationReportV1> => {
  const fixture = filmValidationFixtureV1Schema.parse(rawFixture);
  const failures: string[] = [];
  if (vectors.length === 0) failures.push('analytic_vectors_missing');
  if (vectors.some((vector) => !vector.id || !isFiniteRgb(vector.before) || !isFiniteRgb(vector.after)))
    failures.push('non_finite_or_unidentified_vector');

  const neutralAxisDrift = Math.max(
    0,
    ...vectors
      .filter((vector) => Math.max(...vector.before) - Math.min(...vector.before) <= 1e-9)
      .map((vector) => Math.max(...vector.after) - Math.min(...vector.after)),
  );
  const negativeComponentCount = vectors.reduce(
    (count, vector) => count + vector.after.filter((value) => value < 0).length,
    0,
  );
  const highComponentCount = vectors.reduce(
    (count, vector) => count + vector.after.filter((value) => value > 1).length,
    0,
  );
  const observedMaxAbs = maxAbsDelta(vectors);
  const observedRmse = rmse(vectors);
  if (observedMaxAbs > fixture.thresholds.maxAbs) failures.push('max_abs_threshold_failed');
  if (observedRmse > fixture.thresholds.rmse) failures.push('rmse_threshold_failed');
  if (neutralAxisDrift > fixture.thresholds.neutralAxisDrift) failures.push('neutral_axis_threshold_failed');

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableJson({ fixtureId: fixture.id, vectors })),
  );
  const deterministicHash = `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return filmValidationReportV1Schema.parse({
    contract: 'rapidraw.film_validation_report.v1',
    fixtureId: fixture.id,
    proofLevel: fixture.proofLevel,
    postFilmDomain: 'acescg_linear_v1',
    maxAbs: observedMaxAbs,
    rmse: observedRmse,
    neutralAxisDrift,
    negativeComponentCount,
    highComponentCount,
    deterministicHash,
    passed: failures.length === 0,
    failures,
  });
};

export const createFilmAnalyticFixture = (): FilmValidationFixtureV1 =>
  filmValidationFixtureV1Schema.parse({
    contract: 'rapidraw.film_validation_fixture.v1',
    id: 'film-validation.reference-analytic.v1',
    proofLevel: 'analytic_numeric',
    source: {
      logicalId: 'rapidraw.generated.film.reference-analytic.v1',
      pathOrPrivateRef: 'generated:film/reference-analytic.v1',
      sha256: `sha256:${'a'.repeat(64)}`,
      mediaType: 'application/json',
      licenseSpdx: ['MIT'],
      noticePaths: ['LICENSE'],
      publicRepoAllowed: true,
    },
    input: { domain: 'acescg_linear_v1', exposureOffsetEv: 0 },
    regions: [{ id: 'neutral-gray', kind: 'neutral', bounds: [0, 0, 1, 1], referenceRgb: [0.18, 0.18, 0.18] }],
    render: {
      profileRefs: [
        {
          id: 'rapidraw.reference_film.v1',
          version: '1',
          contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
        },
      ],
      viewTransforms: ['AgX v1'],
      outputProfiles: ['srgb'],
      bitDepths: [16, 32],
      proofCrops: [[0, 0, 1, 1]],
    },
    thresholds: {
      maxAbs: 0.0002,
      rmse: 0.00005,
      neutralAxisDrift: 0.0001,
      grainRepeatTolerance: 0,
      opticalLeakage: 0.001,
    },
  });
