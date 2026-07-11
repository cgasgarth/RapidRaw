import { useCallback, useSyncExternalStore } from 'react';
import type { ThumbnailCacheEntry, ThumbnailSmartPreviewState } from './ThumbnailCache';
import { thumbnailCache } from './thumbnailCacheInstance';

export function useThumbnailEntry(path: string): ThumbnailCacheEntry | undefined {
  const subscribe = useCallback((listener: () => void) => thumbnailCache.subscribe(path, listener), [path]);
  const getSnapshot = useCallback(() => thumbnailCache.getSnapshot(path), [path]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useThumbnail(path: string): string | null {
  return useThumbnailEntry(path)?.url ?? null;
}

export function useThumbnailSmartPreview(path: string): ThumbnailSmartPreviewState | null {
  return useThumbnailEntry(path)?.smartPreview ?? null;
}

export function useThumbnailCacheRevision(): number {
  return useSyncExternalStore(
    (listener) => thumbnailCache.subscribeStats(listener),
    () => thumbnailCache.getStatsSnapshot().revision,
    () => thumbnailCache.getStatsSnapshot().revision,
  );
}
