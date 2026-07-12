import { expect, test } from 'bun:test';

import {
  parseSmartPreviewGeneratedPayload,
  parseThumbnailGeneratedPayload,
} from '../../../src/schemas/tauriEventSchemas';

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

test('smart preview completion has an independent revision-safe event', () => {
  const payload = parseSmartPreviewGeneratedPayload({
    generation: 7,
    path: '/photos/a.raf',
    resource: { ...resource, generation: 9, source: 'smartPreview' },
    smartPreview: {
      colorProfile: 'srgb',
      height: 1707,
      source: 'rendered',
      sourceAvailable: true,
      sourceRevision: 'source-revision-7',
      stale: false,
      width: 2560,
    },
    sourceRevision: 'source-revision-7',
    state: 'current',
  });

  expect(payload.resource.generation).toBe(9);
  expect(payload.smartPreview.width).toBe(2560);
});
