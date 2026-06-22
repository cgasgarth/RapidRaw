import { z } from 'zod';

export const artifactHandleV1Schema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().trim().min(1).optional(),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict()
      .optional(),
    kind: z.enum(['mask', 'preview', 'generated_patch', 'denoise_output', 'merge_output', 'export']),
    storage: z.enum(['temp_cache', 'sidecar_artifact', 'export_path']),
  })
  .strict();

export type ArtifactHandleV1 = z.infer<typeof artifactHandleV1Schema>;

export const negativeLabPositiveArtifactHandleV1Schema = artifactHandleV1Schema.extend({
  kind: z.literal('negative_lab_positive'),
  outputIntent: z.literal('editable_positive'),
  positiveVariantId: z.string().trim().min(1),
  storage: z.literal('sidecar_artifact'),
});

export type NegativeLabPositiveArtifactHandleV1 = z.infer<typeof negativeLabPositiveArtifactHandleV1Schema>;
