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
export const focusStackSourceContributionWarningStateSchema = z.enum(['artifact_review_required', 'clear']);
export const focusStackEditableHandoffStatusSchema = z.enum(['blocked', 'ready', 'review_required']);
export const focusStackHaloReviewStatusSchema = z.enum(['apply_ready', 'blocked', 'review_required']);

export const focusStackOutputReviewWorkflowSchema = z
  .object({
    alignmentMode: focusStackAlignmentModeSchema,
    artifactPath: z.string().min(1),
    blendMethod: focusStackBlendMethodSchema,
    decision: focusStackOutputReviewDecisionSchema,
    editableHandoff: z
      .object({
        artifactHash: z.string().trim().min(1),
        artifactId: z.string().trim().min(1),
        exportReviewArtifactId: z.string().trim().min(1),
        status: focusStackEditableHandoffStatusSchema,
      })
      .strict(),
    haloRiskCellRatio: z.number().min(0).max(1),
    haloReview: z
      .object({
        artifactId: z.string().trim().min(1),
        reviewStatus: focusStackHaloReviewStatusSchema,
        transitionRiskRegions: z
          .array(
            z
              .object({
                cellCount: z.number().int().nonnegative(),
                regionId: z.string().trim().min(1),
                risk: z.enum(['halo_risk', 'low_confidence', 'retouch_recommended', 'stable']),
                sourceIndex: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
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
        sourceContributionDetails: z
          .array(
            z
              .object({
                artifactId: z.string().min(1),
                contributionRatio: z.number().min(0).max(1),
                sourceId: z.string().min(1),
                sourceIndex: z.number().int().nonnegative(),
                warningState: focusStackSourceContributionWarningStateSchema,
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
