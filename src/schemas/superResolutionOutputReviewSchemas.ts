import { z } from 'zod';

import {
  superResolutionAlignmentModeSchema,
  superResolutionDetailPolicySchema,
  superResolutionModeSchema,
  superResolutionQualityPreferenceSchema,
} from './superResolutionUiSchemas';

export const superResolutionOutputReviewDecisionSchema = z.enum(['human_review_required', 'preview_only', 'blocked']);

export const superResolutionOutputReviewWarningSchema = z.enum([
  'effective_scale_downgraded',
  'human_review_required',
  'low_overlap_coverage',
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
export const superResolutionFalseDetailRiskSchema = z.enum(['unknown', 'low', 'medium', 'high']);

export const superResolutionOutputReviewArtifactSchema = z
  .object({
    contentHash: z
      .string()
      .trim()
      .regex(/^sha256:[a-f0-9]{64}$/u),
    kind: z.enum(['baseline_review_crop', 'crop_review_sheet', 'reconstruction_preview', 'reconstruction_review_crop']),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.boolean(),
  })
  .strict();

export const superResolutionSupportMapRegionSchema = z
  .object({
    coverageRatio: z.number().min(0).max(1),
    label: z.string().trim().min(1),
    regionId: z.string().trim().min(1),
    risk: z.enum(['edge_risk', 'motion_rejected', 'supported', 'weak_support']),
  })
  .strict();

export const superResolutionSupportMapDowngradeReasonSchema = z.literal('effective_scale_downgraded');

export const superResolutionOutputReviewWorkflowSchema = z
  .object({
    alignmentMode: superResolutionAlignmentModeSchema,
    artifactPath: z.string().min(1),
    alignmentConfidence: z.number().min(0).max(1).nullable(),
    cropMetrics: z
      .object({
        outputHeight: z.number().int().positive(),
        outputWidth: z.number().int().positive(),
        overlapCoverageRatio: z.number().min(0).max(1).nullable(),
        reviewCropCount: z.number().int().nonnegative(),
      })
      .strict(),
    editableGate: superResolutionOutputReviewEditableGateSchema,
    decision: superResolutionOutputReviewDecisionSchema,
    detailPolicy: superResolutionDetailPolicySchema,
    detailGainRatio: z.number().positive().nullable(),
    falseDetailRisk: superResolutionFalseDetailRiskSchema,
    humanReviewStatus: z.enum(['failed', 'not_required', 'passed', 'pending']),
    mode: superResolutionModeSchema,
    modePolicyVersion: z.literal(1),
    outputArtifactHash: z.string().trim().min(1),
    outputArtifactId: z.string().min(1),
    outputHeight: z.number().int().positive(),
    outputWidth: z.number().int().positive(),
    outputScale: z.number().min(1.1).max(4),
    overlapCoverageRatio: z.number().min(0).max(1).nullable(),
    proofLevel: z.literal('synthetic_runtime'),
    qualityPreference: superResolutionQualityPreferenceSchema,
    reviewArtifacts: z.array(superResolutionOutputReviewArtifactSchema).min(1),
    reviewCropCount: z.number().int().nonnegative(),
    reviewPacketPath: z.string().min(1),
    sourceCount: z.number().int().min(2),
    staleState: superResolutionOutputReviewStaleStateSchema,
    supportMap: z
      .object({
        artifactId: z.string().trim().min(1),
        coverageRatio: z.number().min(0).max(1),
        downgradeReason: superResolutionSupportMapDowngradeReasonSchema.nullable(),
        effectiveScale: z.number().min(1).max(4),
        regions: z.array(superResolutionSupportMapRegionSchema).min(1),
        requestedScale: z.number().min(1.1).max(4),
        reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
        weakSupportRatio: z.number().min(0).max(1),
      })
      .strict(),
    warningCodes: z.array(superResolutionOutputReviewWarningSchema),
  })
  .strict();

export type SuperResolutionOutputReviewWorkflow = z.infer<typeof superResolutionOutputReviewWorkflowSchema>;
