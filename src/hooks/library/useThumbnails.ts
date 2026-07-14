import { useCallback, useEffect, useRef } from 'react';
import type { ThumbnailOperationAuthority } from '../../schemas/thumbnailOperationSchemas';
import {
  ThumbnailDemandScheduler,
  type ThumbnailSchedulerMetrics,
  type ThumbnailViewportDemand,
} from '../../thumbnails/ThumbnailDemandScheduler';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';
import {
  cancelThumbnailGenerationWithSchema,
  updateThumbnailQueueWithSchema,
} from '../../utils/thumbnailOperationInvokes';

export type ThumbnailViewportUpdate = Omit<ThumbnailViewportDemand, 'generation'> & { contextKey: string };

export function useThumbnails() {
  const schedulerRef = useRef<ThumbnailDemandScheduler | null>(null);
  const authorityRef = useRef<ThumbnailOperationAuthority | null>(null);
  const viewportContextRef = useRef<string | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new ThumbnailDemandScheduler({
      dispatch: async (request) => {
        const authority = await updateThumbnailQueueWithSchema(request);
        if (schedulerRef.current?.currentGeneration === authority.generation) authorityRef.current = authority;
      },
      isResident: (path) => thumbnailCache.has(path),
    });
  }
  const requestThumbnails = useCallback((paths: string[]) => schedulerRef.current?.requestBackground(paths), []);
  const updateThumbnailViewport = useCallback((demand: ThumbnailViewportUpdate) => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    if (viewportContextRef.current !== demand.contextKey) {
      viewportContextRef.current = demand.contextKey;
      scheduler.beginGeneration('library viewport context changed');
    }
    const { contextKey: _contextKey, ...viewport } = demand;
    scheduler.updateViewport({ ...viewport, generation: scheduler.currentGeneration });
  }, []);
  const markGenerated = useCallback(
    (path: string, generation?: number): boolean => schedulerRef.current?.markResident(path, generation) ?? false,
    [],
  );
  const clearThumbnailQueue = useCallback(async () => {
    const authority = authorityRef.current;
    const scheduler = schedulerRef.current;
    if (authority && scheduler?.currentGeneration === authority.generation)
      await cancelThumbnailGenerationWithSchema(authority);
    authorityRef.current = null;
    viewportContextRef.current = null;
    scheduler?.clear();
  }, []);
  const invalidateThumbnails = useCallback((paths: readonly string[]) => schedulerRef.current?.invalidate(paths), []);
  const invalidateThumbnailRevision = useCallback(
    (path: string, sourceRevision: string) => schedulerRef.current?.invalidateRevision(path, sourceRevision),
    [],
  );
  const getThumbnailSchedulerMetrics = useCallback(
    (): ThumbnailSchedulerMetrics | null => schedulerRef.current?.getMetrics() ?? null,
    [],
  );
  useEffect(
    () => () => {
      const authority = authorityRef.current;
      if (authority) void cancelThumbnailGenerationWithSchema(authority);
      authorityRef.current = null;
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
    },
    [],
  );
  return {
    requestThumbnails,
    updateThumbnailViewport,
    clearThumbnailQueue,
    invalidateThumbnails,
    invalidateThumbnailRevision,
    markGenerated,
    getThumbnailSchedulerMetrics,
  };
}
