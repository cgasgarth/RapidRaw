import { z } from 'zod';

export const negativeLabOpticalFinishParamsSchema = z
  .object({
    algorithmVersion: z.literal(1),
    enabled: z.boolean(),
    glowAmount: z.number().min(0).max(1),
    glowRadius: z.number().min(0.0005).max(0.25),
    glowThreshold: z.number().min(0).max(1),
    halationAmount: z.number().min(0).max(1),
    halationRadius: z.number().min(0.0005).max(0.25),
    halationThreshold: z.number().min(0).max(1),
    orangeWeight: z.number().min(0).max(1),
    redWeight: z.number().min(0).max(1),
    scaleBasis: z.literal('full_resolution_short_edge_v1'),
    workingSpace: z.literal('scene_linear_srgb_d65_v1'),
  })
  .strict();

export const negativeLabOpticalFinishMetricsSchema = z
  .object({
    afterHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    algorithmId: z.literal('negative_lab_optical_finish_v1'),
    algorithmVersion: z.literal(1),
    beforeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    changedPixelRatio: z.number().min(0).max(1),
    effectiveGlowRadiusPixels: z.number().int().nonnegative(),
    effectiveHalationRadiusPixels: z.number().int().nonnegative(),
    gamutClippedPixelCount: z.number().int().nonnegative(),
    localizedMaskRatio: z.number().min(0).max(1),
    operationId: z.literal('negative_lab.optical_finish'),
    prePolicyOvershoot: z.number().nonnegative(),
    warningCodes: z.array(z.enum(['inapplicable_mode_identity'])),
  })
  .strict();

export type NegativeLabOpticalFinishParams = z.infer<typeof negativeLabOpticalFinishParamsSchema>;
export type NegativeLabOpticalFinishMetrics = z.infer<typeof negativeLabOpticalFinishMetricsSchema>;
