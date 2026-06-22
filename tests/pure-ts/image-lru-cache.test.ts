import { expect, test } from 'bun:test';

import { ImageLRUCache, type ImageCacheEntry } from '../../src/utils/ImageLRUCache.ts';

const makeEntry = (finalPreviewUrl: string | null, uncroppedPreviewUrl: string | null): ImageCacheEntry => ({
  adjustments: {},
  histogram: null,
  waveform: null,
  finalPreviewUrl,
  uncroppedPreviewUrl,
  selectedImage: { path: '/tmp/image.raw' },
  originalSize: { width: 100, height: 80 },
  previewSize: { width: 50, height: 40 },
});

const installRevokeSpy = () => {
  const calls: string[] = [];
  const originalDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url: string) => {
      calls.push(url);
    },
  });

  return {
    calls,
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(URL, 'revokeObjectURL', originalDescriptor);
      }
    },
  };
};

test('get refreshes recency and the least-recently-used entry is evicted first', () => {
  const cache = new ImageLRUCache(2);
  const { calls, restore } = installRevokeSpy();

  try {
    cache.set('a', makeEntry('blob:a-final', 'blob:a-uncropped'));
    cache.set('b', makeEntry('blob:b-final', 'blob:b-uncropped'));

    expect(cache.isProtected('blob:a-final')).toBe(true);
    expect(cache.isProtected('blob:b-final')).toBe(true);

    expect(cache.get('a')).toMatchObject({ finalPreviewUrl: 'blob:a-final' });
    expect(cache.isProtected('blob:a-final')).toBe(false);

    cache.set('c', makeEntry('blob:c-final', 'blob:c-uncropped'));

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toMatchObject({ finalPreviewUrl: 'blob:a-final' });
    expect(cache.get('c')).toMatchObject({ finalPreviewUrl: 'blob:c-final' });
    expect(calls).toEqual(['blob:b-final', 'blob:b-uncropped']);
  } finally {
    restore();
  }
});

test('delete and clear revoke blob URLs from removed entries', () => {
  const cache = new ImageLRUCache(4);
  const { calls, restore } = installRevokeSpy();

  try {
    cache.set('a', makeEntry('blob:a-final', 'blob:a-uncropped'));
    cache.set('b', makeEntry('blob:b-final', 'blob:b-uncropped'));

    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(calls).toEqual(['blob:a-final', 'blob:a-uncropped']);

    cache.clear();
    expect(cache.get('b')).toBeUndefined();
    expect(calls).toEqual(['blob:a-final', 'blob:a-uncropped', 'blob:b-final', 'blob:b-uncropped']);
  } finally {
    restore();
  }
});
