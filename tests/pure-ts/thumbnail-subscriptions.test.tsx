import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { thumbnailCache } from '../../src/thumbnails/thumbnailCacheInstance';
import { useThumbnail, useThumbnailSmartPreview } from '../../src/thumbnails/useThumbnail';

const window = new Window();
Object.assign(globalThis, {
  document: window.document,
  navigator: window.navigator,
  window,
  IS_REACT_ACT_ENVIRONMENT: true,
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  thumbnailCache.clearGeneration();
});

describe('thumbnail React subscriptions', () => {
  test('rerenders only the consumer whose path changes', async () => {
    const renders = new Map<string, number>();
    const Consumer = ({ path }: { path: string }) => {
      const url = useThumbnail(path);
      const smartPreview = useThumbnailSmartPreview(path);
      renders.set(path, (renders.get(path) ?? 0) + 1);
      return <span>{`${url}:${smartPreview?.stale ?? false}`}</span>;
    };
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <>
          <Consumer path="a" />
          <Consumer path="b" />
        </>,
      ),
    );
    const baselineA = renders.get('a');
    const baselineB = renders.get('b');

    await act(async () => thumbnailCache.setMany([{ generation: 1, path: 'a', url: 'a-url' }]));
    expect(renders.get('a')).toBe((baselineA ?? 0) + 1);
    expect(renders.get('b')).toBe(baselineB);

    await act(async () =>
      thumbnailCache.setMany([
        {
          generation: 1,
          path: 'a',
          smartPreview: {
            colorProfile: 'sRGB',
            height: 1,
            source: 'smartPreview',
            sourceAvailable: true,
            sourceRevision: 'r',
            stale: true,
            width: 1,
          },
        },
      ]),
    );
    expect(renders.get('a')).toBe((baselineA ?? 0) + 2);
    expect(renders.get('b')).toBe(baselineB);
  });
});
