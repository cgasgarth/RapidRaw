import { z } from 'zod';

export const negativeLabSourcePositiveComparisonModeSchema = z.enum(['final', 'side_by_side', 'split', 'hold_source']);

export const negativeLabComparisonDimensionsSchema = z.object({
  height: z.number().int().positive(),
  width: z.number().int().positive(),
});

const negativeLabSourcePositiveComparisonArtifactSchema = z.object({
  artifactId: z.string().min(1),
  contentHash: z.string().min(1),
  dimensions: negativeLabComparisonDimensionsSchema,
});

const negativeLabSourcePositiveComparisonSourceSchema = negativeLabSourcePositiveComparisonArtifactSchema.extend({
  path: z.string().min(1),
});

export const negativeLabSourcePositiveComparisonProofSchema = z.object({
  alignment: z.object({
    crop: z.enum(['aligned', 'warning']),
    orientation: z.enum(['aligned', 'warning']),
  }),
  final: negativeLabSourcePositiveComparisonArtifactSchema,
  mode: negativeLabSourcePositiveComparisonModeSchema,
  planHash: z.string().min(1),
  recipeHash: z.string().min(1),
  source: negativeLabSourcePositiveComparisonSourceSchema,
  warningCodes: z.array(z.string()),
});

export type NegativeLabSourcePositiveComparisonMode = z.infer<typeof negativeLabSourcePositiveComparisonModeSchema>;
export type NegativeLabSourcePositiveComparisonProof = z.infer<typeof negativeLabSourcePositiveComparisonProofSchema>;

export const buildNegativeLabSourcePositiveComparisonProof = ({
  final,
  finalUrlReady,
  mode,
  planHash,
  recipeHash,
  source,
  sourceUrlReady,
  warningCodes,
}: Omit<NegativeLabSourcePositiveComparisonProof, 'alignment'> & {
  sourceUrlReady: boolean;
  finalUrlReady: boolean;
}): NegativeLabSourcePositiveComparisonProof => {
  const dimensionsAligned =
    source.dimensions.width === final.dimensions.width && source.dimensions.height === final.dimensions.height;

  return negativeLabSourcePositiveComparisonProofSchema.parse({
    alignment: {
      crop: dimensionsAligned ? 'aligned' : 'warning',
      orientation: warningCodes.some((code) => code.includes('orientation')) ? 'warning' : 'aligned',
    },
    final,
    mode,
    planHash,
    recipeHash,
    source,
    warningCodes: [
      ...warningCodes,
      ...(!sourceUrlReady ? ['source_preview_pending'] : []),
      ...(!finalUrlReady ? ['final_preview_pending'] : []),
      ...(!dimensionsAligned ? ['dimension_mismatch'] : []),
    ],
  });
};
