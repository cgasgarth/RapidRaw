import { z } from 'zod';

import {
  focusStackAlignmentModeSchema,
  focusStackBlendMethodSchema,
  focusStackQualityPreferenceSchema,
  focusStackReviewOverlayModeSchema,
  focusStackRetouchLayerPolicySchema,
} from './focusStackUiSchemas';

export const focusStackOutputReviewDecisionSchema = z.enum(['editable_review_required', 'preview_only', 'blocked']);

export const focusStackOutputReviewWarningSchema = z.enum([
  'human_review_required',
  'synthetic_runtime_only',
  'transition_halo_risk',
  'depth_map_preview_only',
  'unsupported_blend_method_preview_only',
  'retouch_layer_deferred',
]);

export const focusStackOutputReviewWorkflowSchema = z
  .object({
    alignmentMode: focusStackAlignmentModeSchema,
    artifactPath: z.string().min(1),
    blendMethod: focusStackBlendMethodSchema,
    decision: focusStackOutputReviewDecisionSchema,
    haloRiskCellRatio: z.number().min(0).max(1),
    lowConfidenceCellRatio: z.number().min(0).max(1),
    proofLevel: z.literal('synthetic_runtime'),
    qualityPreference: focusStackQualityPreferenceSchema,
    retouchLayerPolicy: focusStackRetouchLayerPolicySchema,
    reviewOverlay: z
      .object({
        confidenceMarginThreshold: z.number().min(0).max(1),
        mode: focusStackReviewOverlayModeSchema,
        opacityPercent: z.number().int().min(25).max(100),
        sourceContributionSummary: z
          .array(
            z
              .object({
                sourceIndex: z.number().int().nonnegative(),
                winnerCellRatio: z.number().min(0).max(1),
              })
              .strict(),
          )
          .min(2),
      })
      .strict(),
    sharpnessCoverageRatio: z.number().min(0).max(1),
    sourceCount: z.number().int().min(2),
    warningCodes: z.array(focusStackOutputReviewWarningSchema).min(1),
  })
  .strict();

export type FocusStackOutputReviewWorkflow = z.infer<typeof focusStackOutputReviewWorkflowSchema>;
