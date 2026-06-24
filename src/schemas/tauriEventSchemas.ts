import { z } from 'zod';

import { panoramaRenderedReviewSchema } from './panoramaUiSchemas';

import type { CullingSuggestions, Progress } from '../components/ui/AppProperties';

const nonnegativeNumberSchema = z.number().nonnegative();
type ProgressPayload = z.infer<typeof progressPayloadSchema>;
type CullingProgressPayload = Progress & { stage: string };

export const stringPayloadSchema = z.string();
export const countPayloadSchema = nonnegativeNumberSchema;

export const progressPayloadSchema = z
  .object({
    completed: nonnegativeNumberSchema.optional(),
    current: nonnegativeNumberSchema,
    stage: z.string().optional(),
    total: nonnegativeNumberSchema,
  })
  .loose();

export const thumbnailSmartPreviewPayloadSchema = z
  .object({
    colorProfile: z.string(),
    height: nonnegativeNumberSchema,
    source: z.string(),
    sourceAvailable: z.boolean(),
    sourceRevision: z.string(),
    stale: z.boolean(),
    width: nonnegativeNumberSchema,
  })
  .strict();

export const thumbnailGeneratedPayloadSchema = z
  .object({
    data: z.string().nullable().optional(),
    is_edited: z.boolean().optional(),
    path: z.string(),
    rating: z.number().optional(),
    smartPreview: thumbnailSmartPreviewPayloadSchema.optional().nullable(),
  })
  .loose();

export const importStartPayloadSchema = z
  .object({
    total: nonnegativeNumberSchema,
  })
  .loose();

export const pathProgressPayloadSchema = progressPayloadSchema
  .extend({
    path: z.string(),
  })
  .loose();

export const importProgressPayloadSchema = pathProgressPayloadSchema;

export const denoiseCompletePayloadSchema = z.union([
  z.string(),
  z
    .object({
      denoised: z.string(),
      original: z.string().nullable().optional(),
    })
    .loose(),
]);

export const renderPathPayloadSchema = z
  .object({
    path: z.string().optional(),
  })
  .loose();

export const base64PayloadSchema = z
  .object({
    base64: z.string(),
  })
  .loose();

