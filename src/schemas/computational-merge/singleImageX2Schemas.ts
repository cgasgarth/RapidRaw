import { z } from 'zod';

export const singleImageX2CapabilitySchema = z
  .object({
    schemaVersion: z.literal(1),
    available: z.boolean(),
    modelId: z.string().min(1),
    modelSizeBytes: z.number().int().nonnegative(),
    sourceUrl: z.string().url(),
    codeLicense: z.literal('Apache-2.0'),
    weightLicenseStatus: z.literal('redistribution_unverified'),
    reason: z.string().min(1).nullable(),
  })
  .strict();

export const singleImageX2ReviewSchema = z
  .object({
    decision: z.enum(['preview_only_manual_review', 'preview_only_blocked']),
    manualReviewRequired: z.literal(true),
    inputHash: z.string().startsWith('sha256:'),
    outputHash: z.string().startsWith('sha256:'),
    bicubicHash: z.string().startsWith('sha256:'),
    modelId: z.string().min(1),
    modelSha256: z.string().min(1),
    downsampleMae: z.number().nonnegative(),
    meanAbsoluteResidual: z.number().nonnegative(),
    maxAbsoluteResidual: z.number().nonnegative(),
    nonfiniteCount: z.number().int().nonnegative(),
    tilePolicyId: z.string().min(1),
    colorPolicyId: z.string().min(1),
  })
  .strict();

export const singleImageX2PreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.string().uuid(),
    sourcePath: z.string().min(1),
    graphRevision: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aiPreviewDataUrl: z.string().startsWith('data:image/png;base64,'),
    bicubicPreviewDataUrl: z.string().startsWith('data:image/png;base64,'),
    review: singleImageX2ReviewSchema,
    applyStatus: z.literal('durable_commit_pending'),
    derivativeKind: z.literal('rendered_rgb_ai_derivative'),
  })
  .strict();

export type SingleImageX2Capability = z.infer<typeof singleImageX2CapabilitySchema>;
export type SingleImageX2Preview = z.infer<typeof singleImageX2PreviewSchema>;
