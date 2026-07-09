import { z } from 'zod';

export const NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION = 1;

export const negativeLabFrameHealthStatusSchema = z.enum(['active', 'queued', 'skipped']);
export const negativeLabFrameBaseStatusSchema = z.enum(['pending', 'estimated']);
export const negativeLabFrameBaseScopeSchema = z.enum(['frame', 'roll']);
export const negativeLabFrameConversionStatusSchema = z.enum(['preview_pending', 'preview_ready', 'queued', 'skipped']);
export const negativeLabFrameCropStatusSchema = z.enum([
  'active_frame_editable',
  'detected_frame',
  'manual_override',
  'roll_default',
  'skipped',
]);
export const negativeLabFrameQcStatusSchema = z.enum(['ready', 'review', 'skipped']);
export const negativeLabFrameBatchDispositionSchema = z.enum(['apply', 'review', 'skip']);
export const negativeLabFrameBatchDispositionReasonSchema = z.enum([
  'acquisition_review_required',
  'base_not_estimated',
  'bounds_review_required',
  'excluded_from_batch',
  'preview_required',
  'ready_to_apply',
]);
export const negativeLabFrameWarningSeveritySchema = z.enum(['ok', 'info', 'review']);
export const negativeLabFrameWarningCodeSchema = z.enum([
  'base_estimate_active_frame_only',
  'bounds_missing_visible_base',
  'bounds_narrow_luma_span',
  'bounds_uneven_base_fog',
  'excluded_from_batch',
  'preview_not_ready',
]);
export const negativeLabAcquisitionWarningCodeSchema = z.enum([
  'lab_processed_input_for_negative_lab',
  'lossy_source_for_negative_lab',
  'mixed_source_families',
  'unknown_acquisition_state',
]);
export const negativeLabAcquisitionSourceFamilySchema = z.enum(['jpeg_lossy', 'raw_like', 'tiff_scan', 'unknown']);
export const negativeLabAcquisitionSeveritySchema = z.enum(['ok', 'review']);
export const negativeLabFrameAcquisitionHealthSchema = z
  .object({
    severity: negativeLabAcquisitionSeveritySchema,
    sourceFamily: negativeLabAcquisitionSourceFamilySchema,
    warningCodes: z.array(
      z.enum(['lab_processed_input_for_negative_lab', 'lossy_source_for_negative_lab', 'unknown_acquisition_state']),
    ),
  })
  .strict()
  .superRefine((health, context) => {
    if (health.severity === 'ok' && health.warningCodes.length > 0) {
      context.addIssue({ code: 'custom', message: 'OK acquisition health cannot include warnings.' });
    }

    if (health.severity === 'review' && health.warningCodes.length === 0) {
      context.addIssue({ code: 'custom', message: 'Review acquisition health requires warning codes.' });
    }
  });

export const negativeLabAcquisitionHealthReportSchema = z
  .object({
    lossyCount: z.number().int().nonnegative(),
    rawLikeCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(NEGATIVE_LAB_FRAME_HEALTH_SCHEMA_VERSION),
    severity: negativeLabAcquisitionSeveritySchema,
    sourceFamilies: z.array(negativeLabAcquisitionSourceFamilySchema).min(1),
    tiffScanCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    unknownCount: z.number().int().nonnegative(),
    warningCodes: z.array(negativeLabAcquisitionWarningCodeSchema),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.lossyCount + report.rawLikeCount + report.tiffScanCount + report.unknownCount !== report.totalCount) {
      context.addIssue({ code: 'custom', message: 'Negative Lab acquisition source counts are stale.' });
    }

    if (report.severity === 'ok' && report.warningCodes.length > 0) {
      context.addIssue({ code: 'custom', message: 'OK Negative Lab acquisition health cannot include warnings.' });
    }

    if (report.severity === 'review' && report.warningCodes.length === 0) {
      context.addIssue({ code: 'custom', message: 'Review Negative Lab acquisition health requires warnings.' });
    }
  });

export const negativeLabFrameHealthEntrySchema = z
  .object({
    active: z.boolean(),
    acquisitionSourceFamily: negativeLabAcquisitionSourceFamilySchema,
    acquisitionWarningCodes: negativeLabFrameAcquisitionHealthSchema.shape.warningCodes,
    baseConfidence: z.number().min(0).max(1).nullable(),
    baseScope: negativeLabFrameBaseScopeSchema,
    baseStatus: negativeLabFrameBaseStatusSchema,
    batchDisposition: negativeLabFrameBatchDispositionSchema,
    batchDispositionReason: negativeLabFrameBatchDispositionReasonSchema,
    conversionStatus: negativeLabFrameConversionStatusSchema,
    cropStatus: negativeLabFrameCropStatusSchema,
    frameId: z.string().trim().min(1),
    healthStatus: negativeLabFrameHealthStatusSchema,
    included: z.boolean(),
    pathIndex: z.number().int().nonnegative(),
    qcStatus: negativeLabFrameQcStatusSchema,
    scanLabel: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    warningCodes: z.array(negativeLabFrameWarningCodeSchema),
    warningSeverity: negativeLabFrameWarningSeveritySchema,
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

    if (frame.baseScope === 'roll' && frame.baseStatus !== 'estimated') {
      context.addIssue({
        code: 'custom',
        message: 'Roll-scoped Negative Lab base frames must carry an estimate.',
        path: ['baseScope'],
      });
    }
  });

