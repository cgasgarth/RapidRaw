import { expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { getEditorPreviewDimensions } from '../../../src/utils/editorPreviewDimensions.ts';

const image = (overrides: Partial<SelectedImage>): SelectedImage => ({
  exif: null,
  height: 0,
  isRaw: false,
  isReady: false,
  metadata: null,
  originalUrl: null,
  path: '/raw/_DSC7505.ARW',
  thumbnailUrl: '',
  width: 0,
  ...overrides,
});

test('uses loaded image dimensions when available', () => {
  expect(getEditorPreviewDimensions(image({ height: 4000, width: 6000 }), 0)).toEqual({ height: 4000, width: 6000 });
});

test('swaps loaded dimensions for rotated orientations', () => {
  expect(getEditorPreviewDimensions(image({ height: 4000, width: 6000 }), 1)).toEqual({ height: 6000, width: 4000 });
});

test('uses a stable thumbnail frame while RAW dimensions are pending', () => {
  expect(getEditorPreviewDimensions(image({ thumbnailUrl: 'data:image/jpeg;base64,abc' }), 0)).toEqual({
    height: 2,
    width: 3,
  });
});

test('returns null while no dimensions or thumbnail are available', () => {
  expect(getEditorPreviewDimensions(image({}), 0)).toBeNull();
});
