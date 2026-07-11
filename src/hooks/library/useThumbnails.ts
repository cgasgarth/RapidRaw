import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import { useProcessStore } from '../../store/useProcessStore';
import { Invokes } from '../../tauri/commands';
import {
  ThumbnailDemandScheduler,
  type ThumbnailSchedulerMetrics,
  type ThumbnailViewportDemand,
} from '../../thumbnails/ThumbnailDemandScheduler';

export type ThumbnailViewportUpdate = Omit<ThumbnailViewportDemand, 'generation'> & { contextKey: string };

export function useThumbnails() {
  const schedulerRef = useRef<ThumbnailDemandScheduler | null>(null);
  const viewportContextRef = useRef<string | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = new ThumbnailDemandScheduler({
      dispatch: (request) => invoke(Invokes.UpdateThumbnailQueue, { request }),
      isResident: (path) => Boolean(useProcessStore.getState().thumbnails[path]),
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
  const clearThumbnailQueue = useCallback(() => {
    viewportContextRef.current = null;
    schedulerRef.current?.clear();
  }, []);
  const invalidateThumbnails = useCallback((paths: readonly string[]) => schedulerRef.current?.invalidate(paths), []);
  const getThumbnailSchedulerMetrics = useCallback(
    (): ThumbnailSchedulerMetrics | null => schedulerRef.current?.getMetrics() ?? null,
    [],
  );
  useEffect(
    () => () => {
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
    markGenerated,
    getThumbnailSchedulerMetrics,
  };
}
