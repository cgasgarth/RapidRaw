import { z } from 'zod';

export const POINT_COLOR_PROCESS_V1 = 'rawengine.point-color.oklab-ap1.v1' as const;
export const POINT_COLOR_MAX_POINTS_V1 = 16;
export const POINT_COLOR_MAX_SAMPLES_V1 = 8;

export const perceptualColorCoordinateV1Schema = z
  .object({
    chroma: z.number().finite().min(0).max(2),
    hueDegrees: z.number().finite().min(0).max(360),
    lightness: z.number().finite().min(-1).max(4),
  })
  .strict();

export const pointColorSampleV1Schema = z
  .object({
    confidence: z.number().finite().min(0).max(1),
    graphRevision: z.string().min(1),
    id: z.string().min(1),
    sampleRadiusPx: z.number().finite().min(1).max(128),
    sourceColor: perceptualColorCoordinateV1Schema,
    sourceSceneRevision: z.string().min(1),
  })
  .strict();

export const pointColorAdjustmentV1Schema = z
  .object({
    chromaRadius: z.number().finite().min(0.001).max(1),
    chromaShift: z.number().finite().min(-1).max(1),
    enabled: z.boolean(),
    feather: z.number().finite().min(0).max(1),
    hueRadiusDegrees: z.number().finite().min(0.1).max(180),
    hueShiftDegrees: z.number().finite().min(-180).max(180),
    id: z.string().min(1),
    lightnessRadius: z.number().finite().min(0.001).max(2),
    lightnessShift: z.number().finite().min(-1).max(1),
    name: z.string().min(1).max(80),
    opacity: z.number().finite().min(0).max(1),
    samples: z.array(pointColorSampleV1Schema).min(1).max(POINT_COLOR_MAX_SAMPLES_V1),
    saturationShift: z.number().finite().min(-1).max(4),
    variance: z.number().finite().min(0.25).max(4),
  })
  .strict();

export const skinUniformityV1Schema = z
  .object({
    chromaUniformity: z.number().finite().min(0).max(1),
    enabled: z.boolean(),
    hueUniformity: z.number().finite().min(0).max(1),
    lightnessUniformity: z.number().finite().min(0).max(1),
    preserveExtremes: z.number().finite().min(0).max(1),
    range: pointColorAdjustmentV1Schema.nullable(),
    target: perceptualColorCoordinateV1Schema.nullable(),
  })
  .strict();

export const pointColorPlanV1Schema = z
  .object({
    enabled: z.boolean(),
    points: z.array(pointColorAdjustmentV1Schema).max(POINT_COLOR_MAX_POINTS_V1),
    process: z.literal(POINT_COLOR_PROCESS_V1),
    selectedPointId: z.string().nullable(),
    skinUniformity: skinUniformityV1Schema,
    visualizeMode: z.enum(['image', 'range', 'solo']),
  })
  .strict();

export type PerceptualColorCoordinateV1 = z.infer<typeof perceptualColorCoordinateV1Schema>;
export type PointColorAdjustmentV1 = z.infer<typeof pointColorAdjustmentV1Schema>;
export type PointColorPlanV1 = z.infer<typeof pointColorPlanV1Schema>;
export type PointColorSampleV1 = z.infer<typeof pointColorSampleV1Schema>;
export type SkinUniformityV1 = z.infer<typeof skinUniformityV1Schema>;
