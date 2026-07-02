import { describe, expect, test } from 'bun:test';

import { resolveEditorPreviewSource } from '../../../src/utils/editorImagePreviewSource';

describe('resolveEditorPreviewSource', () => {
  test('uses the selected image thumbnail while the new RAW is not ready', () => {
    expect(
      resolveEditorPreviewSource({
        finalPreviewUrl: 'blob:previous-image-high-res',
        isReady: false,
        thumbnailUrl: 'blob:new-image-thumbnail',
      }),
    ).toBe('blob:new-image-thumbnail');
  });

  test('uses the high-res preview after the selected image is ready', () => {
    expect(
      resolveEditorPreviewSource({
        finalPreviewUrl: 'blob:new-image-high-res',
        isReady: true,
        thumbnailUrl: 'blob:new-image-thumbnail',
      }),
    ).toBe('blob:new-image-high-res');
  });
});