export const gamutWarningOverlayPayloadSchema = z
  .object({
    coverage_ratio: z.number().min(0).max(1),
    height: z.number().int().positive(),
    mask_data_url: z.string().startsWith('data:image/png;base64,'),
    max_channel_value: z.number().int().min(0).max(255),
    min_channel_value: z.number().int().min(0).max(255),
    pixel_count: z.number().int().nonnegative(),
    warning_pixel_count: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export type GamutWarningOverlayPayload = z.infer<typeof gamutWarningOverlayPayloadSchema>;

export const panoramaCompletePayloadSchema = z
  .object({
    base64: z.string(),
    review: panoramaRenderedReviewSchema,
  })
  .strict();

export const aiConnectorStatusPayloadSchema = z
  .object({
    connected: z.boolean(),
  })
  .loose();

export const exportReceiptPayloadSchema = z
  .object({
    completedAt: z.iso.datetime({ offset: true }),
    outputs: z.array(
      z
        .object({
          bitDepth: z.number().int().positive().optional().nullable(),
          blackPointCompensation: z.string().trim().min(1).optional().nullable(),
          byteSize: z.number().int().nonnegative(),
          cmm: z.string().trim().min(1).optional().nullable(),
          colorManagedTransform: z.string().trim().min(1).optional().nullable(),
          colorProfile: z.string().trim().min(1).optional().nullable(),
          effectiveColorProfile: z.string().trim().min(1).optional().nullable(),
          format: z.string().trim().min(1),
          iccEmbedded: z.boolean().optional().nullable(),
          outputPath: z.string().trim().min(1),
          policyVersion: z.string().trim().min(1).optional().nullable(),
          renderingIntent: z.string().trim().min(1).optional().nullable(),
          requestedColorProfile: z.string().trim().min(1).optional().nullable(),
          sourcePath: z.string().trim().min(1),
          transformApplied: z.boolean().optional().nullable(),
        })
        .strict(),
    ),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const cullingProgressPayloadSchema = progressPayloadSchema
  .extend({
    stage: z.string(),
  })
  .loose();

const imageAnalysisResultSchema = z
  .object({
    centerFocusMetric: z.number(),
    detectedEyeConfidence: z.number().min(0).max(1).optional().nullable(),
    detectedFaceConfidence: z.number().min(0).max(1).optional().nullable(),
    eyeSharpnessMetric: z.number(),
    exposureMetric: z.number(),
    faceSharpnessMetric: z.number(),
    focusConfidence: z.number().min(0).max(1),
    focusRegion: z.string(),
    focusRegionProvider: z.string().optional().nullable(),
    focusScore: z.number().min(0).max(1),
    height: nonnegativeNumberSchema,
    path: z.string(),
    qualityScore: z.number(),
    sharpnessMetric: z.number(),
    width: nonnegativeNumberSchema,
  })
  .loose();

const cullGroupSchema = z
  .object({
    duplicates: z.array(imageAnalysisResultSchema),
    representative: imageAnalysisResultSchema,
  })
  .loose();

const cullingLatencyReportSchema = z
  .object({
    analysisModeCount: nonnegativeNumberSchema,
    averageAnalysisMs: nonnegativeNumberSchema,
    failedCount: nonnegativeNumberSchema,
    maxAnalysisMs: nonnegativeNumberSchema,
    sourceCount: nonnegativeNumberSchema,
    successfulCount: nonnegativeNumberSchema,
    totalElapsedMs: nonnegativeNumberSchema,
  })
  .loose();

export const cullingSuggestionsPayloadSchema = z
  .object({
    blurryImages: z.array(imageAnalysisResultSchema),
    failedPaths: z.array(z.string()),
    focusRankings: z.array(imageAnalysisResultSchema).default([]),
    latencyReport: cullingLatencyReportSchema.nullable().default(null),
    similarGroups: z.array(cullGroupSchema),
  })
  .loose();

export const parseStringPayload = (value: unknown): string => stringPayloadSchema.parse(value);
export const parseCountPayload = (value: unknown): number => countPayloadSchema.parse(value);
const toProgress = (payload: ProgressPayload): Progress => {
  const progress: Progress = {
    current: payload.current,
    total: payload.total,
  };

  if (payload.completed !== undefined) {
    progress.completed = payload.completed;
  }
  if (payload.stage !== undefined) {
    progress.stage = payload.stage;
  }

  return progress;
};

export const parseProgressPayload = (value: unknown): Progress => toProgress(progressPayloadSchema.parse(value));
export const parseThumbnailGeneratedPayload = (value: unknown) => thumbnailGeneratedPayloadSchema.parse(value);
export const parseImportStartPayload = (value: unknown) => importStartPayloadSchema.parse(value);
export const parseImportProgressPayload = (value: unknown) => importProgressPayloadSchema.parse(value);
export const parsePathProgressPayload = (value: unknown) => pathProgressPayloadSchema.parse(value);
export const parseDenoiseCompletePayload = (value: unknown) => denoiseCompletePayloadSchema.parse(value);
export const parseRenderPathPayload = (value: unknown) => renderPathPayloadSchema.parse(value);
export const parseBase64Payload = (value: unknown) => base64PayloadSchema.parse(value);
export const parseGamutWarningOverlayPayload = (value: unknown) => gamutWarningOverlayPayloadSchema.parse(value);
export const parsePanoramaCompletePayload = (value: unknown) => panoramaCompletePayloadSchema.parse(value);
export const parseAiConnectorStatusPayload = (value: unknown) => aiConnectorStatusPayloadSchema.parse(value);
export const parseExportReceiptPayload = (value: unknown) => exportReceiptPayloadSchema.parse(value);
export const parseCullingProgressPayload = (value: unknown): CullingProgressPayload => {
  const payload = cullingProgressPayloadSchema.parse(value);
  const progress = toProgress(payload);
  return { ...progress, stage: payload.stage };
};
export const parseCullingSuggestionsPayload = (value: unknown): CullingSuggestions =>
  cullingSuggestionsPayloadSchema.parse(value);
