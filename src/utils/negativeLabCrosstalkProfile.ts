import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';
import {
  negativeLabCrosstalkProfileSchema,
  type NegativeLabCrosstalkProfile,
  type NegativeLabCrosstalkProfileMatrix,
} from '../schemas/negativeLabCrosstalkProfileSchemas';

export const NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE = negativeLabCrosstalkProfileSchema.parse({
  matrix: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  profileId: 'negative_lab.crosstalk.identity.rawengine.v1',
  provenance: 'rawengine_identity_default',
  provenanceHash: 'fnv1a32:1882ba5c',
  schemaVersion: 1,
  strength: 0,
});

export const normalizeNegativeLabCrosstalkMatrixRows = (
  matrix: NegativeLabCrosstalkProfileMatrix,
): NegativeLabCrosstalkProfileMatrix =>
  matrix.map((row) => {
    const rowSum = row.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(rowSum) || Math.abs(rowSum) < 1e-8) {
      throw new Error('Negative Lab crosstalk matrix rows must be finite and normalizable.');
    }
    return row.map((value) => value / rowSum);
  }) as NegativeLabCrosstalkProfileMatrix;

export const buildNegativeLabCrosstalkProfileProvenanceHash = (
  profile: Omit<NegativeLabCrosstalkProfile, 'provenanceHash'>,
): `fnv1a32:${string}` =>
  `fnv1a32:${buildNegativeLabPlanHash(
    JSON.stringify({
      matrix: normalizeNegativeLabCrosstalkMatrixRows(profile.matrix),
      profileId: profile.profileId,
      provenance: profile.provenance,
      schemaVersion: profile.schemaVersion,
      strength: profile.strength,
    }),
  )}`;

export const buildNegativeLabCrosstalkProfile = (
  profile: Omit<NegativeLabCrosstalkProfile, 'provenanceHash'>,
): NegativeLabCrosstalkProfile =>
  negativeLabCrosstalkProfileSchema.parse({
    ...profile,
    matrix: normalizeNegativeLabCrosstalkMatrixRows(profile.matrix),
    provenanceHash: buildNegativeLabCrosstalkProfileProvenanceHash(profile),
  });

export const applyNegativeLabDensityCrosstalk = (
  densityRgb: readonly [number, number, number],
  crosstalkProfile: NegativeLabCrosstalkProfile = NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
): [number, number, number] => {
  const profile = negativeLabCrosstalkProfileSchema.parse(crosstalkProfile);
  const matrix = normalizeNegativeLabCrosstalkMatrixRows(profile.matrix);
  if (profile.strength === 0) return [densityRgb[0], densityRgb[1], densityRgb[2]];

  const mixed = matrix.map((row) => row[0] * densityRgb[0] + row[1] * densityRgb[1] + row[2] * densityRgb[2]) as [
    number,
    number,
    number,
  ];

  return [
    densityRgb[0] + (mixed[0] - densityRgb[0]) * profile.strength,
    densityRgb[1] + (mixed[1] - densityRgb[1]) * profile.strength,
    densityRgb[2] + (mixed[2] - densityRgb[2]) * profile.strength,
  ];
};
