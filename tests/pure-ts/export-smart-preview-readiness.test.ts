import { expect, test } from 'bun:test';

import {
  hasStaleOrOfflineSmartPreview,
  isStaleOrOfflineSmartPreview,
} from '../../src/utils/exportSmartPreviewReadiness';
import type { ThumbnailSmartPreviewState } from '../../src/store/useProcessStore';

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
