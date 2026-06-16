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
  'base_fog_only_review',
  'edge_dust_check',
  'emulsion_scratch_check',
  'excluded_not_reviewed',
  'preview_required',
]);

export const negativeLabDustScratchReviewFrameSchema = z
  .object({
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
  });

export const negativeLabDustScratchReviewReportSchema = z
  .object({
    frames: z.array(negativeLabDustScratchReviewFrameSchema).min(1),
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

export const negativeLabWorkspaceProofSchema = z
  .object({
    activeStage: negativeLabWorkspaceStageIdSchema,
    exportReady: z.boolean(),
    previewReady: z.boolean(),
    queuedCount: z.number().int().nonnegative(),
    reviewReport: negativeLabDustScratchReviewReportSchema,
    schemaVersion: z.literal(NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION),
    targetCount: z.number().int().positive(),
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
export type NegativeLabWorkspaceProof = z.infer<typeof negativeLabWorkspaceProofSchema>;
export type NegativeLabWorkspaceStageId = z.infer<typeof negativeLabWorkspaceStageIdSchema>;

export const parseNegativeLabDustScratchReviewReport = (value: unknown): NegativeLabDustScratchReviewReport =>
  negativeLabDustScratchReviewReportSchema.parse(value);

export const parseNegativeLabWorkspaceProof = (value: unknown): NegativeLabWorkspaceProof =>
  negativeLabWorkspaceProofSchema.parse(value);
