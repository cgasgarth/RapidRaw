import { describe, expect, test } from 'bun:test';

import type { ExecutedEditedPreview } from '../../../src/utils/editedPreviewEffectRunner';
import { PreviewMaterializationAdapter } from '../../../src/utils/previewMaterializationAdapter';

const result = (buffer: ArrayBuffer): ExecutedEditedPreview => ({
  buffer,
  newlySentPatchIds: new Set(),
  transform: null,
});

const jpegBytes = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);

const patchBuffer = () => {
  const image = jpegBytes(100, 50);
  const buffer = new ArrayBuffer(24 + image.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, 20, true);
  view.setUint32(4, 10, true);
  view.setUint32(8, 100, true);
  view.setUint32(12, 50, true);
  view.setUint32(16, 200, true);
  view.setUint32(20, 100, true);
  new Uint8Array(buffer, 24).set(image);
  return buffer;
};

describe('preview materialization adapter', () => {
  test('classifies empty and WGPU sentinel buffers without allocating URLs', async () => {
    const created: Blob[] = [];
    const adapter = new PreviewMaterializationAdapter({
      createObjectUrl: (blob) => {
        created.push(blob);
        return 'blob:unused';
      },
      releaseUrl: () => {},
    });

    expect(await adapter.materialize(result(new ArrayBuffer(0)), { kind: 'settled', roi: null })).toEqual({
      value: { kind: 'empty' },
    });
    expect(
      await adapter.materialize(result(new TextEncoder().encode('WGPU_RENDER').buffer), {
        kind: 'settled',
        roi: null,
      }),
    ).toEqual({ value: { kind: 'wgpu' } });
    expect(created).toEqual([]);
  });

  test('materializes a full frame with deterministic decode timing and artifact ownership', async () => {
    const decoded: string[] = [];
    const times = [20, 27];
    const adapter = new PreviewMaterializationAdapter({
      createObjectUrl: (blob) => {
        expect(blob.type).toBe('image/jpeg');
        return 'blob:full';
      },
      decodeUrl: async (url) => void decoded.push(url),
      now: () => times.shift() ?? 27,
      releaseUrl: () => {},
    });

    expect(await adapter.materialize(result(jpegBytes(2, 2).buffer), { kind: 'settled', roi: null })).toEqual({
      artifactUrl: 'blob:full',
      decodeMs: 7,
      value: { kind: 'full', transform: null, url: 'blob:full' },
    });
    expect(decoded).toEqual(['blob:full']);
  });

  test('valid positioned payload becomes a patch while malformed payload is bounded as limited', async () => {
    let nextUrl = 0;
    const adapter = new PreviewMaterializationAdapter({
      createObjectUrl: () => `blob:patch-${String(++nextUrl)}`,
      decodeUrl: async () => {},
      now: () => 1,
      releaseUrl: () => {},
    });

    const patch = await adapter.materialize(result(patchBuffer()), { kind: 'interactive', roi: null });
    expect(patch.artifactUrl).toBeUndefined();
    expect(patch.value).toMatchObject({
      kind: 'patch',
      patch: { fullHeight: 100, fullWidth: 200, normH: 0.5, normW: 0.5, normX: 0.1, normY: 0.1 },
      url: 'blob:patch-1',
    });
    expect(
      await adapter.materialize(result(new ArrayBuffer(24)), {
        kind: 'settled',
        roi: [0.1, 0.1, 0.5, 0.5],
      }),
    ).toEqual({ value: { kind: 'limited', reason: 'interactive_patch_too_short' } });
    expect(nextUrl).toBe(1);
  });

  test('decode failure releases the newly allocated URL exactly once before rethrowing', async () => {
    const released: string[] = [];
    const adapter = new PreviewMaterializationAdapter({
      createObjectUrl: () => 'blob:decode-failure',
      decodeUrl: async () => {
        throw new Error('decode failed');
      },
      releaseUrl: (url) => released.push(url),
    });

    await expect(adapter.materialize(result(jpegBytes(2, 2).buffer), { kind: 'settled', roi: null })).rejects.toThrow(
      'decode failed',
    );
    expect(released).toEqual(['blob:decode-failure']);
  });
});
