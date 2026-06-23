import type { ThumbnailSmartPreviewState } from '../store/useProcessStore';

export const isStaleOrOfflineSmartPreview = (smartPreview: ThumbnailSmartPreviewState | undefined): boolean =>
  smartPreview?.stale === true || smartPreview?.source === 'smartPreview' || smartPreview?.sourceAvailable === false;

export const hasStaleOrOfflineSmartPreview = (
  paths: ReadonlyArray<string>,
  smartPreviews: Readonly<Record<string, ThumbnailSmartPreviewState | undefined>>,
  reconnectedPaths: ReadonlySet<string> = new Set(),
): boolean => paths.some((path) => !reconnectedPaths.has(path) && isStaleOrOfflineSmartPreview(smartPreviews[path]));
