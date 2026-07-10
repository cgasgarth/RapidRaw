import { z } from 'zod';

export const viewerSampleTargets = ['edited', 'original', 'softProof'] as const;
export const viewerSampleSpaces = ['displayEncoded', 'workingLinear'] as const;
export const viewerSampleRadii = [0, 1, 2, 4] as const;

export type ViewerSampleTarget = (typeof viewerSampleTargets)[number];
export type ViewerSampleSpace = (typeof viewerSampleSpaces)[number];
export type ViewerSampleRadius = (typeof viewerSampleRadii)[number];

export interface ViewerSampleRequest {
  requestIdentity: string;
  imageIdentity: string;
  graphRevision: string;
  geometryEpoch: number;
  normalizedImagePoint: { x: number; y: number };
  sourceImageSize: { width: number; height: number };
  target: ViewerSampleTarget;
  sampleRadiusImagePx: ViewerSampleRadius;
  requestedSpace: ViewerSampleSpace;
}

const availableViewerSampleResultSchema = z.object({
  status: z.literal('available'),
  requestIdentity: z.string().min(1),
  imagePointPx: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
  rgb: z.tuple([z.number(), z.number(), z.number()]),
  luma: z.number(),
  clippedChannels: z.array(z.enum(['r', 'g', 'b'])),
  spaceLabel: z.string().min(1),
});

const unavailableViewerSampleResultSchema = z.object({
  status: z.literal('unavailable'),
  requestIdentity: z.string().min(1),
  reason: z.enum(['frameUnavailable', 'staleFrame', 'unsupportedSpace', 'invalidPoint']),
  spaceLabel: z.string().min(1),
});

export const viewerSampleResultSchema = z.discriminatedUnion('status', [
  availableViewerSampleResultSchema,
  unavailableViewerSampleResultSchema,
]);

export type ViewerSampleResult = z.infer<typeof viewerSampleResultSchema>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const buildViewerSampleRequestIdentity = (request: Omit<ViewerSampleRequest, 'requestIdentity'>): string =>
  JSON.stringify([
    request.imageIdentity,
    request.graphRevision,
    request.geometryEpoch,
    request.target,
    request.requestedSpace,
    request.sampleRadiusImagePx,
    Number(clamp01(request.normalizedImagePoint.x).toFixed(6)),
    Number(clamp01(request.normalizedImagePoint.y).toFixed(6)),
    request.sourceImageSize.width,
    request.sourceImageSize.height,
  ]);

export const createViewerSampleRequest = (
  request: Omit<ViewerSampleRequest, 'requestIdentity'>,
): ViewerSampleRequest => ({
  ...request,
  normalizedImagePoint: {
    x: clamp01(request.normalizedImagePoint.x),
    y: clamp01(request.normalizedImagePoint.y),
  },
  requestIdentity: buildViewerSampleRequestIdentity(request),
});

export const isViewerSampleResultCurrent = (
  result: ViewerSampleResult,
  currentRequest: ViewerSampleRequest | null,
): boolean => currentRequest !== null && result.requestIdentity === currentRequest.requestIdentity;

export const resolveViewerSampleTarget = ({
  compareMode,
  normalizedViewerX,
  softProofEnabled,
}: {
  compareMode: 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';
  normalizedViewerX: number;
  softProofEnabled: boolean;
}): ViewerSampleTarget => {
  if (compareMode === 'hold-original') return 'original';
  if (compareMode === 'split-wipe' || compareMode === 'side-by-side') {
    return normalizedViewerX < 0.5 ? 'original' : softProofEnabled ? 'softProof' : 'edited';
  }
  return softProofEnabled ? 'softProof' : 'edited';
};

export const mapViewerPointToImage = ({
  clientPoint,
  displayedImageRect,
  surfaceRect,
}: {
  clientPoint: { x: number; y: number };
  displayedImageRect: { x: number; y: number; width: number; height: number };
  surfaceRect: { x: number; y: number; width: number; height: number; layoutWidth: number; layoutHeight: number };
}): { normalizedImagePoint: { x: number; y: number }; normalizedViewerX: number } | null => {
  if (surfaceRect.layoutWidth <= 0 || surfaceRect.layoutHeight <= 0) return null;
  const scaleX = surfaceRect.width / surfaceRect.layoutWidth;
  const scaleY = surfaceRect.height / surfaceRect.layoutHeight;
  const imageX = surfaceRect.x + displayedImageRect.x * scaleX;
  const imageY = surfaceRect.y + displayedImageRect.y * scaleY;
  const imageWidth = displayedImageRect.width * scaleX;
  const imageHeight = displayedImageRect.height * scaleY;
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const x = (clientPoint.x - imageX) / imageWidth;
  const y = (clientPoint.y - imageY) / imageHeight;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return {
    normalizedImagePoint: { x: clamp01(x), y: clamp01(y) },
    normalizedViewerX: clamp01((clientPoint.x - surfaceRect.x) / surfaceRect.width),
  };
};

export class LatestViewerSampleScheduler {
  private latest: ViewerSampleRequest | null = null;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly execute: (request: ViewerSampleRequest) => Promise<void>,
    private readonly minimumIntervalMs = 80,
    private readonly now: () => number = () => performance.now(),
  ) {}

  schedule(request: ViewerSampleRequest): void {
    if (this.disposed) return;
    this.latest = request;
    this.pump();
  }

  clear(): void {
    this.latest = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private pump(): void {
    if (this.disposed || this.inFlight || this.latest === null || this.timer !== null) return;
    const delay = Math.max(0, this.minimumIntervalMs - (this.now() - this.lastStartedAt));
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, delay);
      return;
    }

    const request = this.latest;
    this.latest = null;
    this.inFlight = true;
    this.lastStartedAt = this.now();
    void this.execute(request).finally(() => {
      this.inFlight = false;
      this.pump();
    });
  }
}
