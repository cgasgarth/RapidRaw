import { z } from 'zod';

export const professionalCurveChannelModeSchema = z.enum([
  'luminance_preserving',
  'linked_rgb',
  'independent_rgb',
  'red',
  'green',
  'blue',
]);

const interpolationSchema = z.enum(['monotone_cubic', 'linear']);
const extrapolationSchema = z.union([
  z.enum(['linear_tangent', 'constant']),
  z.object({ softRollOffStrength: z.number().positive().finite() }).strict(),
]);
const preserveColorSchema = z.enum(['luminance_ratio', 'max_rgb_ratio', 'none']);

export const sceneCurveV1Schema = z
  .object({
    enabled: z.boolean(),
    version: z.literal(1).default(1),
    domain: z.literal('scene_log2_ev').default('scene_log2_ev'),
    channelMode: professionalCurveChannelModeSchema,
    interpolation: interpolationSchema,
    middleGrey: z.number().positive().finite(),
    points: z
      .array(z.object({ xEv: z.number().min(-16).max(16), yEv: z.number().finite() }).strict())
      .min(2)
      .max(64),
    lowExtrapolation: extrapolationSchema,
    highExtrapolation: extrapolationSchema,
    preserveColor: preserveColorSchema,
  })
  .strict();

export const outputCurveV1Schema = z
  .object({
    enabled: z.boolean(),
    version: z.literal(1).default(1),
    domain: z.enum(['view_encoded', 'output_encoded']),
    outputProfileId: z.string().trim().min(1),
    referenceWhite: z.number().positive().finite(),
    maximumValue: z.number().positive().finite(),
    channelMode: professionalCurveChannelModeSchema,
    interpolation: interpolationSchema,
    points: z
      .array(z.object({ x: z.number().finite(), y: z.number().finite() }).strict())
      .min(2)
      .max(64),
    lowExtrapolation: extrapolationSchema,
    highExtrapolation: extrapolationSchema,
    preserveColor: preserveColorSchema,
  })
  .strict()
  .refine(({ maximumValue, referenceWhite }) => maximumValue >= referenceWhite, {
    message: 'Maximum output value must be at least reference white.',
    path: ['maximumValue'],
  });

export type SceneCurveV1 = z.infer<typeof sceneCurveV1Schema>;
export type OutputCurveV1 = z.infer<typeof outputCurveV1Schema>;
