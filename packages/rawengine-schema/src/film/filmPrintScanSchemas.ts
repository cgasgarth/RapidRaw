import { z } from 'zod';

const matrix3Schema = z.tuple([
  z.tuple([z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8)]),
  z.tuple([z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8)]),
  z.tuple([z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8), z.number().finite().min(-8).max(8)]),
]);

const determinant = (matrix: [[number, number, number], [number, number, number], [number, number, number]]) =>
  matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
  matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
  matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);

const paperSchema = z
  .object({
    dMax: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    dMin: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    exposureKnotsLog10: z.array(z.array(z.number().finite()).min(5)).length(3),
    flareFloor: z.number().finite().min(0).max(0.999),
    responseKnots: z.array(z.array(z.number().finite()).min(5)).length(3),
    whitePointXy: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  })
  .strict()
  .superRefine((paper, context) => {
    if (
      paper.exposureKnotsLog10.some((knots, channel) => {
        const responses = paper.responseKnots[channel] ?? [];
        return (
          knots.length !== responses.length ||
          knots.some((value, index) => index > 0 && value <= (knots[index - 1] ?? value)) ||
          responses.some((value, index) => index > 0 && value < (responses[index - 1] ?? value))
        );
      })
    )
      context.addIssue({
        code: 'custom',
        message: 'Paper exposure/response curves must be finite and monotone.',
        path: ['responseKnots'],
      });
    if (paper.dMin.some((value, index) => value >= (paper.dMax[index] ?? value)))
      context.addIssue({ code: 'custom', message: 'Paper density range must be ordered.', path: ['dMax'] });
  });

const scanSchema = z
  .object({
    cat: z.enum(['bradford_v1', 'none_already_adapted']),
    matrixToXyz: matrix3Schema,
    mode: z.enum(['transmission', 'reflection']),
    normalization: z.tuple([
      z.number().finite().positive(),
      z.number().finite().positive(),
      z.number().finite().positive(),
    ]),
    sourceWhiteXy: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  })
  .strict()
  .superRefine((scan, context) => {
    if (Math.abs(determinant(scan.matrixToXyz)) <= 1e-6)
      context.addIssue({ code: 'custom', message: 'Scan matrix must be invertible.', path: ['matrixToXyz'] });
  });

export const filmPrintScanV1Schema = z
  .object({
    enabledByProfile: z.boolean(),
    model: z.literal('density_print_scan_v1'),
    paper: paperSchema,
    printerCrossTalk: matrix3Schema,
    printerLightBalanceStops: z.tuple([
      z.number().finite().min(-8).max(8),
      z.number().finite().min(-8).max(8),
      z.number().finite().min(-8).max(8),
    ]),
    scan: scanSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (Math.abs(determinant(profile.printerCrossTalk)) <= 1e-6)
      context.addIssue({
        code: 'custom',
        message: 'Printer cross-talk matrix must be invertible.',
        path: ['printerCrossTalk'],
      });
  });

export type FilmPrintScanV1 = z.infer<typeof filmPrintScanV1Schema>;

export const referenceFilmPrintScanV1: FilmPrintScanV1 = {
  model: 'density_print_scan_v1',
  enabledByProfile: true,
  printerLightBalanceStops: [0, 0, 0],
  printerCrossTalk: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  paper: {
    exposureKnotsLog10: [
      [-3, -1.5, -0.5, 0, 0.8, 1.5],
      [-3, -1.5, -0.5, 0, 0.8, 1.5],
      [-3, -1.5, -0.5, 0, 0.8, 1.5],
    ],
    responseKnots: [
      [0, 0.05, 0.25, 0.5, 0.8, 1],
      [0, 0.05, 0.25, 0.5, 0.8, 1],
      [0, 0.05, 0.25, 0.5, 0.8, 1],
    ],
    dMin: [0.04, 0.04, 0.04],
    dMax: [2, 2, 2],
    whitePointXy: [0.3127, 0.329],
    flareFloor: 0.01,
  },
  scan: {
    mode: 'transmission',
    matrixToXyz: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    sourceWhiteXy: [0.3127, 0.329],
    cat: 'none_already_adapted',
    normalization: [1, 1, 1],
  },
};
