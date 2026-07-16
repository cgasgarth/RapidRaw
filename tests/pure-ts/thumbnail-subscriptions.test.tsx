import { afterEach, describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { thumbnailCache } from '../../src/thumbnails/thumbnailCacheInstance';
import { useThumbnail, useThumbnailSmartPreview } from '../../src/thumbnails/useThumbnail';

afterEach(() => {
  act(() => thumbnailCache.clearGeneration());
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
    render(
      <>
        <Consumer path="a" />
        <Consumer path="b" />
      </>,
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
