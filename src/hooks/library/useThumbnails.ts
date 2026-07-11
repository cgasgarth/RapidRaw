import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';

import { Invokes } from '../../tauri/commands';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';

export const shouldQueueThumbnailPath = (
  path: string,
  cachedThumbnails: { has(path: string): boolean },
  generatedPaths: Set<string>,
  pendingPaths: ReadonlySet<string>,
): boolean => {
  if (cachedThumbnails.has(path)) {
    generatedPaths.add(path);
    return false;
  }

  if (pendingPaths.has(path)) return false;

  if (generatedPaths.has(path)) {
    generatedPaths.delete(path);
  }

  return true;
};

export function useThumbnails() {
  const generatedRef = useRef<Set<string>>(new Set());
  const pendingQueueRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const maxFlushTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const generationRef = useRef(0);

  const clearScheduledFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    if (maxFlushTimerRef.current !== null) {
      window.clearTimeout(maxFlushTimerRef.current);
      maxFlushTimerRef.current = null;
    }
  }, []);

  const flushQueueToBackend = useCallback(() => {
    clearScheduledFlush();

    const pathsToSend = Array.from(pendingQueueRef.current);
    if (pathsToSend.length === 0) return;

    const generation = generationRef.current;
    invoke(Invokes.UpdateThumbnailQueue, {
      request: {
        generation,
        replacePending: true,
        requests: pathsToSend.map((path, priority) => ({
          demandClass: 'visible',
          path,
          priority,
          sourceRevision: null,
        })),
      },
    }).catch((err: unknown) => {
      console.error('Failed to update thumbnail queue:', err);
    });

    pendingQueueRef.current.clear();
  }, [clearScheduledFlush]);

  const scheduleQueueFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
    }

    flushTimerRef.current = window.setTimeout(flushQueueToBackend, 150);

    if (maxFlushTimerRef.current === null) {
      maxFlushTimerRef.current = window.setTimeout(flushQueueToBackend, 300);
    }
  }, [flushQueueToBackend]);

  const requestThumbnails = useCallback(
    (visiblePaths: string[]) => {
      generationRef.current += 1;
      const pathsToQueue: string[] = [];
      const cachedThumbnails = thumbnailCache;

      visiblePaths.forEach((p) => {
        if (shouldQueueThumbnailPath(p, cachedThumbnails, generatedRef.current, pendingQueueRef.current)) {
          pathsToQueue.push(p);
        }
      });

      if (pathsToQueue.length > 0) {
        pathsToQueue.forEach((p) => {
          pendingQueueRef.current.add(p);
        });
        scheduleQueueFlush();
      }
    },
    [scheduleQueueFlush],
  );

  const markGenerated = useCallback((path: string, generation?: number): boolean => {
    if (generation !== undefined && generation !== generationRef.current) return false;
    generatedRef.current.add(path);
    pendingQueueRef.current.delete(path);
    return true;
  }, []);

  const clearThumbnailQueue = useCallback(() => {
    generatedRef.current.clear();
    generationRef.current += 1;
    pendingQueueRef.current.clear();
    clearScheduledFlush();
    invoke(Invokes.UpdateThumbnailQueue, {
      request: { generation: generationRef.current, replacePending: true, requests: [] },
    }).catch(console.error);
  }, [clearScheduledFlush]);

  useEffect(() => {
    return clearScheduledFlush;
  }, [clearScheduledFlush]);

  return { requestThumbnails, clearThumbnailQueue, markGenerated };
}
