import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ args: unknown; command: string }> = [];
let response: unknown = null;
const invoke = mock(async (command: string, args: unknown) => {
  calls.push({ args, command });
  return response;
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { clearNativeImageCaches } = await import('../../../src/tauri/cacheManagement');

describe('native cache-management invoke boundary', () => {
  beforeEach(() => {
    calls.length = 0;
    response = null;
    invoke.mockClear();
  });

  test('uses the production cache-clear command ABI', async () => {
    await expect(clearNativeImageCaches()).resolves.toBeUndefined();
    expect(calls).toEqual([{ args: {}, command: 'clear_image_caches' }]);
  });

  test('rejects a non-empty native response', async () => {
    response = { stale: true };
    await expect(clearNativeImageCaches()).rejects.toThrow('Invalid Tauri payload for native image cache clear');
  });
});
