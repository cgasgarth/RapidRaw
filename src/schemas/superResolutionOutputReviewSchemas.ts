import { z } from 'zod';

import {
  superResolutionAlignmentModeSchema,
  superResolutionDetailPolicySchema,
  superResolutionQualityPreferenceSchema,
} from './superResolutionUiSchemas';

export const superResolutionOutputReviewDecisionSchema = z.enum(['human_review_required', 'preview_only', 'blocked']);

export const superResolutionOutputReviewWarningSchema = z.enum([
  'effective_scale_downgraded',
  'human_review_required',
  'synthetic_runtime_only',
  'texture_risk',
  'aggressive_preview_only',
]);

export const superResolutionOutputReviewEditableGateSchema = z.enum([
  'blocked_review_required',
  'blocked_stale',
  'ready',
]);

export const superResolutionOutputReviewStaleStateSchema = z.enum(['current', 'stale', 'unknown']);

export const superResolutionOutputReviewWorkflowSchema = z
  .object({
    alignmentMode: superResolutionAlignmentModeSchema,
    artifactPath: z.string().min(1),
    editableGate: superResolutionOutputReviewEditableGateSchema,
    decision: superResolutionOutputReviewDecisionSchema,
    detailPolicy: superResolutionDetailPolicySchema,
    detailGainRatio: z.number().positive().nullable(),
    humanReviewStatus: z.enum(['failed', 'not_required', 'passed', 'pending']),
    outputArtifactHash: z.string().trim().min(1),
    outputArtifactId: z.string().min(1),
    outputHeight: z.number().int().positive(),
    outputWidth: z.number().int().positive(),
    outputScale: z.number().min(1.1).max(4),
    overlapCoverageRatio: z.number().min(0).max(1).nullable(),
    proofLevel: z.literal('synthetic_runtime'),
    qualityPreference: superResolutionQualityPreferenceSchema,
    reviewCropCount: z.number().int().nonnegative(),
    reviewPacketPath: z.string().min(1),
    sourceCount: z.number().int().min(2),
    staleState: superResolutionOutputReviewStaleStateSchema,
    warningCodes: z.array(superResolutionOutputReviewWarningSchema).min(1),
  })
  .strict();

export type SuperResolutionOutputReviewWorkflow = z.infer<typeof superResolutionOutputReviewWorkflowSchema>;
