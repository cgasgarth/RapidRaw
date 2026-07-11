import { z } from 'zod';

export type DecodableImage = Pick<HTMLImageElement, 'decode' | 'onerror' | 'onload' | 'src'>;

export type CreateDecodableImage = () => DecodableImage;

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const finitePositiveNumberSchema = z.number().finite().positive();

export const interactivePreviewScopeSchema = z.object({
  backend: z.enum(['cpu', 'wgpu']),
  basePreviewUrl: z.string().nullable(),
  devicePixelRatio: finitePositiveNumberSchema,
  adjustmentRevision: positiveSafeIntegerSchema,
  geometryIdentity: positiveSafeIntegerSchema,
  graphIdentity: z.string().min(1),
  imageSessionId: positiveSafeIntegerSchema,
  maskRevision: positiveSafeIntegerSchema,
  patchRevision: positiveSafeIntegerSchema,
  proofRevision: positiveSafeIntegerSchema,
  roiX: z.number().nullable(),
  roiY: z.number().nullable(),
  roiW: z.number().nullable(),
  roiH: z.number().nullable(),
  sourceImagePath: z.string().trim().min(1),
  targetResolution: positiveSafeIntegerSchema,
  viewportIdentity: positiveSafeIntegerSchema,
});

export type InteractivePreviewScope = z.infer<typeof interactivePreviewScopeSchema>;

export const interactivePreviewIdentitySchema = interactivePreviewScopeSchema.extend({
  backendEpoch: positiveSafeIntegerSchema,
  devicePixelRatioEpoch: positiveSafeIntegerSchema,
  generation: positiveSafeIntegerSchema,
  geometryEpoch: positiveSafeIntegerSchema,
  graphEpoch: positiveSafeIntegerSchema,
  roiEpoch: positiveSafeIntegerSchema,
  selectionEpoch: positiveSafeIntegerSchema,
  viewportEpoch: positiveSafeIntegerSchema,
});

export type InteractivePreviewIdentity = z.infer<typeof interactivePreviewIdentitySchema>;

export interface InteractivePreviewSynchronization {
  identity: InteractivePreviewIdentity;
  invalidated: boolean;
}

const scopeKeys: Array<keyof InteractivePreviewScope> = [
  'backend',
  'adjustmentRevision',
  'basePreviewUrl',
  'devicePixelRatio',
  'geometryIdentity',
  'graphIdentity',
  'imageSessionId',
  'maskRevision',
  'patchRevision',
  'proofRevision',
  'roiX',
  'roiY',
  'roiW',
  'roiH',
  'sourceImagePath',
  'targetResolution',
  'viewportIdentity',
];

const identityEpochKeys: Array<
  | 'backendEpoch'
  | 'devicePixelRatioEpoch'
  | 'generation'
  | 'geometryEpoch'
  | 'graphEpoch'
  | 'roiEpoch'
  | 'selectionEpoch'
  | 'viewportEpoch'
> = [
  'backendEpoch',
  'devicePixelRatioEpoch',
  'generation',
  'geometryEpoch',
  'graphEpoch',
  'roiEpoch',
  'selectionEpoch',
  'viewportEpoch',
];

const isSameScope = (left: InteractivePreviewScope, right: InteractivePreviewScope): boolean =>
  scopeKeys.every((key) => left[key] === right[key]);

/**
 * Owns the preview generation that is shared by dispatch, decode, and commit.
 * Parameter scrubs deliberately do not advance it: a completed active request may
 * still improve the display while the scheduler holds the newest parameter snapshot.
 */
export class InteractivePreviewGenerationController {
  private backendEpoch = 1;
  private devicePixelRatioEpoch = 1;
  private generation = 1;
  private geometryEpoch = 1;
  private graphEpoch = 1;
  private lastPaintedRequestId = 0;
  private roiEpoch = 1;
  private scope: InteractivePreviewScope | null = null;
  private selectionEpoch = 1;
  private viewportEpoch = 1;

