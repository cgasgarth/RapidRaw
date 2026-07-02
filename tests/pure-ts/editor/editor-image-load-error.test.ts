import { describe, expect, test } from 'bun:test';

import { shouldClearSelectedImageAfterLoadError } from '../../../src/utils/editorImageLoadError';

const selectedImage = (path: string, isReady: boolean) =>
  ({
    exif: null,
    height: isReady ? 6000 : 0,
    isRaw: true,
    isReady,
    metadata: null,
    originalUrl: null,
    path,
    rawDevelopmentReport: null,
    thumbnailUrl: '',
    width: isReady ? 4000 : 0,
  }) as const;

describe('editor image load error guard', () => {
  test('clears the pending image that failed before it became ready', () => {
    expect(shouldClearSelectedImageAfterLoadError(selectedImage('/raws/a.arw', false), '/raws/a.arw')).toBe(true);
  });

  test('keeps the editor open when a stale load failure returns for another image', () => {
    expect(shouldClearSelectedImageAfterLoadError(selectedImage('/raws/b.arw', false), '/raws/a.arw')).toBe(false);
  });

  test('keeps an already-open ready image visible when a late load failure returns', () => {
    expect(shouldClearSelectedImageAfterLoadError(selectedImage('/raws/a.arw', true), '/raws/a.arw')).toBe(false);
  });
});
