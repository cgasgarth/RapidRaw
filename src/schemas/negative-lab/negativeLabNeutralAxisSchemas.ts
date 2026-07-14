import { z } from 'zod';

export const negativeLabNeutralAxisParamsSchema = z
  .object({
    algorithm_version: z.literal(1),
    enabled: z.boolean(),
    strength: z.number().min(0).max(1),
    low_chroma_quantile: z.number().min(0.01).max(0.5),
    low_chroma_cap: z.number().min(0.005).max(0.25),
    min_support: z.number().int().min(4).max(100000),
    confidence_threshold: z.number().min(0).max(1),
    allow_global_fallback: z.boolean(),
    source: z.string().trim().min(1),
  })
  .strict();

export const negativeLabNeutralAxisAnalysisSchema = z
  .object({
    algorithmId: z.literal('native_negative_lab_neutral_axis_v1'),
    algorithmVersion: z.literal(1),
    status: z.enum(['disabled_identity', 'no_correction_low_confidence', 'correction_applied']),
    fitMode: z.enum(['none', 'quadratic_three_band_v1', 'linear_two_band_v1', 'global_one_band_v1']),
    confidence: z.number().min(0).max(1),
    confidenceThreshold: z.number().min(0).max(1),
    sampleCount: z.number().int().nonnegative(),
    bandSupport: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    bandReferences: z.tuple([
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
      z.tuple([z.number(), z.number(), z.number()]),
    ]),
    residualBefore: z.number().nonnegative(),
    residualAfter: z.number().nonnegative(),
    effectiveGlobal: z.tuple([z.number(), z.number(), z.number()]),
    effectiveShadow: z.tuple([z.number(), z.number(), z.number()]),
    effectiveHighlight: z.tuple([z.number(), z.number(), z.number()]),
    source: z.string().trim().min(1),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();
