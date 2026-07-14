import { z } from 'zod';

const finite = z.number().finite();
const matrix = z.tuple([z.array(finite).length(3), z.array(finite).length(3), z.array(finite).length(3)]);
const kernel = z
  .object({
    radiiPxFullRes: z.array(finite.min(0.5).max(512)).min(1).max(8),
    weights: z.array(finite.min(0).max(1)).min(1).max(8),
  })
  .strict();

const halation = kernel
  .extend({
    sourceThresholdEv: z.tuple([finite, finite]),
    sourcePower: finite.min(0.1).max(4),
    coreRadiusPxFullRes: finite.min(0.5).max(256),
    coreRejection: finite.min(0).max(1),
    spectralMatrix: matrix,
    amountDefault: finite.min(0).max(1),
  })
  .strict();

const bloom = kernel
  .extend({
    placement: z.enum(['capture_pre_response', 'print_pre_paper']),
    sourceThresholdEv: z.tuple([finite, finite]),
    spectralMatrix: matrix,
    amountDefault: finite.min(0).max(1),
  })
  .strict();

export const filmOpticalScatterV1Schema = z
  .object({ model: z.literal('multiscale_optical_scatter_v1'), halation, bloom: bloom.optional() })
  .strict()
  .superRefine((profile, context) => {
    const validateStage = (stage: {
      radiiPxFullRes: number[];
      weights: number[];
      sourceThresholdEv: [number, number];
      spectralMatrix: number[][];
    }) => {
      if (stage.radiiPxFullRes.length !== stage.weights.length || stage.weights.every((weight) => weight <= 0))
        context.addIssue({
          code: 'custom',
          path: ['halation'],
          message: 'Optical kernels require matching radii and positive weight.',
        });
      if (stage.sourceThresholdEv[1] <= stage.sourceThresholdEv[0])
        context.addIssue({
          code: 'custom',
          path: ['halation', 'sourceThresholdEv'],
          message: 'Thresholds must increase.',
        });
      for (let row = 0; row < 3; row += 1)
        if (stage.spectralMatrix[row]!.some((value) => value < 0 || value > 2))
          context.addIssue({
            code: 'custom',
            path: ['halation', 'spectralMatrix'],
            message: 'Spectral matrix must be bounded and non-negative.',
          });
    };
    validateStage(profile.halation);
    if (profile.bloom) {
      validateStage(profile.bloom);
      if (profile.bloom.placement === 'print_pre_paper')
        context.addIssue({
          code: 'custom',
          path: ['bloom', 'placement'],
          message: 'Print bloom requires a compatible print stage.',
        });
    }
  });

export type FilmOpticalScatterV1 = z.infer<typeof filmOpticalScatterV1Schema>;

export const referenceFilmOpticalScatterV1: FilmOpticalScatterV1 = {
  model: 'multiscale_optical_scatter_v1',
  halation: {
    sourceThresholdEv: [1, 3],
    sourcePower: 1.2,
    radiiPxFullRes: [2, 6, 16],
    weights: [0.62, 0.28, 0.1],
    coreRadiusPxFullRes: 1.5,
    coreRejection: 0.75,
    spectralMatrix: [
      [1, 0.03, 0],
      [0.08, 0.72, 0.02],
      [0.02, 0.04, 0.42],
    ],
    amountDefault: 0.18,
  },
  bloom: {
    placement: 'capture_pre_response',
    sourceThresholdEv: [2, 4],
    radiiPxFullRes: [8, 24],
    weights: [0.75, 0.25],
    spectralMatrix: [
      [0.92, 0.02, 0],
      [0.02, 0.9, 0.02],
      [0, 0.02, 0.86],
    ],
    amountDefault: 0.06,
  },
};

filmOpticalScatterV1Schema.parse(referenceFilmOpticalScatterV1);
