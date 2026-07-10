import type { Adjustments } from './adjustments';

export type DecodableImage = Pick<HTMLImageElement, 'decode' | 'onerror' | 'onload' | 'src'>;

export type CreateDecodableImage = () => DecodableImage;

export interface InteractivePreviewPatchPayload {
  fullHeight: number;
  fullWidth: number;
  imageBuffer: ArrayBuffer;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  pixelHeight: number;
  pixelWidth: number;
  ok: true;
}

export interface InvalidInteractivePreviewPatchPayload {
  ok: false;
  reason: string;
}

export type ParsedInteractivePreviewPatch = InteractivePreviewPatchPayload | InvalidInteractivePreviewPatchPayload;

export function isCurrentInteractivePreviewRequest({
  currentJobId,
  jobId,
  latestRequestId,
  requestId,
}: {
  currentJobId: number;
  jobId: number;
  latestRequestId: number;
  requestId: number | undefined;
}): boolean {
  return jobId === currentJobId && requestId === latestRequestId;
}

export class LatestOnlyInteractiveScheduler<T> {
  private disposed = false;
  private isRunning = false;
  private pending: T | null = null;

  constructor(private readonly run: (value: T) => Promise<void>) {}

  schedule(value: T): void {
    if (this.disposed) return;
    this.pending = value;
    this.flush();
  }

  clear(): void {
    this.pending = null;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  private flush(): void {
    if (this.disposed || this.isRunning || this.pending === null) return;

    const next = this.pending;
    this.pending = null;
    this.isRunning = true;
    void this.run(next)
      .catch(() => {
        // The caller owns render errors; continue so a newer preview can run.
      })
      .finally(() => {
        this.isRunning = false;
        this.flush();
      });
  }
}

export class InteractivePreviewUrlRegistry {
  private readonly urls = new Set<string>();

  constructor(private readonly revoke: (url: string) => void = URL.revokeObjectURL) {}

  track(url: string): void {
    this.urls.add(url);
  }

  confirmPaint(url: string): void {
    this.track(url);
    for (const candidate of this.urls) {
      if (candidate !== url) {
        this.revoke(candidate);
        this.urls.delete(candidate);
      }
    }
  }

  release(url: string): void {
    if (this.urls.delete(url)) {
      this.revoke(url);
    }
  }

  clear(): void {
    for (const url of this.urls) {
      this.revoke(url);
    }
    this.urls.clear();
  }
}

export async function decodeInteractivePreviewUrl(
  url: string,
  createImage: CreateDecodableImage = () => new Image(),
): Promise<void> {
  const image = createImage();
  if (image.decode) {
    image.src = url;
    await image.decode();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('interactive_preview_decode_failed'));
    image.src = url;
  });
}

const INTERACTIVE_PATCH_HEADER_BYTES = 24;
const JPEG_START_MARKER = 0xff;
const JPEG_START_OF_IMAGE = 0xd8;
const JPEG_START_OF_SCAN = 0xda;
const JPEG_END_OF_IMAGE = 0xd9;
const JPEG_TEMPORARY_MARKER = 0x01;
const JPEG_RESTART_MARKER_START = 0xd0;
const JPEG_RESTART_MARKER_END = 0xd7;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const readHeaderValue = (view: DataView, byteOffset: number) => view.getUint32(byteOffset, true);

interface JpegDimensions {
  height: number;
  width: number;
}

interface InteractivePatchIdentity {
  basePreviewUrl: string | null;
  geometryIdentity: string;
  sourceImagePath: string;
}

export const buildInteractivePreviewGeometryIdentity = (
  adjustments: Pick<Adjustments, 'crop' | 'flipHorizontal' | 'flipVertical' | 'orientationSteps' | 'rotation'>,
): string => {
  const { crop, rotation, flipHorizontal, flipVertical, orientationSteps } = adjustments;
  return JSON.stringify({ crop, rotation, flipHorizontal, flipVertical, orientationSteps });
};

export const isInteractivePreviewPatchCoherent = (
  patch: InteractivePatchIdentity,
  context: InteractivePatchIdentity,
): boolean =>
  patch.sourceImagePath === context.sourceImagePath &&
  patch.basePreviewUrl === context.basePreviewUrl &&
  patch.geometryIdentity === context.geometryIdentity;

const readJpegDimensions = (bytes: Uint8Array): JpegDimensions | null => {
  if (bytes[0] !== JPEG_START_MARKER || bytes[1] !== JPEG_START_OF_IMAGE) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== JPEG_START_MARKER) offset += 1;
    while (offset < bytes.length && bytes[offset] === JPEG_START_MARKER) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === JPEG_END_OF_IMAGE || marker === JPEG_START_OF_SCAN) return null;
    if (
      marker === JPEG_START_OF_IMAGE ||
      marker === JPEG_TEMPORARY_MARKER ||
      (marker >= JPEG_RESTART_MARKER_START && marker <= JPEG_RESTART_MARKER_END)
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) return null;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return width > 0 && height > 0 ? { height, width } : null;
    }

    offset += segmentLength;
  }

  return null;
};

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
  const jpegDimensions = readJpegDimensions(bytes);
  if (!jpegDimensions) {
    return { ok: false, reason: 'interactive_patch_not_jpeg' };
  }
  if (jpegDimensions.width !== patchW || jpegDimensions.height !== patchH) {
    return { ok: false, reason: 'interactive_patch_encoded_size_mismatch' };
  }

  const normX = patchX / fullW;
  const normY = patchY / fullH;
  const normW = patchW / fullW;
  const normH = patchH / fullH;
  if (![normX, normY, normW, normH].every(Number.isFinite)) {
    return { ok: false, reason: 'interactive_patch_non_finite_bounds' };
  }

  return {
    fullHeight: fullH,
    fullWidth: fullW,
    imageBuffer,
    normH,
    normW,
    normX,
    normY,
    ok: true,
    pixelHeight: jpegDimensions.height,
    pixelWidth: jpegDimensions.width,
  };
}
