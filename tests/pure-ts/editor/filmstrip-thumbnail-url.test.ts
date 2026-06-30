import { expect, test } from 'bun:test';
import { resolveFilmstripThumbnailUrl } from '../../../src/components/panel/Filmstrip.tsx';

test('uses the active selected-image thumbnail as a filmstrip fallback', () => {
  expect(resolveFilmstripThumbnailUrl(undefined, 'data:image/jpeg;base64,abc', true)).toBe(
    'data:image/jpeg;base64,abc',
  );
});

test('keeps placeholder state for inactive images without a cached thumbnail', () => {
  expect(resolveFilmstripThumbnailUrl(undefined, 'data:image/jpeg;base64,abc', false)).toBeUndefined();
});

test('prefers the cached thumbnail when present', () => {
  expect(resolveFilmstripThumbnailUrl('data:image/jpeg;base64,cached', 'data:image/jpeg;base64,selected', true)).toBe(
    'data:image/jpeg;base64,cached',
  );
});
