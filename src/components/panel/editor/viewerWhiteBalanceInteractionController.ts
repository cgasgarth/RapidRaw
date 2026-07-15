import { mapViewerPointToImage } from '../../../utils/viewerSampler';

export interface ViewerWhiteBalanceInteractionPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewerWhiteBalanceInteractionContext {
  readonly active: boolean;
  readonly cropSize: { readonly height: number; readonly width: number };
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly previewIdentity: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerWhiteBalanceSampleIdentity {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly intent: 'commit' | 'preview';
  readonly operationGeneration: number;
  readonly pointerId: number;
  readonly previewIdentity: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerWhiteBalanceInteractionRequest {
  readonly cropSize: { readonly height: number; readonly width: number };
  readonly identity: ViewerWhiteBalanceSampleIdentity;
  readonly imagePoint: ViewerWhiteBalanceInteractionPoint;
}

export const resolveViewerWhiteBalanceCropPoint = ({
  clientPoint,
  cropSize,
  displayedImageRect,
  surfaceRect,
}: {
  readonly clientPoint: { readonly x: number; readonly y: number };
  readonly cropSize: { readonly height: number; readonly width: number };
  readonly displayedImageRect: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly surfaceRect: {
    readonly height: number;
    readonly layoutHeight: number;
    readonly layoutWidth: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
}): ViewerWhiteBalanceInteractionPoint | null => {
  const mapped = mapViewerPointToImage({ clientPoint, displayedImageRect, surfaceRect });
  if (mapped === null) return null;
  return {
    x: mapped.normalizedImagePoint.x * cropSize.width,
    y: mapped.normalizedImagePoint.y * cropSize.height,
  };
};

const validContext = (context: ViewerWhiteBalanceInteractionContext): boolean =>
  context.active &&
  Number.isFinite(context.cropSize.width) &&
  Number.isFinite(context.cropSize.height) &&
  context.cropSize.width > 0 &&
  context.cropSize.height > 0 &&
  context.imageSessionId.length > 0 &&
  context.previewIdentity.length > 0 &&
  context.sourceIdentity.length > 0 &&
  context.sourceRevision.length > 0;

const sameContext = (
  left: ViewerWhiteBalanceInteractionContext,
  right: ViewerWhiteBalanceInteractionContext,
): boolean =>
  left.active === right.active &&
  left.cropSize.width === right.cropSize.width &&
  left.cropSize.height === right.cropSize.height &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.previewIdentity === right.previewIdentity &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision;

const isViewerWhiteBalanceSampleCurrent = (
  expected: ViewerWhiteBalanceSampleIdentity,
  actual: ViewerWhiteBalanceInteractionContext,
  pending: ViewerWhiteBalanceSampleIdentity | null,
): boolean =>
  actual.active &&
  pending !== null &&
  expected.operationGeneration === pending.operationGeneration &&
  expected.pointerId === pending.pointerId &&
  expected.intent === pending.intent &&
  expected.geometryEpoch === actual.geometryEpoch &&
  expected.imageSessionId === actual.imageSessionId &&
  expected.previewIdentity === actual.previewIdentity &&
  expected.sourceIdentity === actual.sourceIdentity &&
  expected.sourceRevision === actual.sourceRevision;

export interface ViewerWhiteBalanceInteractionController {
  accept(identity: ViewerWhiteBalanceSampleIdentity, context: ViewerWhiteBalanceInteractionContext): boolean;
  beginGesture(
    context: ViewerWhiteBalanceInteractionContext,
    point: ViewerWhiteBalanceInteractionPoint,
    pointerId: number,
  ): boolean;
  beginPreview(
    context: ViewerWhiteBalanceInteractionContext,
    point: ViewerWhiteBalanceInteractionPoint,
    pointerId: number,
  ): ViewerWhiteBalanceInteractionRequest | null;
  cancel(): void;
  cancelPreview(): boolean;
  completeGesture(
    context: ViewerWhiteBalanceInteractionContext,
    pointerId: number,
  ): ViewerWhiteBalanceInteractionRequest | null;
  handleLostPointerCapture(pointerId: number): boolean;
  pending(): ViewerWhiteBalanceSampleIdentity | null;
  snapshot(): {
    readonly gesturePointerId: number | null;
    readonly pendingIntent: ViewerWhiteBalanceSampleIdentity['intent'] | null;
    readonly pendingPointerId: number | null;
  };
  synchronize(context: ViewerWhiteBalanceInteractionContext): void;
}

export const createViewerWhiteBalanceInteractionController = (): ViewerWhiteBalanceInteractionController => {
  let currentContext: ViewerWhiteBalanceInteractionContext | null = null;
  let operationGeneration = 0;
  let pendingIdentity: ViewerWhiteBalanceSampleIdentity | null = null;
  let previewActive = false;
  let gesture: {
    readonly context: ViewerWhiteBalanceInteractionContext;
    readonly point: ViewerWhiteBalanceInteractionPoint;
    readonly pointerId: number;
  } | null = null;

  const synchronize = (context: ViewerWhiteBalanceInteractionContext): void => {
    if (currentContext !== null && sameContext(currentContext, context)) return;
    const preservesPublishedPreview =
      previewActive &&
      currentContext !== null &&
      context.active &&
      currentContext.active &&
      currentContext.cropSize.width === context.cropSize.width &&
      currentContext.cropSize.height === context.cropSize.height &&
      currentContext.geometryEpoch === context.geometryEpoch &&
      currentContext.imageSessionId === context.imageSessionId &&
      currentContext.sourceIdentity === context.sourceIdentity &&
      currentContext.sourceRevision === context.sourceRevision;
    currentContext = context;
    pendingIdentity = null;
    gesture = null;
    previewActive = preservesPublishedPreview;
  };

  const validPoint = (
    context: ViewerWhiteBalanceInteractionContext,
    point: ViewerWhiteBalanceInteractionPoint,
  ): boolean =>
    validContext(context) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= context.cropSize.width &&
    point.y <= context.cropSize.height;

  const createRequest = (
    context: ViewerWhiteBalanceInteractionContext,
    point: ViewerWhiteBalanceInteractionPoint,
    intent: ViewerWhiteBalanceSampleIdentity['intent'],
    pointerId: number,
  ): ViewerWhiteBalanceInteractionRequest => {
    operationGeneration += 1;
    pendingIdentity = {
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      intent,
      operationGeneration,
      pointerId,
      previewIdentity: context.previewIdentity,
      sourceIdentity: context.sourceIdentity,
      sourceRevision: context.sourceRevision,
    };
    return { cropSize: context.cropSize, identity: pendingIdentity, imagePoint: point };
  };

  return {
    accept: (identity, context) => {
      synchronize(context);
      const accepted = isViewerWhiteBalanceSampleCurrent(identity, context, pendingIdentity);
      if (accepted) {
        pendingIdentity = null;
        previewActive = identity.intent === 'preview';
      }
      return accepted;
    },
    beginGesture: (context, point, pointerId) => {
      synchronize(context);
      if (!validPoint(context, point) || !Number.isInteger(pointerId) || pointerId < 0 || gesture !== null) {
        return false;
      }
      pendingIdentity = null;
      gesture = { context, point, pointerId };
      return true;
    },
    beginPreview: (context, point, pointerId) => {
      synchronize(context);
      if (
        !validPoint(context, point) ||
        !Number.isInteger(pointerId) ||
        pointerId < 0 ||
        gesture !== null ||
        pendingIdentity?.intent === 'commit'
      )
        return null;
      previewActive = true;
      return createRequest(context, point, 'preview', pointerId);
    },
    cancel: () => {
      pendingIdentity = null;
      gesture = null;
      previewActive = false;
    },
    cancelPreview: () => {
      if (pendingIdentity?.intent === 'commit' || !previewActive) return false;
      if (pendingIdentity?.intent === 'preview') pendingIdentity = null;
      previewActive = false;
      return true;
    },
    completeGesture: (context, pointerId) => {
      synchronize(context);
      if (gesture === null || gesture.pointerId !== pointerId || !sameContext(gesture.context, context)) return null;
      const completed = gesture;
      gesture = null;
      return createRequest(context, completed.point, 'commit', pointerId);
    },
    handleLostPointerCapture: (pointerId) => {
      if (pendingIdentity?.intent === 'commit' && pendingIdentity.pointerId === pointerId) return false;
      if (gesture?.pointerId === pointerId) {
        gesture = null;
        pendingIdentity = null;
        previewActive = false;
        return true;
      }
      if (pendingIdentity?.pointerId !== pointerId) return false;
      pendingIdentity = null;
      previewActive = false;
      return true;
    },
    pending: () => pendingIdentity,
    snapshot: () => ({
      gesturePointerId: gesture?.pointerId ?? null,
      pendingIntent: pendingIdentity?.intent ?? null,
      pendingPointerId: pendingIdentity?.pointerId ?? null,
    }),
    synchronize,
  };
};
