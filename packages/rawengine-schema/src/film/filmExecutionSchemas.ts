import { z } from 'zod';

export const filmExecutionStageOrderV1 = [
  'capture_optical_scatter',
  'characteristic_response',
  'color_coupler',
  'residual_response',
  'density_grain',
  'print_scan',
  'positive_normalization',
  'scene_linear_mix',
  'post_film_tap',
] as const;

export const filmExecutionPlanV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_execution_plan.v1'),
    inputDomain: z.literal('acescg_linear_v1'),
    outputDomain: z.literal('acescg_linear_v1'),
    profileContentSha256: z.string().min(1),
    compiledProfileSha256: z.string().min(1),
    stageOrder: z.array(z.string()),
    haloOverlapPx: z.number().int().min(0).max(512),
    borderPolicyVersion: z.literal('reflect101_v1'),
    scaleFilterVersion: z.literal('variance_preserving_mip_v1'),
    modelAbiVersion: z.string().min(1),
    backendAbiVersion: z.string().min(1),
    planSha256: z.string().min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      plan.stageOrder.length !== filmExecutionStageOrderV1.length ||
      plan.stageOrder.some((stage, index) => stage !== filmExecutionStageOrderV1[index])
    )
      context.addIssue({ code: 'custom', path: ['stageOrder'], message: 'Film stage order must remain normative.' });
  });

export type FilmExecutionPlanV1 = z.infer<typeof filmExecutionPlanV1Schema>;

export const filmExecutionReceiptV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_execution_plan.v1'),
    backend: z.enum(['cpu', 'gpu']),
    stageOrder: z.array(z.string()),
    quality: z.string().min(1),
    tiled: z.boolean(),
    fallback: z.boolean(),
    errorCode: z.string().min(1).optional(),
    postFilmHash: z.string().min(1),
  })
  .strict();
