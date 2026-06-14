import { z } from 'zod';

export const xyWhitePointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()
  .refine((whitePoint) => whitePoint.y > 0, {
    message: 'White point y must be greater than 0.',
  });

export const xyzColorSchema = z.tuple([z.number(), z.number(), z.number()]);

export const chromaticAdaptationInputSchema = z
  .object({
    sourceWhitePoint: xyWhitePointSchema,
    targetWhitePoint: xyWhitePointSchema,
    xyz: xyzColorSchema,
  })
  .strict();

export type XyWhitePoint = z.infer<typeof xyWhitePointSchema>;
export type XyzColor = z.infer<typeof xyzColorSchema>;
export type ChromaticAdaptationInput = z.infer<typeof chromaticAdaptationInputSchema>;

type Matrix3 = readonly [XyzColor, XyzColor, XyzColor];

const bradfordMatrix: Matrix3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

const inverseBradfordMatrix: Matrix3 = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

const multiplyMatrixVector = (matrix: Matrix3, vector: XyzColor): XyzColor => [
  matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
  matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
  matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
];

export const xyToNormalizedXyz = (whitePoint: XyWhitePoint): XyzColor => {
  const parsed = xyWhitePointSchema.parse(whitePoint);
  return [parsed.x / parsed.y, 1, (1 - parsed.x - parsed.y) / parsed.y];
};

const sameWhitePoint = (left: XyWhitePoint, right: XyWhitePoint): boolean => left.x === right.x && left.y === right.y;

export const adaptXyzBradford = (input: ChromaticAdaptationInput): XyzColor => {
  const parsed = chromaticAdaptationInputSchema.parse(input);
  if (sameWhitePoint(parsed.sourceWhitePoint, parsed.targetWhitePoint)) {
    return parsed.xyz;
  }

  const sourceCone = multiplyMatrixVector(bradfordMatrix, xyToNormalizedXyz(parsed.sourceWhitePoint));
  const targetCone = multiplyMatrixVector(bradfordMatrix, xyToNormalizedXyz(parsed.targetWhitePoint));
  const colorCone = multiplyMatrixVector(bradfordMatrix, parsed.xyz);
  const adaptedCone: XyzColor = [
    colorCone[0] * (targetCone[0] / sourceCone[0]),
    colorCone[1] * (targetCone[1] / sourceCone[1]),
    colorCone[2] * (targetCone[2] / sourceCone[2]),
  ];

  return multiplyMatrixVector(inverseBradfordMatrix, adaptedCone);
};
