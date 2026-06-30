import { z } from 'zod';

export const cameraProfileRgbPixelSchema = z
  .object({
    blue: z.number(),
    green: z.number(),
    red: z.number(),
  })
  .strict();

export const cameraProfileMatrixRowSchema = z.tuple([z.number(), z.number(), z.number()]);
export const cameraProfileMatrix3x3Schema = z.tuple([
  cameraProfileMatrixRowSchema,
  cameraProfileMatrixRowSchema,
  cameraProfileMatrixRowSchema,
]);

export type CameraProfileMatrix3x3 = z.infer<typeof cameraProfileMatrix3x3Schema>;
export type CameraProfileRgbPixel = z.infer<typeof cameraProfileRgbPixelSchema>;

const roundMetric = (value: number) => Number(value.toFixed(12));

export function applyCameraProfileInputTransform(
  inputValue: CameraProfileRgbPixel,
  matrixValue: CameraProfileMatrix3x3,
): CameraProfileRgbPixel {
  const input = cameraProfileRgbPixelSchema.parse(inputValue);
  const matrix = cameraProfileMatrix3x3Schema.parse(matrixValue);
  const vector = [input.red, input.green, input.blue] as const;

  return cameraProfileRgbPixelSchema.parse({
    red: dot(matrix[0], vector),
    green: dot(matrix[1], vector),
    blue: dot(matrix[2], vector),
  });
}

function dot(row: Readonly<[number, number, number]>, vector: Readonly<[number, number, number]>): number {
  return roundMetric(row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);
}
