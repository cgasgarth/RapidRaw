import { z } from 'zod';

import {
  type SuperResolutionTiledApplyReceipt,
  superResolutionTiledApplyReceiptSchema,
} from './derivedOutputReceiptSchemas';
import {
  superResolutionAlignmentModeSchema,
  superResolutionDetailPolicySchema,
  superResolutionModeSchema,
  superResolutionQualityPreferenceSchema,
  superResolutionReconstructionModeSchema,
} from './superResolutionUiSchemas';

const superResolutionOutputReviewDecisionSchema = z.enum(['human_review_required', 'preview_only', 'blocked']);

const superResolutionOutputReviewWarningSchema = z.enum([
  'effective_scale_downgraded',
  'human_review_required',
  'low_overlap_coverage',
  'synthetic_runtime_only',
  'texture_risk',
  'aggressive_preview_only',
]);

const superResolutionOutputReviewEditableGateSchema = z.enum(['blocked_review_required', 'blocked_stale', 'ready']);

const superResolutionOutputReviewStaleStateSchema = z.enum(['current', 'stale', 'unknown']);
const superResolutionFalseDetailRiskSchema = z.enum(['unknown', 'low', 'medium', 'high']);

const superResolutionOutputReviewSourceRefSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    path: z.string().trim().min(1).optional(),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

const superResolutionOutputReviewArtifactSchema = z
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

const superResolutionSupportMapRegionSchema = z
  .object({
    coverageRatio: z.number().min(0).max(1),
    label: z.string().trim().min(1),
    regionId: z.string().trim().min(1),
    risk: z.enum(['edge_risk', 'motion_rejected', 'supported', 'weak_support']),
  })
  .strict();

const superResolutionSupportMapDowngradeReasonSchema = z.literal('effective_scale_downgraded');

const superResolutionDetailReviewRegionSchema = z
  .object({
    baselineSharpnessScore: z.number().min(0).max(1),
    improvementRatio: z.number().min(0),
    label: z.string().trim().min(1),
    reconstructedSharpnessScore: z.number().min(0).max(1),
    regionId: z.string().trim().min(1),
    reviewStatus: z.enum(['accepted', 'needs_review', 'rejected']),
  })
  .strict();

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
    downscaleReconstructionError: z.number().min(0).nullable(),
    editableGate: superResolutionOutputReviewEditableGateSchema,
    decision: superResolutionOutputReviewDecisionSchema,
    detailGainRatio: z.number().positive().nullable(),
    detailPolicy: superResolutionDetailPolicySchema,
    detailReview: z
      .object({
        artifactId: z.string().trim().min(1),
        baselineArtifactId: z.string().trim().min(1),
        improvementHighlightCount: z.number().int().nonnegative(),
        meanImprovementRatio: z.number().min(0),
        reconstructedArtifactId: z.string().trim().min(1),
        regions: z.array(superResolutionDetailReviewRegionSchema).min(1),
        reviewStatus: z.enum(['accepted', 'needs_review', 'rejected']),
      })
      .strict(),
    falseDetailRisk: superResolutionFalseDetailRiskSchema,
    falseDetailRiskScore: z.number().min(0).max(1).nullable(),
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
    reconstructionMode: superResolutionReconstructionModeSchema,
    registrationMetrics: z
      .object({
        algorithmId: z.literal('output_lattice_phase_residual_v1'),
        averageConfidence: z.number().min(0).max(1),
        averageResidualPx: z.number().min(0),
        maxResidualPx: z.number().min(0),
        measuredSubpixelFrameCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    reviewArtifacts: z.array(superResolutionOutputReviewArtifactSchema).min(1),
    reviewCropCount: z.number().int().nonnegative(),
    reviewPacketPath: z.string().min(1),
    sourceCount: z.number().int().min(2),
    sourceRefs: z.array(superResolutionOutputReviewSourceRefSchema).min(2),
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
    tiledApplyReceipt: superResolutionTiledApplyReceiptSchema.optional(),
    warningCodes: z.array(superResolutionOutputReviewWarningSchema),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.sourceRefs.length !== review.sourceCount) {
      context.addIssue({
        code: 'custom',
        message: 'SR output review sourceRefs length must match sourceCount.',
        path: ['sourceRefs'],
      });
    }
  });

export type SuperResolutionOutputReviewWorkflow = z.infer<typeof superResolutionOutputReviewWorkflowSchema>;
export type { SuperResolutionTiledApplyReceipt };
