import { expect, test } from 'bun:test';

import {
  collageLoadReducer,
  createCollageSessionIdentity,
  initialCollageLoadState,
  resolveCollageLayout,
} from '../../../src/utils/collageSession';

const layouts = [
  { id: 'vertical', layout: [{ height: 1, width: 0.5, x: 0, y: 0 }] },
  { id: 'horizontal', layout: [{ height: 0.5, width: 1, x: 0, y: 0 }] },
];

test('session identity preserves opaque ordered paths and changes for every open epoch', () => {
  const paths = ['/Users/Test/Alaska/a b.ARW', 'C:\\capture\\b.NEF'];
  expect(createCollageSessionIdentity(paths, 4)).not.toBe(createCollageSessionIdentity(paths, 5));
  expect(createCollageSessionIdentity(paths, 4)).not.toBe(createCollageSessionIdentity([...paths].reverse(), 4));
  expect(createCollageSessionIdentity(['/a:bc'], 4)).not.toBe(createCollageSessionIdentity(['/ab:c'], 4));
});

test('effective layout resolves the selected id or a valid current fallback without repairing selection', () => {
  expect(resolveCollageLayout(layouts, 'horizontal')?.id).toBe('horizontal');
  expect(resolveCollageLayout(layouts, 'removed')?.id).toBe('vertical');
  expect(resolveCollageLayout([], 'horizontal')).toBeNull();
});

test('one current completion atomically commits receipts, dimensions, defaults, and image state', () => {
  const started = collageLoadReducer(initialCollageLoadState(3000), { requestId: 'session-b', type: 'loadStarted' });
  const stale = collageLoadReducer(started, {
    exportHeight: 100,
    images: [{ height: 2, path: '/old.ARW', url: 'blob:old', width: 3 }],
    originalAspectRatio: 1.5,
    requestId: 'session-a',
    type: 'loadCompleted',
  });
  expect(stale).toBe(started);

  const current = collageLoadReducer(stale, {
    exportHeight: 2000,
    images: [{ height: 2, path: '/current.ARW', url: 'blob:current', width: 3 }],
    originalAspectRatio: 1.5,
    requestId: 'session-b',
    type: 'loadCompleted',
  });
  expect(current).toMatchObject({
    error: null,
    exportHeight: 2000,
    imageStates: { '/current.ARW': { offsetX: 0, offsetY: 0, scale: 1 } },
    isLoading: false,
    originalAspectRatio: 1.5,
  });
  expect(current.loadedImages.map(({ path }) => path)).toEqual(['/current.ARW']);
});

test('user layout selection remains independent of unrelated draft and ordering actions', () => {
  const selectedId = 'horizontal';
  const started = collageLoadReducer(initialCollageLoadState(3000), { requestId: 'session', type: 'loadStarted' });
  const loaded = collageLoadReducer(started, {
    exportHeight: 3000,
    images: [
      { height: 1, path: '/a', url: 'blob:a', width: 1 },
      { height: 1, path: '/b', url: 'blob:b', width: 1 },
    ],
    originalAspectRatio: null,
    requestId: 'session',
    type: 'loadCompleted',
  });
  const reordered = collageLoadReducer(loaded, {
    images: [...loaded.loadedImages].reverse(),
    type: 'imagesReordered',
  });
  expect(resolveCollageLayout(layouts, selectedId)?.id).toBe('horizontal');
  expect(reordered.loadedImages.map(({ path }) => path)).toEqual(['/b', '/a']);
});
