import { z } from 'zod';

export const NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION = 1;

export const negativeLabFrameHealthStatusSchema = z.enum(['active', 'queued', 'skipped']);
export const negativeLabFrameBaseStatusSchema = z.enum(['pending', 'estimated']);
export const negativeLabFrameWarningCodeSchema = z.enum([
  'base_estimate_active_frame_only',
  'excluded_from_batch',
  'preview_not_ready',
]);

export const negativeLabFrameHealthEntrySchema = z
  .object({
    active: z.boolean(),
    baseConfidence: z.number().min(0).max(1).nullable(),
    baseStatus: negativeLabFrameBaseStatusSchema,
    frameId: z.string().trim().min(1),
    healthStatus: negativeLabFrameHealthStatusSchema,
    included: z.boolean(),
    pathIndex: z.number().int().nonnegative(),
    scanLabel: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    warningCodes: z.array(negativeLabFrameWarningCodeSchema),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.healthStatus === 'skipped' && !frame.warningCodes.includes('excluded_from_batch')) {
      context.addIssue({
        code: 'custom',
        message: 'Skipped Negative Lab frames must disclose batch exclusion.',
        path: ['warningCodes'],
      });
    }

    if (frame.baseStatus === 'estimated' && frame.baseConfidence === null) {
      context.addIssue({
        code: 'custom',
        message: 'Estimated Negative Lab frame base status requires confidence.',
        path: ['baseConfidence'],
      });
    }

    if (frame.baseStatus === 'pending' && frame.baseConfidence !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Pending Negative Lab frame base status must not include confidence.',
        path: ['baseConfidence'],
      });
    }
  });

export const negativeLabFrameHealthReportSchema = z
  .object({
    activeFrameId: z.string().trim().min(1).nullable(),
    frames: z.array(negativeLabFrameHealthEntrySchema),
    includedCount: z.number().int().nonnegative(),
    queuedCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION),
    warningCodes: z.array(negativeLabFrameWarningCodeSchema),
  })
  .strict()
  .superRefine((report, context) => {
    const activeFrames = report.frames.filter((frame) => frame.active);
    if (activeFrames.length > 1) {
      context.addIssue({ code: 'custom', message: 'Negative Lab report must have at most one active frame.' });
    }

    const includedCount = report.frames.filter((frame) => frame.included).length;
    if (includedCount !== report.includedCount) {
      context.addIssue({ code: 'custom', message: 'Negative Lab included count is stale.', path: ['includedCount'] });
    }

    const queuedCount = report.frames.filter((frame) => frame.healthStatus !== 'skipped').length;
    if (queuedCount !== report.queuedCount) {
      context.addIssue({ code: 'custom', message: 'Negative Lab queued count is stale.', path: ['queuedCount'] });
    }

    if ((activeFrames[0]?.frameId ?? null) !== report.activeFrameId) {
      context.addIssue({ code: 'custom', message: 'Negative Lab active frame id is stale.', path: ['activeFrameId'] });
    }
  });

export const negativeLabBatchDryRunSummarySchema = z
  .object({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    blocked: z.boolean(),
    frameHealthReport: negativeLabFrameHealthReportSchema,
    plannedApplyCount: z.number().int().nonnegative(),
    rollWarningCodes: z.array(negativeLabFrameWarningCodeSchema),
    schemaVersion: z.literal(NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION),
    skippedFrameIds: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((summary, context) => {
    const affectedFrameIds = summary.frameHealthReport.frames
      .filter((frame) => frame.healthStatus !== 'skipped')
      .map((frame) => frame.frameId);
    if (summary.affectedFrameIds.join('\n') !== affectedFrameIds.join('\n')) {
      context.addIssue({ code: 'custom', message: 'Negative Lab dry-run affected frames are stale.' });
    }

    const skippedFrameIds = summary.frameHealthReport.frames
      .filter((frame) => frame.healthStatus === 'skipped')
      .map((frame) => frame.frameId);
    if (summary.skippedFrameIds.join('\n') !== skippedFrameIds.join('\n')) {
      context.addIssue({ code: 'custom', message: 'Negative Lab dry-run skipped frames are stale.' });
    }

    if (summary.plannedApplyCount !== summary.affectedFrameIds.length) {
      context.addIssue({ code: 'custom', message: 'Negative Lab dry-run apply count is stale.' });
    }

    if (summary.blocked && summary.affectedFrameIds.length > 0) {
      context.addIssue({ code: 'custom', message: 'Blocked Negative Lab dry-runs cannot include apply frames.' });
    }
  });

export type NegativeLabFrameHealthStatus = z.infer<typeof negativeLabFrameHealthStatusSchema>;
export type NegativeLabFrameWarningCode = z.infer<typeof negativeLabFrameWarningCodeSchema>;
export type NegativeLabFrameHealthEntry = z.infer<typeof negativeLabFrameHealthEntrySchema>;
export type NegativeLabFrameHealthReport = z.infer<typeof negativeLabFrameHealthReportSchema>;
export type NegativeLabBatchDryRunSummary = z.infer<typeof negativeLabBatchDryRunSummarySchema>;

export const parseNegativeLabFrameHealthReport = (value: unknown): NegativeLabFrameHealthReport =>
  negativeLabFrameHealthReportSchema.parse(value);

export const parseNegativeLabBatchDryRunSummary = (value: unknown): NegativeLabBatchDryRunSummary =>
  negativeLabBatchDryRunSummarySchema.parse(value);
