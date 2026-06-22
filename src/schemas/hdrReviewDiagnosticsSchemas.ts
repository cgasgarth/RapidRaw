import { z } from 'zod';

export const hdrReviewDecisionSchema = z.enum(['accepted', 'rejected']);
export const hdrReviewWarningSeveritySchema = z.enum(['ok', 'review', 'blocked']);
export const hdrReviewMetricStatusSchema = z.enum(['ready', 'review', 'pending']);

export const hdrReviewDiagnosticsSchema = z
  .object({
    alignment: z
      .object({
        confidencePercent: z.number().int().min(0).max(100),
        mode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
        status: hdrReviewMetricStatusSchema,
      })
      .strict(),
    deghost: z
      .object({
        confidenceMapVisible: z.boolean(),
        level: z.enum(['off', 'low', 'medium', 'high']),
        motionRisk: z.enum(['none', 'low', 'medium', 'high']),
        regionIntensityPercent: z.number().int().min(0).max(100),
        status: hdrReviewMetricStatusSchema,
      })
      .strict(),
    nonClaims: z.array(
      z.enum(['not_real_raw_e2e_verified', 'not_photographer_accepted', 'not_export_parity_verified']),
    ),
    proofLevel: z.literal('synthetic_runtime'),
    reviewDecision: hdrReviewDecisionSchema,
    tone: z
      .object({
        clippingRisk: z.enum(['low', 'medium', 'high']),
        policy: z.enum(['editable_linear_request', 'tone_mapped_preview_review']),
        status: hdrReviewMetricStatusSchema,
      })
      .strict(),
    warningCodes: z.array(z.string().trim().min(1)),
    warningSeverity: hdrReviewWarningSeveritySchema,
  })
  .strict();

export type HdrReviewDiagnostics = z.infer<typeof hdrReviewDiagnosticsSchema>;
export type HdrReviewDecision = z.infer<typeof hdrReviewDecisionSchema>;
export type HdrReviewWarningSeverity = z.infer<typeof hdrReviewWarningSeveritySchema>;
export type HdrReviewMetricStatus = z.infer<typeof hdrReviewMetricStatusSchema>;
