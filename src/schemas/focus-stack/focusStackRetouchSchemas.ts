import { z } from 'zod';

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

export const focusRetouchSessionSchema = z.object({
  revision: focusRetouchRevisionSchema.nullable(),
  sourceStatuses: z.array(z.enum(['current', 'missing', 'changed', 'undecodable'])),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  renderStatus: z.enum(['saved', 'rendering', 'error']),
});

export type FocusRetouchSession = z.infer<typeof focusRetouchSessionSchema>;
