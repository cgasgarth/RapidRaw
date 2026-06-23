import { z } from 'zod';

export const NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION = 1;

export const negativeLabWorkspaceStageIdSchema = z.enum([
  'setup',
  'filmProfile',
  'colorInversion',
  'inspection',
  'printGrade',
  'export',
]);
export const negativeLabDustScratchSeveritySchema = z.enum(['clear', 'review', 'retouch']);
export const negativeLabDustScratchFindingCodeSchema = z.enum([
  'acquisition_review_required',
  'base_fog_only_review',
  'candidate_dust_spot',
  'candidate_emulsion_scratch',
  'edge_dust_check',
  'emulsion_scratch_check',
  'excluded_not_reviewed',
  'preview_required',
]);

export const negativeLabDustScratchCandidateSchema = z
  .object({
    candidateId: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    geometry: z
      .object({
        coordinateSpace: z.literal('normalized_frame'),
        height: z.number().positive().max(1),
        kind: z.literal('rect'),
        width: z.number().positive().max(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict(),
    kind: z.enum(['dust_spot', 'emulsion_scratch']),
    status: z.enum(['acknowledged', 'ignored', 'pending']),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.geometry.x + candidate.geometry.width > 1 || candidate.geometry.y + candidate.geometry.height > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab defect candidate geometry must fit within the normalized frame.',
        path: ['geometry'],
      });
    }
  });

export const negativeLabDustScratchReviewFrameSchema = z
  .object({
    candidates: z.array(negativeLabDustScratchCandidateSchema),
    findingCodes: z.array(negativeLabDustScratchFindingCodeSchema).min(1),
    frameId: z.string().trim().min(1),
    included: z.boolean(),
    recommendation: z.string().trim().min(1).max(160),
    scanLabel: z.string().trim().min(1),
    severity: negativeLabDustScratchSeveritySchema,
  })
  .strict()
  .superRefine((frame, context) => {
    if (!frame.included && !frame.findingCodes.includes('excluded_not_reviewed')) {
      context.addIssue({
        code: 'custom',
        message: 'Excluded Negative Lab frames must disclose that they were not reviewed.',
        path: ['findingCodes'],
      });
    }

    if (frame.severity === 'clear' && frame.findingCodes.includes('preview_required')) {
      context.addIssue({
        code: 'custom',
        message: 'Frames that still need preview cannot be marked clear.',
        path: ['severity'],
      });
    }

    if (frame.candidates.some((candidate) => candidate.status === 'pending') && frame.severity === 'clear') {
      context.addIssue({
        code: 'custom',
        message: 'Frames with pending defect candidates must stay in review.',
        path: ['severity'],
      });
    }
  });

export const negativeLabDustScratchReviewReportSchema = z
  .object({
    frames: z.array(negativeLabDustScratchReviewFrameSchema),
    reviewCount: z.number().int().nonnegative(),
    retouchCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((report, context) => {
    const reviewCount = report.frames.filter((frame) => frame.severity === 'review').length;
    if (report.reviewCount !== reviewCount) {
      context.addIssue({ code: 'custom', message: 'Negative Lab review count is stale.', path: ['reviewCount'] });
    }

    const retouchCount = report.frames.filter((frame) => frame.severity === 'retouch').length;
    if (report.retouchCount !== retouchCount) {
      context.addIssue({ code: 'custom', message: 'Negative Lab retouch count is stale.', path: ['retouchCount'] });
    }
  });

export const negativeLabQcProofRowSchema = z
  .object({
    candidates: z.array(negativeLabDustScratchCandidateSchema),
    contactSheetSlot: z.number().int().positive(),
    exportBlockedReason: z.string().trim().min(1).max(120).nullable(),
    findingCodes: z.array(negativeLabDustScratchFindingCodeSchema).min(1),
    frameId: z.string().trim().min(1),
    included: z.boolean(),
    needsReview: z.boolean(),
    previewReady: z.boolean(),
    recommendedAction: z.string().trim().min(1).max(160),
    scanLabel: z.string().trim().min(1),
  })
  .strict()
  .superRefine((row, context) => {
    if (!row.included && row.exportBlockedReason === null) {
      context.addIssue({
        code: 'custom',
        message: 'Excluded Negative Lab QC rows must include an export block reason.',
        path: ['exportBlockedReason'],
      });
    }

    if (!row.previewReady && row.exportBlockedReason === null) {
      context.addIssue({
        code: 'custom',
        message: 'QC rows without preview must include an export block reason.',
        path: ['exportBlockedReason'],
      });
    }
  });

export const negativeLabQcProofReportSchema = z
  .object({
    contactSheetColumnCount: z.number().int().min(1).max(8),
    exportReady: z.boolean(),
    frames: z.array(negativeLabQcProofRowSchema),
    includedFrameCount: z.number().int().nonnegative(),
    reviewFrameCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION),
    totalFrameCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.frames.length !== report.totalFrameCount) {
      context.addIssue({ code: 'custom', message: 'QC proof total frame count is stale.', path: ['totalFrameCount'] });
    }

    const includedFrameCount = report.frames.filter((frame) => frame.included).length;
    if (includedFrameCount !== report.includedFrameCount) {
      context.addIssue({
        code: 'custom',
        message: 'QC proof included frame count is stale.',
        path: ['includedFrameCount'],
      });
    }

    const reviewFrameCount = report.frames.filter((frame) => frame.needsReview).length;
    if (reviewFrameCount !== report.reviewFrameCount) {
      context.addIssue({
        code: 'custom',
        message: 'QC proof review frame count is stale.',
        path: ['reviewFrameCount'],
      });
    }

    if (report.exportReady && report.frames.some((frame) => frame.exportBlockedReason !== null)) {
      context.addIssue({ code: 'custom', message: 'Export-ready QC proof cannot include blocked rows.' });
    }
  });

export const negativeLabWorkspaceProofSchema = z
  .object({
    activeStage: negativeLabWorkspaceStageIdSchema,
    exportReady: z.boolean(),
    previewReady: z.boolean(),
    queuedCount: z.number().int().nonnegative(),
    reviewReport: negativeLabDustScratchReviewReportSchema,
    schemaVersion: z.literal(NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION),
    targetCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.queuedCount > proof.targetCount) {
      context.addIssue({ code: 'custom', message: 'Queued count cannot exceed target count.', path: ['queuedCount'] });
    }

    if (proof.exportReady && (!proof.previewReady || proof.queuedCount === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab export requires preview and queued frames.',
        path: ['exportReady'],
      });
    }
  });

export type NegativeLabDustScratchReviewReport = z.infer<typeof negativeLabDustScratchReviewReportSchema>;
export type NegativeLabQcProofReport = z.infer<typeof negativeLabQcProofReportSchema>;
export type NegativeLabWorkspaceProof = z.infer<typeof negativeLabWorkspaceProofSchema>;
export type NegativeLabWorkspaceStageId = z.infer<typeof negativeLabWorkspaceStageIdSchema>;

export const parseNegativeLabDustScratchReviewReport = (value: unknown): NegativeLabDustScratchReviewReport =>
  negativeLabDustScratchReviewReportSchema.parse(value);

export const parseNegativeLabQcProofReport = (value: unknown): NegativeLabQcProofReport =>
  negativeLabQcProofReportSchema.parse(value);

export const parseNegativeLabWorkspaceProof = (value: unknown): NegativeLabWorkspaceProof =>
  negativeLabWorkspaceProofSchema.parse(value);
