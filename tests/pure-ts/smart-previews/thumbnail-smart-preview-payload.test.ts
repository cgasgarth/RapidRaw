import { expect, test } from 'bun:test';

import { parseThumbnailGeneratedPayload } from '../../../src/schemas/tauriEventSchemas';

const resource = {
  byteLen: 1024,
  generation: 1,
  height: 480,
  mimeType: 'image/jpeg',
  resourceId: 'a'.repeat(64),
  revision: 'b'.repeat(64),
  source: 'generated',
  width: 720,
} as const;

test('thumbnail event accepts smart preview metadata', () => {
  const payload = parseThumbnailGeneratedPayload({
    is_edited: true,
    path: '/photos/a.raf',
    rating: 4,
    resource,
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

test('thumbnail descriptor is valid without smart preview metadata', () => {
  const payload = parseThumbnailGeneratedPayload({
    path: '/photos/a.raf',
    rating: 0,
    resource,
  });

  expect(payload.smartPreview).toBeUndefined();
});
