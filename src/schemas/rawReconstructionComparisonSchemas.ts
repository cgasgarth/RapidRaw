import { z } from 'zod';

import { rawDemosaicPathSchema, rawProcessingProfileSchema } from './imageLoaderSchemas';

export const rawReconstructionComparisonModeResultSchema = z
  .object({
    cameraProfileStatus: z.string().trim().min(1).nullable().optional(),
    cropDataUrl: z.string().startsWith('data:image/png;base64,'),
    cropHash: z.string().regex(/^blake3:[0-9a-f]+$/u),
    decodeElapsedMs: z.number().int().nonnegative(),
    demosaicAlgorithmId: z.string().trim().min(1).nullable().optional(),
    demosaicPath: rawDemosaicPathSchema.nullable().optional(),
    estimatedMemoryBytes: z.number().int().nonnegative(),
    mode: rawProcessingProfileSchema,
    outputHeight: z.number().int().positive(),
    outputWidth: z.number().int().positive(),
    provenance: z.string().trim().min(1),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rawReconstructionComparisonResultSchema = z
  .object({
    cropSize: z.number().int().min(128).max(512),
    imagePath: z.string().trim().min(1),
    modes: z.array(rawReconstructionComparisonModeResultSchema).length(3),
    proofBoundary: z.literal('runtime_raw_reconstruction_mode_crop_comparison'),
  })
  .strict();

export type RawReconstructionComparisonResult = z.infer<typeof rawReconstructionComparisonResultSchema>;
