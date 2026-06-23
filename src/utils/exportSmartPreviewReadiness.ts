import type { ThumbnailSmartPreviewState } from '../store/useProcessStore';

export const isStaleOrOfflineSmartPreview = (smartPreview: ThumbnailSmartPreviewState | undefined): boolean =>
  smartPreview?.stale === true || smartPreview?.source === 'smartPreview' || smartPreview?.sourceAvailable === false;

export const hasStaleOrOfflineSmartPreview = (
  paths: ReadonlyArray<string>,
  smartPreviews: Readonly<Record<string, ThumbnailSmartPreviewState | undefined>>,
): boolean => paths.some((path) => isStaleOrOfflineSmartPreview(smartPreviews[path]));
