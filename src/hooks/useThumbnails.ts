import { useRef, useCallback, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';

export function useThumbnails() {
  const generatedRef = useRef<Set<string>>(new Set());
  const pendingQueueRef = useRef<Set<string>>(new Set());

  const flushQueueToBackend = useMemo(
    () =>
      debounce(
        () => {
          const pathsToSend = Array.from(pendingQueueRef.current);
          if (pathsToSend.length === 0) return;

          for (let i = pathsToSend.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const currentPath = pathsToSend[i];
            const swapPath = pathsToSend[j];
            if (currentPath === undefined || swapPath === undefined) continue;
            pathsToSend[i] = swapPath;
            pathsToSend[j] = currentPath;
          }

          invoke('update_thumbnail_queue', { paths: pathsToSend }).catch((err: unknown) => {
            console.error('Failed to update thumbnail queue:', err);
          });

          pendingQueueRef.current.clear();
        },
        150,
        { maxWait: 300 },
      ),
    [],
  );

  const requestThumbnails = useCallback(
    (visiblePaths: string[]) => {
      const pathsToQueue: string[] = [];

      visiblePaths.forEach((p) => {
        if (!generatedRef.current.has(p) && !pendingQueueRef.current.has(p)) {
          pathsToQueue.push(p);
        }
      });

      if (pathsToQueue.length > 0) {
        pathsToQueue.forEach((p) => {
          pendingQueueRef.current.add(p);
        });
        flushQueueToBackend();
      }
    },
    [flushQueueToBackend],
  );

  const markGenerated = useCallback((path: string) => {
    generatedRef.current.add(path);
    pendingQueueRef.current.delete(path);
  }, []);

  const clearThumbnailQueue = useCallback(() => {
    generatedRef.current.clear();
    pendingQueueRef.current.clear();
    flushQueueToBackend.cancel();
    invoke('update_thumbnail_queue', { paths: [] }).catch(console.error);
  }, [flushQueueToBackend]);

  useEffect(() => {
    return () => {
      flushQueueToBackend.cancel();
    };
  }, [flushQueueToBackend]);

  return { requestThumbnails, clearThumbnailQueue, markGenerated };
}
