export interface ThumbnailSchedulerPolicy {
  maxInFlight: number;
  maxBatchSize: number;
  continuationDelayMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  metricsSampleLimit: number;
}

// Four workers can consume a small pipeline without turning a fast fling into
// hundreds of stale backend jobs. IPC batches are intentionally worker-sized.
export const DEFAULT_THUMBNAIL_SCHEDULER_POLICY: ThumbnailSchedulerPolicy = {
  maxInFlight: 24,
  maxBatchSize: 12,
  continuationDelayMs: 16,
  maxAttempts: 3,
  retryBaseMs: 100,
  metricsSampleLimit: 256,
};
