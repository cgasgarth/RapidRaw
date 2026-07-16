import { z } from 'zod';
import {
  type BeginImageOpenRequest,
  type BeginImageOpenResult,
  beginImageOpenRequestSchema,
  beginImageOpenResultSchema,
} from '../schemas/imageLoaderSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from './tauriSchemaInvoke';

const nonnegativeIntegerSchema = z.number().int().nonnegative().safe();

export const imageOpenDiagnosticsSchema = z
  .object({
    duplicatePrefetchDrops: nonnegativeIntegerSchema,
    embeddedPreviewAttempted: nonnegativeIntegerSchema,
    embeddedPreviewCacheHits: nonnegativeIntegerSchema,
    embeddedPreviewElapsedMillis: nonnegativeIntegerSchema,
    embeddedPreviewEncodedBytes: nonnegativeIntegerSchema,
    embeddedPreviewPublished: nonnegativeIntegerSchema,
    embeddedPreviewRejected: nonnegativeIntegerSchema,
    embeddedPreviewStaleSuppressed: nonnegativeIntegerSchema,
    foregroundOpens: nonnegativeIntegerSchema,
    lastEmbeddedCandidateHeight: nonnegativeIntegerSchema,
    lastEmbeddedCandidateWidth: nonnegativeIntegerSchema,
    metadataReads: nonnegativeIntegerSchema,
    peakPrefetchInFlight: nonnegativeIntegerSchema,
    prefetchCancelled: nonnegativeIntegerSchema,
    prefetchCompleted: nonnegativeIntegerSchema,
    prefetchPromotions: nonnegativeIntegerSchema,
    prefetchRequested: nonnegativeIntegerSchema,
    prefetchStarted: nonnegativeIntegerSchema,
    stalePrefetchDrops: nonnegativeIntegerSchema,
    stalePhaseDrops: nonnegativeIntegerSchema,
  })
  .strict();

export const scheduleImagePrefetchRequestSchema = z
  .object({
    candidates: z.array(z.string().min(1)).max(3),
    collectionGeneration: nonnegativeIntegerSchema,
    currentPath: z.string().min(1),
    memoryPressure: z.boolean(),
    sessionId: z
      .object({
        imageSession: nonnegativeIntegerSchema,
        selectionGeneration: nonnegativeIntegerSchema,
      })
      .strict(),
    workloadBusy: z.boolean(),
  })
  .strict();

export type ScheduleImagePrefetchRequest = z.infer<typeof scheduleImagePrefetchRequestSchema>;
export type ImageOpenDiagnostics = z.infer<typeof imageOpenDiagnosticsSchema>;

export function beginImageOpenWithSchema(request: BeginImageOpenRequest): Promise<BeginImageOpenResult> {
  return invokeWithSchema(
    Invokes.BeginImageOpen,
    { request: beginImageOpenRequestSchema.parse(request) },
    beginImageOpenResultSchema,
    Invokes.BeginImageOpen,
  );
}

export function scheduleImagePrefetchWithSchema(request: ScheduleImagePrefetchRequest): Promise<ImageOpenDiagnostics> {
  return invokeWithSchema(
    Invokes.ScheduleImagePrefetch,
    { request: scheduleImagePrefetchRequestSchema.parse(request) },
    imageOpenDiagnosticsSchema,
    Invokes.ScheduleImagePrefetch,
  );
}
