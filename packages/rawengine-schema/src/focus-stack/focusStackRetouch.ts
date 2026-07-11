import { z } from 'zod';

export const focusOverrideStrokeSchema = z.object({
  strokeId: z.string().min(1),
  sourceIndex: z.number().int().min(0).max(65_534).nullable(),
  pointsFixed1256Px: z
    .array(z.object({ x: z.number().int(), y: z.number().int() }))
    .min(1)
    .max(100_000),
  radiusFixed1256Px: z
    .number()
    .int()
    .positive()
    .max(4096 * 256),
  hardnessU16: z.number().int().min(0).max(65_535),
});

export const focusRetouchRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  revisionId: z.string().min(1),
  parentRevisionId: z.string().min(1).nullable(),
  baseFocusArtifactHash: z.string().min(1),
  orderedSourceHashes: z.array(z.string().min(1)).min(2),
  overrideMapHash: z.string().min(1),
  changedTileIndexHash: z.string().min(1),
  affectedBounds: z.array(
    z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  changedSourceIndices: z.array(z.number().int().nonnegative()),
  skippedPixelCount: z.number().int().nonnegative(),
  blendPolicyHash: z.string().min(1),
  contentHash: z.string().min(1),
});
