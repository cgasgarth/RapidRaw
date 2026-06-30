import { expect, test } from 'bun:test';
import type { ThumbnailSmartPreviewState } from '../../src/store/useProcessStore';
import {
  hasStaleOrOfflineSmartPreview,
  isResolvingStaleSmartPreviewExport,
  isStaleOrOfflineSmartPreview,
} from '../../src/utils/exportSmartPreviewReadiness';

const smartPreviewState = (overrides: Partial<ThumbnailSmartPreviewState> = {}): ThumbnailSmartPreviewState => ({
  colorProfile: 'srgb',
  height: 900,
  source: 'original',
  sourceAvailable: true,
  sourceRevision: 'rev-1',
  stale: false,
  width: 1200,
  ...overrides,
});

test('blocks export for stale or offline smart preview thumbnail state', () => {
  expect(isStaleOrOfflineSmartPreview(smartPreviewState({ stale: true }))).toBe(true);
  expect(isStaleOrOfflineSmartPreview(smartPreviewState({ source: 'smartPreview' }))).toBe(true);
  expect(isStaleOrOfflineSmartPreview(smartPreviewState({ sourceAvailable: false }))).toBe(true);
});

test('allows export when selected paths have available original sources', () => {
  expect(
    hasStaleOrOfflineSmartPreview(['/photos/a.CR3', '/photos/b.CR3'], {
      '/photos/a.CR3': smartPreviewState(),
      '/photos/b.CR3': smartPreviewState(),
    }),
  ).toBe(false);
});

test('blocks library export when any selected path is stale or offline', () => {
  expect(
    hasStaleOrOfflineSmartPreview(['/photos/a.CR3', '/photos/b.CR3'], {
      '/photos/a.CR3': smartPreviewState(),
      '/photos/b.CR3': smartPreviewState({ source: 'smartPreview', sourceAvailable: false, stale: true }),
    }),
  ).toBe(true);
});

test('allows library export when stale smart preview path is proven reconnected', () => {
  expect(
    hasStaleOrOfflineSmartPreview(
      ['/photos/a.CR3', '/photos/b.CR3'],
      {
        '/photos/a.CR3': smartPreviewState(),
        '/photos/b.CR3': smartPreviewState({ source: 'smartPreview', sourceAvailable: false, stale: true }),
      },
      new Set(['/photos/b.CR3']),
    ),
  ).toBe(false);
});

test('reports resolving state until stale smart preview reconnection probe settles', () => {
  expect(isResolvingStaleSmartPreviewExport(['/photos/b.CR3'], '/photos/b.CR3', '')).toBe(true);
  expect(isResolvingStaleSmartPreviewExport(['/photos/b.CR3'], '/photos/b.CR3', '/photos/b.CR3')).toBe(false);
  expect(isResolvingStaleSmartPreviewExport([], '', '')).toBe(false);
});
