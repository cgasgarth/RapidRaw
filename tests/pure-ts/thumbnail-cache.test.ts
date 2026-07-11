import { describe, expect, test } from 'bun:test';
import { ThumbnailCache } from '../../src/thumbnails/ThumbnailCache';

const mutation = (path: string, url: string, generation = 1) => ({ generation, path, url });

describe('ThumbnailCache', () => {
  test('updates and notifies only changed paths with stable snapshots', () => {
    const cache = new ThumbnailCache();
    let aNotifications = 0;
    let bNotifications = 0;
    cache.subscribe('a', () => aNotifications++);
    cache.subscribe('b', () => bNotifications++);

    cache.setMany([mutation('a', 'a1')]);
    const snapshot = cache.getSnapshot('a');
    cache.setMany([mutation('a', 'a1')]);

    expect(cache.getSnapshot('a')).toBe(snapshot);
    expect(aNotifications).toBe(1);
    expect(bNotifications).toBe(0);
  });

  test('deduplicates a batch and notifies once with the final entry', () => {
    const cache = new ThumbnailCache();
    let notifications = 0;
    cache.subscribe('a', () => notifications++);
    cache.setMany([mutation('a', 'old'), mutation('a', 'new')]);
    expect(cache.get('a')?.url).toBe('new');
    expect(notifications).toBe(1);
  });

  test('combines URL and smart-preview mutations for one path', () => {
    const cache = new ThumbnailCache();
    let notifications = 0;
    cache.subscribe('a', () => notifications++);
    const smartPreview = {
      colorProfile: 'sRGB',
      height: 10,
      source: 'smartPreview',
      sourceAvailable: false,
      sourceRevision: '1',
      stale: true,
      width: 20,
    };
    cache.setMany([
      { generation: 2, path: 'a', url: 'url' },
      { generation: 2, path: 'a', smartPreview },
    ]);
    expect(cache.get('a')?.smartPreview).toEqual(smartPreview);
    expect(notifications).toBe(1);
  });

  test('ignores stale generations', () => {
    const cache = new ThumbnailCache();
    cache.setMany([mutation('a', 'new', 3)]);
    const snapshot = cache.get('a');
    cache.setMany([mutation('a', 'stale', 2)]);
    expect(cache.get('a')).toBe(snapshot);
  });

  test('deletes present paths once and releases resources', () => {
    const released: string[] = [];
    const cache = new ThumbnailCache((path) => released.push(path));
    let notifications = 0;
    cache.setMany([mutation('a', 'url'), mutation('b', 'url')]);
    cache.subscribe('a', () => notifications++);
    cache.deleteMany(['a', 'missing', 'a']);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(released).toEqual(['a']);
    expect(notifications).toBe(1);
  });

  test('clear notifies every affected path once and unsubscribe cleans listeners', () => {
    const cache = new ThumbnailCache();
    let notifications = 0;
    const unsubscribe = cache.subscribe('a', () => notifications++);
    cache.subscribe('b', () => notifications++);
    cache.setMany([mutation('a', 'a'), mutation('b', 'b')]);
    notifications = 0;
    cache.clearGeneration();
    expect(notifications).toBe(2);
    unsubscribe();
    expect(cache.getSubscribedPathCount()).toBe(1);
  });

  test('tracks resident count and estimated URL bytes', () => {
    const cache = new ThumbnailCache();
    cache.setMany([mutation('a', '1234')]);
    expect(cache.getStatsSnapshot()).toMatchObject({ estimatedBytes: 8, residentCount: 1 });
  });
});
