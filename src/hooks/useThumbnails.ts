import { invoke } from '@tauri-apps/api/core';
import { useRef, useCallback, useEffect } from 'react';

import { Invokes } from '../components/ui/AppProperties';
import { useProcessStore } from '../store/useProcessStore';

const shuffleThumbnailPaths = (paths: string[]) => {
  for (let i = paths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const currentPath = paths[i];
    const swapPath = paths[j];
    if (currentPath === undefined || swapPath === undefined) continue;
    paths[i] = swapPath;
    paths[j] = currentPath;
  }
};

export const shouldQueueThumbnailPath = (
  path: string,
  cachedThumbnails: Readonly<Record<string, string>>,
  generatedPaths: Set<string>,
  pendingPaths: ReadonlySet<string>,
): boolean => {
  if (cachedThumbnails[path]) {
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

    shuffleThumbnailPaths(pathsToSend);

    invoke(Invokes.UpdateThumbnailQueue, { paths: pathsToSend }).catch((err: unknown) => {
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
      const pathsToQueue: string[] = [];
      const cachedThumbnails = useProcessStore.getState().thumbnails;

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

  const markGenerated = useCallback((path: string) => {
    generatedRef.current.add(path);
    pendingQueueRef.current.delete(path);
  }, []);

  const clearThumbnailQueue = useCallback(() => {
    generatedRef.current.clear();
    pendingQueueRef.current.clear();
    clearScheduledFlush();
    invoke(Invokes.UpdateThumbnailQueue, { paths: [] }).catch(console.error);
  }, [clearScheduledFlush]);

  useEffect(() => {
    return clearScheduledFlush;
  }, [clearScheduledFlush]);

  return { requestThumbnails, clearThumbnailQueue, markGenerated };
}
