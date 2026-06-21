import { z } from 'zod';

import {
  superResolutionAlignmentModeSchema,
  superResolutionDetailPolicySchema,
  superResolutionQualityPreferenceSchema,
} from './superResolutionUiSchemas';

export const superResolutionOutputReviewDecisionSchema = z.enum(['human_review_required', 'preview_only', 'blocked']);

export const superResolutionOutputReviewWarningSchema = z.enum([
  'human_review_required',
  'synthetic_runtime_only',
  'texture_risk',
  'aggressive_preview_only',
]);

export const superResolutionOutputReviewWorkflowSchema = z
  .object({
    alignmentMode: superResolutionAlignmentModeSchema,
    artifactPath: z.string().min(1),
    decision: superResolutionOutputReviewDecisionSchema,
    detailPolicy: superResolutionDetailPolicySchema,
    detailGainRatio: z.number().positive(),
    outputScale: z.number().min(1.1).max(4),
    proofLevel: z.literal('synthetic_runtime'),
    qualityPreference: superResolutionQualityPreferenceSchema,
    reviewCropCount: z.number().int().nonnegative(),
    reviewPacketPath: z.string().min(1),
    sourceCount: z.number().int().min(2),
    warningCodes: z.array(superResolutionOutputReviewWarningSchema).min(1),
  })
  .strict();

export type SuperResolutionOutputReviewWorkflow = z.infer<typeof superResolutionOutputReviewWorkflowSchema>;