  synchronize(input: InteractivePreviewScope): InteractivePreviewSynchronization {
    const nextScope = interactivePreviewScopeSchema.parse(input);
    const previousScope = this.scope;
    const invalidated = previousScope !== null && !isSameScope(previousScope, nextScope);

    if (previousScope !== null) {
      if (
        previousScope.imageSessionId !== nextScope.imageSessionId ||
        previousScope.sourceImagePath !== nextScope.sourceImagePath
      )
        this.selectionEpoch += 1;
      if (previousScope.graphIdentity !== nextScope.graphIdentity) this.graphEpoch += 1;
      if (previousScope.geometryIdentity !== nextScope.geometryIdentity) this.geometryEpoch += 1;
      if (
        previousScope.roiX !== nextScope.roiX ||
        previousScope.roiY !== nextScope.roiY ||
        previousScope.roiW !== nextScope.roiW ||
        previousScope.roiH !== nextScope.roiH
      )
        this.roiEpoch += 1;
      if (previousScope.viewportIdentity !== nextScope.viewportIdentity) this.viewportEpoch += 1;
      if (previousScope.devicePixelRatio !== nextScope.devicePixelRatio) this.devicePixelRatioEpoch += 1;
      if (previousScope.backend !== nextScope.backend) this.backendEpoch += 1;
      if (invalidated) {
        this.generation += 1;
        this.lastPaintedRequestId = 0;
      }
    }

    this.scope = nextScope;
    return { identity: this.createIdentity(nextScope), invalidated };
  }

  supersede(input: InteractivePreviewScope): InteractivePreviewIdentity {
    this.synchronize(input);
    this.generation += 1;
    this.lastPaintedRequestId = 0;
    return this.createIdentity(interactivePreviewScopeSchema.parse(input));
  }

  isCurrent(identity: InteractivePreviewIdentity, current: InteractivePreviewIdentity): boolean {
    const parsedIdentity = interactivePreviewIdentitySchema.parse(identity);
    const parsedCurrent = interactivePreviewIdentitySchema.parse(current);
    return (
      identityEpochKeys.every((key) => parsedIdentity[key] === parsedCurrent[key]) &&
      isSameScope(parsedIdentity, parsedCurrent)
    );
  }

  canCommit(identity: InteractivePreviewIdentity, requestId: number, current: InteractivePreviewIdentity): boolean {
    if (!this.isCurrent(identity, current) || requestId <= this.lastPaintedRequestId) return false;
    this.lastPaintedRequestId = requestId;
    return true;
  }

  private createIdentity(scope: InteractivePreviewScope): InteractivePreviewIdentity {
    return interactivePreviewIdentitySchema.parse({
      ...scope,
      backendEpoch: this.backendEpoch,
      devicePixelRatioEpoch: this.devicePixelRatioEpoch,
      generation: this.generation,
      geometryEpoch: this.geometryEpoch,
      graphEpoch: this.graphEpoch,
      roiEpoch: this.roiEpoch,
      selectionEpoch: this.selectionEpoch,
      viewportEpoch: this.viewportEpoch,
    });
  }
}

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
  private readonly ownersByUrl = new Map<string, Set<string>>();

  claim(owner: string, url: string): void {
    if (!url.startsWith('blob:')) return;
    const owners = this.ownersByUrl.get(url) ?? new Set<string>();
    owners.add(owner);
    this.ownersByUrl.set(url, owners);
  }

  release(owner: string, url: string): boolean {
    const owners = this.ownersByUrl.get(url);
    if (!owners) return false;

    owners.delete(owner);
    if (owners.size > 0) return false;

    this.ownersByUrl.delete(url);
    return true;
  }

  releaseOwner(owner: string): string[] {
    const releasedUrls: string[] = [];
    for (const [url, owners] of this.ownersByUrl) {
      owners.delete(owner);
      if (owners.size === 0) {
        this.ownersByUrl.delete(url);
        releasedUrls.push(url);
      }
    }
    return releasedUrls;
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
  geometryIdentity: number;
  sourceImagePath: string;
}

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
