import { z } from 'zod';

export const filmRenderQualityV1Schema = z.enum([
  'interactive_drag_v1',
  'settled_preview_v1',
  'export_full_v1',
  'profile_thumbnail_v1',
]);

const identityHashSchema = z.string().regex(/^(?:sha256:[a-f0-9]{64}|fnv1a64:[0-9a-f]{16})$/u);

export const filmRenderResultIdentityV1Schema = z
  .object({
    sourceContentSha256: identityHashSchema,
    selectedImageId: z.string().trim().min(1),
    graphRevision: z.number().int().nonnegative(),
    upstreamGraphSha256: identityHashSchema,
    filmNodeSha256: identityHashSchema,
    compiledProfileSha256: identityHashSchema,
    executionPlanSha256: identityHashSchema,
    orientationAndGeometrySha256: identityHashSchema,
    fullResolutionCoordinatePolicy: z.string().trim().min(1),
    quality: filmRenderQualityV1Schema,
    viewOutputSha256: identityHashSchema,
    cropAndDimensionsSha256: identityHashSchema,
  })
  .strict();

export const filmRenderRequestV1Schema = z
  .object({
    requestId: z.string().trim().min(1),
    identity: filmRenderResultIdentityV1Schema,
    priority: z.number().int().min(0).max(3),
  })
  .strict();

export const filmRenderResultV1Schema = z
  .object({
    requestId: z.string().trim().min(1),
    identity: filmRenderResultIdentityV1Schema,
    status: z.enum(['queued', 'rendering', 'ready', 'stale', 'cancelled', 'unavailable', 'error']),
    backend: z.enum(['cpu', 'gpu', 'none']),
    outputHash: identityHashSchema.optional(),
    approximationCodes: z.array(z.string().trim().min(1)),
    rejectionReason: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === 'ready' && result.outputHash === undefined)
      context.addIssue({ code: 'custom', message: 'Ready Film results require outputHash.', path: ['outputHash'] });
    if (result.status !== 'ready' && result.outputHash !== undefined)
      context.addIssue({
        code: 'custom',
        message: 'Only ready Film results may carry outputHash.',
        path: ['outputHash'],
      });
  });

export type FilmRenderQualityV1 = z.infer<typeof filmRenderQualityV1Schema>;
export type FilmRenderResultIdentityV1 = z.infer<typeof filmRenderResultIdentityV1Schema>;
export type FilmRenderRequestV1 = z.infer<typeof filmRenderRequestV1Schema>;
export type FilmRenderResultV1 = z.infer<typeof filmRenderResultV1Schema>;
