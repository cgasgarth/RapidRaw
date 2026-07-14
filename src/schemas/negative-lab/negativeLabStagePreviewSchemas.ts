import { z } from 'zod';

export const negativeLabStageIdSchema = z.enum(['normalized_density', 'scene_linear_print']);
export const negativeLabStageColorDomainSchema = negativeLabStageIdSchema;
export const negativeLabStageDisplayTransformSchema = z.enum([
  'normalized_density_clamp_v1',
  'scene_linear_to_srgb_gamma_v1',
]);

/** Native intermediate-stage identity fields; the adapter adds the strict bounds receipt shape. */
export const negativeLabStagePreviewArtifactFieldsSchema = z
  .object({
    colorDomain: negativeLabStageColorDomainSchema,
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    displayTransform: negativeLabStageDisplayTransformSchema,
    previewDataUrl: z.string().startsWith('data:image/jpeg;base64,'),
    recipeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    stageId: negativeLabStageIdSchema,
    stageVersion: z.literal(1),
  })
  .strict();

export type NegativeLabStagePreviewArtifactFields = z.infer<typeof negativeLabStagePreviewArtifactFieldsSchema>;
