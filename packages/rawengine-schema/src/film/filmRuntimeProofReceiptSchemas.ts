import { z } from 'zod';

import { filmEmulationProfileRefV1Schema } from './filmEmulationSchemas.js';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const filmPreviewExportMetricsV1Schema = z
  .object({
    changedPixelRatio: z.number().finite().positive().max(1),
    previewExportMeanAbsDelta: z.number().finite().nonnegative().max(0.015),
    postFilmPreViewHashEqual: z.literal(true),
    sourceHashUnchanged: z.literal(true),
  })
  .strict();

export const filmRuntimeProofReceiptV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_runtime_proof.v1'),
    proofLevel: z.literal('native_private_raw_preview_export'),
    sourceContentSha256: sha256Schema,
    rawDecodeReceiptSha256: sha256Schema,
    inputProfileId: z.string().trim().min(1),
    inputProfileSha256: sha256Schema,
    workingSpace: z.literal('acescg_linear_v1'),
    filmProfileRef: filmEmulationProfileRefV1Schema,
    filmProfileContentSha256: sha256Schema,
    filmNodeSha256: sha256Schema,
    compiledProfileSha256: sha256Schema,
    executionPlanSha256: sha256Schema,
    backend: z.enum(['gpu', 'cpu_fallback']),
    quality: z.enum(['settled_preview_v1', 'export_full_v1']),
    postFilmPreViewSha256: sha256Schema,
    viewTransformId: z.string().trim().min(1),
    gamutMapperId: z.string().trim().min(1),
    displayOrOutputProfileSha256: sha256Schema,
    colorSyncDisplayProfileSha256: sha256Schema.optional(),
    previewArtifactSha256: sha256Schema,
    exportArtifactSha256: sha256Schema,
    previewExportMetrics: filmPreviewExportMetricsV1Schema,
    limitationCodes: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.filmProfileRef.contentSha256 !== receipt.filmProfileContentSha256)
      context.addIssue({
        code: 'custom',
        message: 'Film profile ref/content hashes must agree.',
        path: ['filmProfileRef'],
      });
  });

export type FilmPreviewExportMetricsV1 = z.infer<typeof filmPreviewExportMetricsV1Schema>;
export type FilmRuntimeProofReceiptV1 = z.infer<typeof filmRuntimeProofReceiptV1Schema>;
