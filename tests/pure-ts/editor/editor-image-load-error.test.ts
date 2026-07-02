import { describe, expect, test } from 'bun:test';

import { isSelectedImageLoadErrorCurrent } from '../../../src/utils/editorImageLoadError';

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
  test('treats a pending selected image load failure as current', () => {
    expect(isSelectedImageLoadErrorCurrent(selectedImage('/raws/a.arw', false), '/raws/a.arw')).toBe(true);
  });

  test('ignores a stale load failure for another image', () => {
    expect(isSelectedImageLoadErrorCurrent(selectedImage('/raws/b.arw', false), '/raws/a.arw')).toBe(false);
  });

  test('treats a late load failure for the ready selected image as current', () => {
    expect(isSelectedImageLoadErrorCurrent(selectedImage('/raws/a.arw', true), '/raws/a.arw')).toBe(true);
  });
});
