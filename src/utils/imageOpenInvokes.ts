import { z } from 'zod';
import {
  type BeginImageOpenRequest,
  type BeginImageOpenResult,
  beginImageOpenRequestSchema,
  beginImageOpenResultSchema,
} from '../schemas/imageLoaderSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from './tauriSchemaInvoke';

const imageOpenDiagnosticsSchema = z
  .object({
    duplicatePrefetchDrops: z.number().int().nonnegative(),
    foregroundOpens: z.number().int().nonnegative(),
    metadataReads: z.number().int().nonnegative(),
    peakPrefetchInFlight: z.number().int().nonnegative(),
    prefetchCancelled: z.number().int().nonnegative(),
    prefetchCompleted: z.number().int().nonnegative(),
    prefetchPromotions: z.number().int().nonnegative(),
    prefetchRequested: z.number().int().nonnegative(),
    prefetchStarted: z.number().int().nonnegative(),
    stalePhaseDrops: z.number().int().nonnegative(),
  })
  .strict();

const scheduleImagePrefetchRequestSchema = z
  .object({
    candidates: z.array(z.string().min(1)).max(3),
    collectionGeneration: z.number().int().nonnegative(),
    memoryPressure: z.boolean(),
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
