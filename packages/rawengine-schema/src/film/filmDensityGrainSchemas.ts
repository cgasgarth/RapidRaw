import { z } from 'zod';

const finite = z.number().finite();
const matrixRow = z.array(finite).length(3);

export const filmDensityGrainLayerV1Schema = z
  .object({ radiusPxAtFullResolution: finite.min(0.5).max(1024), weight: finite.min(0).max(1) })
  .strict();

export const filmDensityGrainV1Schema = z
  .object({
    model: z.literal('layered_density_grain_v1'),
    amountDefault: finite.min(0).max(2),
    densityKnots: z.array(finite).min(2).max(32),
    sigmaByChannel: z.tuple([z.array(finite), z.array(finite), z.array(finite)]),
    layers: z.array(filmDensityGrainLayerV1Schema).min(1).max(8),
    channelCorrelation: z.tuple([matrixRow, matrixRow, matrixRow]),
    seedPolicy: z.literal('source_profile_user_v1'),
    coordinateSpace: z.literal('oriented_source_full_resolution_v1'),
    previewFilter: z.literal('variance_preserving_mip_v1'),
  })
  .strict()
  .superRefine((profile, context) => {
    for (let index = 1; index < profile.densityKnots.length; index += 1) {
      if (profile.densityKnots[index]! <= profile.densityKnots[index - 1]!) {
        context.addIssue({
          code: 'custom',
          path: ['densityKnots'],
          message: 'Density knots must be strictly increasing.',
        });
      }
    }
    profile.sigmaByChannel.forEach((curve, index) => {
      if (curve.length !== profile.densityKnots.length || curve.some((value) => value < 0)) {
        context.addIssue({
          code: 'custom',
          path: ['sigmaByChannel', index],
          message: 'Sigma curves must match knots and stay non-negative.',
        });
      }
    });
    const matrix = profile.channelCorrelation;
    for (let row = 0; row < 3; row += 1) {
      if (Math.abs(matrix[row]![row]! - 1) > 1e-5) {
        context.addIssue({
          code: 'custom',
          path: ['channelCorrelation', row, row],
          message: 'Correlation diagonal must be one.',
        });
      }
      for (let column = row + 1; column < 3; column += 1) {
        if (Math.abs(matrix[row]![column]! - matrix[column]![row]!) > 1e-5 || Math.abs(matrix[row]![column]!) > 1) {
          context.addIssue({
            code: 'custom',
            path: ['channelCorrelation'],
            message: 'Correlation matrix must be symmetric and bounded.',
          });
        }
      }
    }
    const determinant =
      matrix[0]![0]! * (matrix[1]![1]! * matrix[2]![2]! - matrix[1]![2]! * matrix[2]![1]!) -
      matrix[0]![1]! * (matrix[1]![0]! * matrix[2]![2]! - matrix[1]![2]! * matrix[2]![0]!) +
      matrix[0]![2]! * (matrix[1]![0]! * matrix[2]![1]! - matrix[1]![1]! * matrix[2]![0]!);
    if (determinant < -1e-5) {
      context.addIssue({
        code: 'custom',
        path: ['channelCorrelation'],
        message: 'Correlation matrix must be positive semidefinite.',
      });
    }
    if (!profile.layers.some((layer) => layer.weight > 0)) {
      context.addIssue({
        code: 'custom',
        path: ['layers'],
        message: 'At least one grain layer must have non-zero weight.',
      });
    }
  });

export type FilmDensityGrainV1 = z.infer<typeof filmDensityGrainV1Schema>;

export const referenceFilmDensityGrainV1: FilmDensityGrainV1 = {
  model: 'layered_density_grain_v1',
  amountDefault: 0.24,
  densityKnots: [0, 0.25, 0.75, 1.5, 2.5, 4],
  sigmaByChannel: [
    [0.18, 0.13, 0.09, 0.07, 0.1, 0.16],
    [0.16, 0.12, 0.085, 0.065, 0.095, 0.15],
    [0.2, 0.15, 0.1, 0.075, 0.11, 0.18],
  ],
  layers: [
    { radiusPxAtFullResolution: 1, weight: 0.72 },
    { radiusPxAtFullResolution: 3.5, weight: 0.28 },
  ],
  channelCorrelation: [
    [1, 0.38, 0.22],
    [0.38, 1, 0.31],
    [0.22, 0.31, 1],
  ],
  seedPolicy: 'source_profile_user_v1',
  coordinateSpace: 'oriented_source_full_resolution_v1',
  previewFilter: 'variance_preserving_mip_v1',
};

filmDensityGrainV1Schema.parse(referenceFilmDensityGrainV1);
