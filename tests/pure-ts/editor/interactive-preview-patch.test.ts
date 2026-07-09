import { expect, test } from 'bun:test';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { resolveEditorPreviewSource } from '../../../src/utils/editorImagePreviewSource.ts';
import {
  buildInteractivePreviewGeometryIdentity,
  isInteractivePreviewPatchCoherent,
  parseInteractivePreviewPatchPayload,
} from '../../../src/utils/interactivePreviewPatch.ts';

const buildJpegBytes = (width: number, height: number) =>
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

const buildPatchBuffer = ({
  fullH = 100,
  fullW = 200,
  patchH = 50,
  patchW = 100,
  patchX = 20,
  patchY = 10,
  imageBytes = buildJpegBytes(patchW, patchH),
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
    fullHeight: 100,
    fullWidth: 200,
    imageBuffer: expect.any(ArrayBuffer),
    normH: 0.5,
    normW: 0.5,
    normX: 0.1,
    normY: 0.1,
    ok: true,
    pixelHeight: 50,
    pixelWidth: 100,
  });
});

test('interactive preview patch parser rejects full-frame JPEG content labeled as an offset ROI', () => {
  expect(
    parseInteractivePreviewPatchPayload(
      buildPatchBuffer({
        imageBytes: buildJpegBytes(200, 100),
        patchH: 50,
        patchW: 100,
        patchX: 20,
        patchY: 10,
      }),
    ),
  ).toEqual({
    ok: false,
    reason: 'interactive_patch_encoded_size_mismatch',
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

test('interactive preview patch coherence rejects base preview and geometry transitions', () => {
  const geometryIdentity = buildInteractivePreviewGeometryIdentity(INITIAL_ADJUSTMENTS);
  const basePreviewUrl = resolveEditorPreviewSource({
    finalPreviewUrl: 'blob:preview-a',
    isReady: true,
    thumbnailUrl: 'blob:thumbnail-a',
  });
  const patchIdentity = {
    basePreviewUrl,
    geometryIdentity,
    sourceImagePath: '/photos/alaska.ARW',
  };

  expect(isInteractivePreviewPatchCoherent(patchIdentity, patchIdentity)).toBe(true);
  expect(
    isInteractivePreviewPatchCoherent(patchIdentity, {
      ...patchIdentity,
      basePreviewUrl: 'blob:preview-b',
    }),
  ).toBe(false);
  expect(
    isInteractivePreviewPatchCoherent(patchIdentity, {
      ...patchIdentity,
      geometryIdentity: buildInteractivePreviewGeometryIdentity({ ...INITIAL_ADJUSTMENTS, rotation: 1 }),
    }),
  ).toBe(false);
});
