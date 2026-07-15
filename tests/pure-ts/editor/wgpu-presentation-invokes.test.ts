import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ args: unknown; command: string }> = [];
const invoke = mock(async (command: string, args: unknown) => {
  calls.push({ args, command });
  if (command === 'update_wgpu_transform') return 41;
  if (command === 'flush_wgpu_presentation') return null;
  throw new Error(`Unexpected command: ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { flushWgpuPresentation, submitWgpuTransform } = await import('../../../src/tauri/wgpuPresentation');

const payload = {
  bgPrimary: [0, 0, 0, 1] as [number, number, number, number],
  bgSecondary: [0.1, 0.1, 0.1, 1] as [number, number, number, number],
  clipHeight: 480,
  clipWidth: 640,
  clipX: 0,
  clipY: 0,
  height: 480,
  pixelated: false,
  width: 640,
  windowHeight: 900,
  windowWidth: 1440,
  x: 12,
  y: 24,
};

describe('WGPU presentation invoke boundary', () => {
  beforeEach(() => {
    calls.length = 0;
    invoke.mockClear();
  });

  test('submits the exact transform payload and returns the native sequence', async () => {
    await expect(submitWgpuTransform(payload)).resolves.toBe(41);
    expect(calls).toEqual([{ args: { payload }, command: 'update_wgpu_transform' }]);
  });

  test('flushes the submitted sequence through the native ABI', async () => {
    await expect(flushWgpuPresentation(41)).resolves.toBeUndefined();
    expect(calls).toEqual([{ args: { sequence: 41 }, command: 'flush_wgpu_presentation' }]);
  });

  test('rejects an invalid sequence before invoking native code', async () => {
    await expect(flushWgpuPresentation(-1)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