export const negativeLabFrameHealthReportSchema = z
  .object({
    activeFrameId: z.string().trim().min(1).nullable(),
    acquisitionHealth: negativeLabAcquisitionHealthReportSchema,
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
    acquisitionReviewFrameIds: z.array(z.string().trim().min(1)),
    blocked: z.boolean(),
    dispositionCounts: z
      .object({
        apply: z.number().int().nonnegative(),
        review: z.number().int().nonnegative(),
        skip: z.number().int().nonnegative(),
      })
      .strict(),
    frameHealthReport: negativeLabFrameHealthReportSchema,
    plannedApplyCount: z.number().int().nonnegative(),
    reviewFrameIds: z.array(z.string().trim().min(1)),
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

    const dispositionCounts = summary.frameHealthReport.frames.reduce(
      (counts, frame) => ({ ...counts, [frame.batchDisposition]: counts[frame.batchDisposition] + 1 }),
      { apply: 0, review: 0, skip: 0 },
    );
    if (
      summary.dispositionCounts.apply !== dispositionCounts.apply ||
      summary.dispositionCounts.review !== dispositionCounts.review ||
      summary.dispositionCounts.skip !== dispositionCounts.skip
    ) {
      context.addIssue({ code: 'custom', message: 'Negative Lab dry-run disposition counts are stale.' });
    }

    const reviewFrameIds = summary.frameHealthReport.frames
      .filter((frame) => frame.batchDisposition === 'review')
      .map((frame) => frame.frameId);
    if (summary.reviewFrameIds.join('\n') !== reviewFrameIds.join('\n')) {
      context.addIssue({ code: 'custom', message: 'Negative Lab dry-run review frames are stale.' });
    }

    const acquisitionReviewFrameIds = summary.frameHealthReport.frames
      .filter((frame) => frame.acquisitionWarningCodes.length > 0)
      .map((frame) => frame.frameId);
    if (summary.acquisitionReviewFrameIds.join('\n') !== acquisitionReviewFrameIds.join('\n')) {
      context.addIssue({ code: 'custom', message: 'Negative Lab acquisition review frames are stale.' });
    }

    if (summary.blocked && summary.affectedFrameIds.length > 0) {
      context.addIssue({ code: 'custom', message: 'Blocked Negative Lab dry-runs cannot include apply frames.' });
    }
  });

export type NegativeLabFrameHealthStatus = z.infer<typeof negativeLabFrameHealthStatusSchema>;
export type NegativeLabFrameBaseScope = z.infer<typeof negativeLabFrameBaseScopeSchema>;
export type NegativeLabFrameCropStatus = z.infer<typeof negativeLabFrameCropStatusSchema>;
export type NegativeLabFrameWarningSeverity = z.infer<typeof negativeLabFrameWarningSeveritySchema>;
export type NegativeLabFrameWarningCode = z.infer<typeof negativeLabFrameWarningCodeSchema>;
export type NegativeLabFrameBatchDisposition = z.infer<typeof negativeLabFrameBatchDispositionSchema>;
export type NegativeLabFrameBatchDispositionReason = z.infer<typeof negativeLabFrameBatchDispositionReasonSchema>;
export type NegativeLabAcquisitionSourceFamily = z.infer<typeof negativeLabAcquisitionSourceFamilySchema>;
export type NegativeLabAcquisitionWarningCode = z.infer<typeof negativeLabAcquisitionWarningCodeSchema>;
export type NegativeLabFrameAcquisitionHealth = z.infer<typeof negativeLabFrameAcquisitionHealthSchema>;
export type NegativeLabAcquisitionHealthReport = z.infer<typeof negativeLabAcquisitionHealthReportSchema>;
export type NegativeLabFrameHealthEntry = z.infer<typeof negativeLabFrameHealthEntrySchema>;
export type NegativeLabFrameHealthReport = z.infer<typeof negativeLabFrameHealthReportSchema>;
export type NegativeLabBatchDryRunSummary = z.infer<typeof negativeLabBatchDryRunSummarySchema>;

export const parseNegativeLabFrameHealthReport = (value: unknown): NegativeLabFrameHealthReport =>
  negativeLabFrameHealthReportSchema.parse(value);

export const parseNegativeLabBatchDryRunSummary = (value: unknown): NegativeLabBatchDryRunSummary =>
  negativeLabBatchDryRunSummarySchema.parse(value);
