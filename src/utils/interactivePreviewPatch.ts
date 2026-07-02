export interface InteractivePreviewPatchPayload {
  imageBuffer: ArrayBuffer;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  ok: true;
}

export interface InvalidInteractivePreviewPatchPayload {
  ok: false;
  reason: string;
}

export type ParsedInteractivePreviewPatch = InteractivePreviewPatchPayload | InvalidInteractivePreviewPatchPayload;

const INTERACTIVE_PATCH_HEADER_BYTES = 24;
const JPEG_START_MARKER = 0xff;
const JPEG_START_OF_IMAGE = 0xd8;

const readHeaderValue = (view: DataView, byteOffset: number) => view.getUint32(byteOffset, true);

export function parseInteractivePreviewPatchPayload(buffer: ArrayBuffer): ParsedInteractivePreviewPatch {
  if (buffer.byteLength <= INTERACTIVE_PATCH_HEADER_BYTES) {
    return { ok: false, reason: 'interactive_patch_too_short' };
  }

  const view = new DataView(buffer);
  const patchX = readHeaderValue(view, 0);
  const patchY = readHeaderValue(view, 4);
  const patchW = readHeaderValue(view, 8);
  const patchH = readHeaderValue(view, 12);
  const fullW = readHeaderValue(view, 16);
  const fullH = readHeaderValue(view, 20);

  if (fullW === 0 || fullH === 0) {
    return { ok: false, reason: 'interactive_patch_empty_full_size' };
  }
  if (patchW === 0 || patchH === 0) {
    return { ok: false, reason: 'interactive_patch_empty_roi' };
  }
  if (patchX > fullW || patchY > fullH || patchX + patchW > fullW || patchY + patchH > fullH) {
    return { ok: false, reason: 'interactive_patch_out_of_bounds' };
  }

  const imageBuffer = buffer.slice(INTERACTIVE_PATCH_HEADER_BYTES);
  const bytes = new Uint8Array(imageBuffer);
  if (bytes[0] !== JPEG_START_MARKER || bytes[1] !== JPEG_START_OF_IMAGE) {
    return { ok: false, reason: 'interactive_patch_not_jpeg' };
  }

  const normX = patchX / fullW;
  const normY = patchY / fullH;
  const normW = patchW / fullW;
  const normH = patchH / fullH;
  if (![normX, normY, normW, normH].every(Number.isFinite)) {
    return { ok: false, reason: 'interactive_patch_non_finite_bounds' };
  }

  return {
    imageBuffer,
    normH,
    normW,
    normX,
    normY,
    ok: true,
  };
}
