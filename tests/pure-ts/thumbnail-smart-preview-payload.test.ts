import { expect, test } from 'bun:test';

import { parseThumbnailGeneratedPayload } from '../../src/schemas/tauriEventSchemas';

test('thumbnail event accepts smart preview metadata', () => {
  const payload = parseThumbnailGeneratedPayload({
    data: 'data:image/jpeg;base64,abc',
    is_edited: true,
    path: '/photos/a.raf',
    rating: 4,
    smartPreview: {
      colorProfile: 'srgb',
      height: 480,
      source: 'smartPreview',
      sourceAvailable: false,
      sourceRevision: 'revision',
      stale: true,
      width: 720,
    },
  });

  expect(payload.smartPreview?.source).toBe('smartPreview');
  expect(payload.smartPreview?.stale).toBe(true);
});

test('thumbnail event remains compatible without smart preview metadata', () => {
  const payload = parseThumbnailGeneratedPayload({
    path: '/photos/a.raf',
    rating: 0,
  });

  expect(payload.smartPreview).toBeUndefined();
});
