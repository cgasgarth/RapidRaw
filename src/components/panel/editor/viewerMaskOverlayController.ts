import type { MaskOverlayInvokePayload } from '../../../utils/mask/maskOverlayRequest';

export interface ViewerMaskOverlayContext {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerMaskOverlayRequestKey extends ViewerMaskOverlayContext {
  readonly operationGeneration: number;
  readonly requestIdentity: string;
  readonly toolId: 'mask-overlay';
}

export interface ViewerMaskOverlayRequest {
  readonly key: ViewerMaskOverlayRequestKey;
  readonly payload: MaskOverlayInvokePayload;
}

export interface ViewerMaskOverlayDescriptor {
  readonly identity: string;
  readonly imageSessionId: string;
  readonly key: ViewerMaskOverlayRequestKey | null;
  readonly status: 'current' | 'none' | 'stale-ignored';
  readonly url: string | null;
}

export interface ViewerMaskOverlayGenerateCommand {
  readonly request: ViewerMaskOverlayRequest;
  readonly type: 'generate';
}

export interface ViewerMaskOverlayTransition {
  readonly command: ViewerMaskOverlayGenerateCommand | null;
  readonly descriptor: ViewerMaskOverlayDescriptor;
  readonly ignored: boolean;
}

export interface ViewerMaskOverlayController {
  dispose(): void;
  fail(key: ViewerMaskOverlayRequestKey): ViewerMaskOverlayTransition;
  request(
    context: ViewerMaskOverlayContext,
    requestIdentity: string,
    payload: MaskOverlayInvokePayload | null,
  ): ViewerMaskOverlayTransition;
  resolve(key: ViewerMaskOverlayRequestKey, url: string): ViewerMaskOverlayTransition;
  snapshot(): ViewerMaskOverlayDescriptor;
  synchronize(context: ViewerMaskOverlayContext): ViewerMaskOverlayTransition;
}

const sameContext = (left: ViewerMaskOverlayContext, right: ViewerMaskOverlayContext): boolean =>
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision;

export const isViewerMaskOverlayKeyCurrent = (
  key: ViewerMaskOverlayRequestKey,
  context: ViewerMaskOverlayContext,
): boolean => sameContext(key, context);

const sameKey = (left: ViewerMaskOverlayRequestKey, right: ViewerMaskOverlayRequestKey): boolean =>
  left.operationGeneration === right.operationGeneration &&
  left.requestIdentity === right.requestIdentity &&
  left.toolId === right.toolId &&
  sameContext(left, right);

export const viewerMaskOverlayInvalidationIdentity = (imageSessionId: string): string =>
  JSON.stringify({ imageSessionId, status: 'session-invalidated' });

export const createViewerMaskOverlayInvalidationDescriptor = (
  context: ViewerMaskOverlayContext,
): ViewerMaskOverlayDescriptor => ({
  identity: viewerMaskOverlayInvalidationIdentity(context.imageSessionId),
  imageSessionId: context.imageSessionId,
  key: null,
  status: 'none',
  url: null,
});

export const createViewerMaskOverlayController = (
  initialContext: ViewerMaskOverlayContext,
): ViewerMaskOverlayController => {
  let context = initialContext;
  let operationGeneration = 0;
  let active: ViewerMaskOverlayRequest | null = null;
  let pending: ViewerMaskOverlayRequest | null = null;
  let latestKey: ViewerMaskOverlayRequestKey | null = null;
  let disposed = false;
  let descriptor = createViewerMaskOverlayInvalidationDescriptor(initialContext);

  const transition = (
    command: ViewerMaskOverlayGenerateCommand | null,
    ignored = false,
  ): ViewerMaskOverlayTransition => ({ command, descriptor, ignored });

  const startPending = (): ViewerMaskOverlayGenerateCommand | null => {
    if (active !== null || pending === null) return null;
    active = pending;
    pending = null;
    return { request: active, type: 'generate' };
  };

  const finish = (
    key: ViewerMaskOverlayRequestKey,
    outcome: { readonly type: 'failed' } | { readonly type: 'resolved'; readonly url: string },
  ): ViewerMaskOverlayTransition => {
    if (active === null || !sameKey(active.key, key)) return transition(null, true);
    active = null;
    if (disposed) return transition(startPending(), true);
    const current = latestKey !== null && sameKey(latestKey, key) && isViewerMaskOverlayKeyCurrent(key, context);
    if (current) {
      const url = outcome.type === 'resolved' && outcome.url.length > 0 ? outcome.url : null;
      descriptor = {
        identity: key.requestIdentity,
        imageSessionId: key.imageSessionId,
        key,
        status: url === null ? 'none' : 'current',
        url,
      };
    } else if (isViewerMaskOverlayKeyCurrent(key, context)) {
      descriptor = {
        identity: key.requestIdentity,
        imageSessionId: key.imageSessionId,
        key,
        status: 'stale-ignored',
        url: null,
      };
    }
    return transition(startPending(), !current);
  };

  return {
    dispose: () => {
      disposed = true;
      latestKey = null;
    },
    fail: (key) => finish(key, { type: 'failed' }),
    request: (nextContext, requestIdentity, payload) => {
      if (disposed) return transition(null, true);
      if (!sameContext(context, nextContext)) {
        context = nextContext;
        pending = null;
        latestKey = null;
        descriptor = createViewerMaskOverlayInvalidationDescriptor(context);
      }
      operationGeneration += 1;
      const key: ViewerMaskOverlayRequestKey = {
        ...context,
        operationGeneration,
        requestIdentity,
        toolId: 'mask-overlay',
      };
      latestKey = key;
      if (payload === null) {
        pending = null;
        descriptor = {
          identity: requestIdentity,
          imageSessionId: context.imageSessionId,
          key,
          status: 'none',
          url: null,
        };
        return transition(null);
      }
      const request = { key, payload };
      if (active === null) {
        active = request;
        return transition({ request, type: 'generate' });
      }
      pending = request;
      return transition(null);
    },
    resolve: (key, url) => finish(key, { type: 'resolved', url }),
    snapshot: () => descriptor,
    synchronize: (nextContext) => {
      if (disposed || sameContext(context, nextContext)) return transition(null, disposed);
      context = nextContext;
      pending = null;
      latestKey = null;
      descriptor = createViewerMaskOverlayInvalidationDescriptor(context);
      return transition(null);
    },
  };
};
