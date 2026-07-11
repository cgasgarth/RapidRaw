import { beforeEach, expect, mock, test } from 'bun:test';

const invoke = mock(async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer);
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const created: string[] = [];
const revoked: string[] = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Macintosh' } });
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: mock(() => {
    const url = `blob:test-${created.length}`;
    created.push(url);
    return url;
  }),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: mock((url: string) => revoked.push(url)),
});

const { ThumbnailResourceCache } = await import('../../../src/utils/thumbnailResources');

const descriptor = (revision: string, generation: number) => ({
  byteLen: 3,
  generation,
  height: 20,
  mimeType: 'image/jpeg' as const,
  resourceId: 'a'.repeat(64),
  revision: revision.repeat(64),
  source: 'generated' as const,
  width: 40,
});

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  invoke.mockClear();
});

test('protocol URL is stable by revision and rejects an older generation', () => {
  const cache = new ThumbnailResourceCache();
  const current = cache.setProtocol('/a', descriptor('b', 2));
  expect(cache.setProtocol('/a', descriptor('b', 2))).toBe(current);
  expect(cache.setProtocol('/a', descriptor('c', 1))).toBe(current);
  expect(current).toContain('/thumbnail/');
  expect(current).toEndWith(`?v=${'b'.repeat(64)}`);
});

test('binary fallback revokes each replaced object URL exactly once', async () => {
  const cache = new ThumbnailResourceCache();
  const first = await cache.setBinaryFallback('/a', descriptor('b', 1));
  expect(await cache.setBinaryFallback('/a', descriptor('b', 1))).toBe(first);
  await cache.setBinaryFallback('/a', descriptor('c', 2));
  cache.clear();
  cache.clear();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(revoked).toEqual(['blob:test-0', 'blob:test-1']);
});
