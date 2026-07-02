import { expect, test } from 'bun:test';

import { parseInteractivePreviewPatchPayload } from '../../../src/utils/interactivePreviewPatch.ts';

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

const buildPatchBuffer = ({
  fullH = 100,
  fullW = 200,
  imageBytes = jpegBytes,
  patchH = 50,
  patchW = 100,
  patchX = 20,
  patchY = 10,
}: {
  fullH?: number;
  fullW?: number;
  imageBytes?: Uint8Array;
  patchH?: number;
  patchW?: number;
  patchX?: number;
  patchY?: number;
} = {}) => {
  const buffer = new ArrayBuffer(24 + imageBytes.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, patchX, true);
  view.setUint32(4, patchY, true);
  view.setUint32(8, patchW, true);
  view.setUint32(12, patchH, true);
  view.setUint32(16, fullW, true);
  view.setUint32(20, fullH, true);
  new Uint8Array(buffer, 24).set(imageBytes);
  return buffer;
};

test('interactive preview patch parser returns normalized bounds for valid backend payloads', () => {
  const patch = parseInteractivePreviewPatchPayload(buildPatchBuffer());

  expect(patch).toEqual({
    imageBuffer: expect.any(ArrayBuffer),
    normH: 0.5,
    normW: 0.5,
    normX: 0.1,
    normY: 0.1,
    ok: true,
  });
});

test('interactive preview patch parser rejects payloads that would black out the preview overlay', () => {
  expect(parseInteractivePreviewPatchPayload(new ArrayBuffer(24))).toEqual({
    ok: false,
    reason: 'interactive_patch_too_short',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ fullW: 0 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_empty_full_size',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ patchW: 0 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_empty_roi',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ patchW: 300 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_out_of_bounds',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ imageBytes: new Uint8Array([0, 1, 2]) }))).toEqual({
    ok: false,
    reason: 'interactive_patch_not_jpeg',
  });
});
