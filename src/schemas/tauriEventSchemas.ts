import { z } from 'zod';
import type { CullingSuggestions, Progress } from '../components/ui/AppProperties';

const nonnegativeNumberSchema = z.number().finite().nonnegative();
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
  .passthrough();

export const thumbnailGeneratedPayloadSchema = z
  .object({
    data: z.string().nullable().optional(),
    is_edited: z.boolean().optional(),
    path: z.string(),
    rating: z.number().finite().optional(),
  })
  .passthrough();

export const importStartPayloadSchema = z
  .object({
    total: nonnegativeNumberSchema,
  })
  .passthrough();

export const pathProgressPayloadSchema = progressPayloadSchema
  .extend({
    path: z.string(),
  })
  .passthrough();

export const importProgressPayloadSchema = pathProgressPayloadSchema;

export const denoiseCompletePayloadSchema = z.union([
  z.string(),
  z
    .object({
      denoised: z.string(),
      original: z.string().nullable().optional(),
    })
    .passthrough(),
]);

export const renderPathPayloadSchema = z
  .object({
    path: z.string().optional(),
  })
  .passthrough();

export const base64PayloadSchema = z
  .object({
    base64: z.string(),
  })
  .passthrough();

export const cullingProgressPayloadSchema = progressPayloadSchema
  .extend({
    stage: z.string(),
  })
  .passthrough();

const imageAnalysisResultSchema = z
  .object({
    centerFocusMetric: z.number().finite(),
    exposureMetric: z.number().finite(),
    height: nonnegativeNumberSchema,
    path: z.string(),
    qualityScore: z.number().finite(),
    sharpnessMetric: z.number().finite(),
    width: nonnegativeNumberSchema,
  })
  .passthrough();

const cullGroupSchema = z
  .object({
    duplicates: z.array(imageAnalysisResultSchema),
    representative: imageAnalysisResultSchema,
  })
  .passthrough();

export const cullingSuggestionsPayloadSchema = z
  .object({
    blurryImages: z.array(imageAnalysisResultSchema),
    failedPaths: z.array(z.string()),
    similarGroups: z.array(cullGroupSchema),
  })
  .passthrough();

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
export const parseCullingProgressPayload = (value: unknown): CullingProgressPayload => {
  const payload = cullingProgressPayloadSchema.parse(value);
  const progress = toProgress(payload);
  return { ...progress, stage: payload.stage };
};
export const parseCullingSuggestionsPayload = (value: unknown): CullingSuggestions =>
  cullingSuggestionsPayloadSchema.parse(value);
