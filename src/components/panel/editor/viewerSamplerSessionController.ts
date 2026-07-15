import {
  isViewerSampleResultCurrent,
  type ViewerSampleRequest,
  type ViewerSampleResult,
  type ViewerSampleTarget,
} from '../../../utils/viewerSampler';

export interface ViewerSamplerSessionContext {
  readonly geometryEpoch: number;
  readonly graphRevision: string;
  readonly imageSessionId: string;
  readonly samplerIdentity: string;
  readonly sourceIdentity: string;
  readonly suppressed: boolean;
}

export interface ViewerSamplerOperationKey {
  readonly geometryEpoch: number;
  readonly graphRevision: string;
  readonly imageSessionId: string;
  readonly operationGeneration: number;
  readonly requestIdentity: string;
  readonly samplerIdentity: string;
  readonly sourceIdentity: string;
}

export interface ViewerSamplerOperation {
  readonly key: ViewerSamplerOperationKey;
  readonly request: ViewerSampleRequest;
  readonly target: ViewerSampleTarget;
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerSamplerOverlayDescriptor {
  readonly geometryEpoch: number;
  readonly normalizedImagePoint: ViewerSampleRequest['normalizedImagePoint'];
  readonly operationGeneration: number;
  readonly requestIdentity: string;
  readonly status: 'available' | 'sampling' | 'unavailable';
  readonly target: ViewerSampleTarget;
  readonly viewPoint: { readonly x: number; readonly y: number };
}

export interface ViewerSamplerControllerState {
  readonly locked: boolean;
  readonly overlay: ViewerSamplerOverlayDescriptor | null;
  readonly result: ViewerSampleResult | null;
  readonly target: ViewerSampleTarget;
}

const sameOperationKey = (left: ViewerSamplerOperationKey, right: ViewerSamplerOperationKey): boolean =>
  left.geometryEpoch === right.geometryEpoch &&
  left.graphRevision === right.graphRevision &&
  left.imageSessionId === right.imageSessionId &&
  left.operationGeneration === right.operationGeneration &&
  left.requestIdentity === right.requestIdentity &&
  left.samplerIdentity === right.samplerIdentity &&
  left.sourceIdentity === right.sourceIdentity;

const operationIsCurrent = (operation: ViewerSamplerOperation, context: ViewerSamplerSessionContext): boolean =>
  !context.suppressed &&
  operation.key.geometryEpoch === context.geometryEpoch &&
  operation.key.graphRevision === context.graphRevision &&
  operation.key.imageSessionId === context.imageSessionId &&
  operation.key.samplerIdentity === context.samplerIdentity &&
  operation.key.sourceIdentity === context.sourceIdentity;

export interface ViewerSamplerSessionController {
  begin(
    request: ViewerSampleRequest,
    target: ViewerSampleTarget,
    viewPoint: ViewerSamplerOperation['viewPoint'],
    context: ViewerSamplerSessionContext,
  ): ViewerSamplerOperation | null;
  cancel(preserveLock: boolean): boolean;
  dispose(): void;
  fail(operation: ViewerSamplerOperation, context: ViewerSamplerSessionContext): boolean;
  receive(operation: ViewerSamplerOperation, result: ViewerSampleResult, context: ViewerSamplerSessionContext): boolean;
  snapshot(): ViewerSamplerControllerState;
  synchronize(context: ViewerSamplerSessionContext): boolean;
  toggleLock(): boolean;
}

export const createViewerSamplerSessionController = (
  initialTarget: ViewerSampleTarget,
): ViewerSamplerSessionController => {
  let contextIdentity: string | null = null;
  let disposed = false;
  let operationGeneration = 0;
  let currentOperation: ViewerSamplerOperation | null = null;
  let state: ViewerSamplerControllerState = { locked: false, overlay: null, result: null, target: initialTarget };
  const clear = (preserveLock: boolean): boolean => {
    currentOperation = null;
    if (preserveLock && state.locked) return false;
    if (state.result === null && state.overlay === null) return false;
    state = { ...state, overlay: null, result: null };
    return true;
  };
  return {
    begin: (request, target, viewPoint, context) => {
      if (disposed || state.locked || context.suppressed) return null;
      operationGeneration += 1;
      const operation: ViewerSamplerOperation = {
        key: {
          geometryEpoch: context.geometryEpoch,
          graphRevision: context.graphRevision,
          imageSessionId: context.imageSessionId,
          operationGeneration,
          requestIdentity: request.requestIdentity,
          samplerIdentity: context.samplerIdentity,
          sourceIdentity: context.sourceIdentity,
        },
        request,
        target,
        viewPoint,
      };
      currentOperation = operation;
      state = {
        ...state,
        overlay: {
          geometryEpoch: context.geometryEpoch,
          normalizedImagePoint: request.normalizedImagePoint,
          operationGeneration,
          requestIdentity: request.requestIdentity,
          status: 'sampling',
          target,
          viewPoint,
        },
        target,
      };
      return operation;
    },
    cancel: (preserveLock) => (disposed ? false : clear(preserveLock)),
    dispose: () => {
      disposed = true;
      currentOperation = null;
    },
    fail: (operation, context) => {
      if (
        disposed ||
        currentOperation === null ||
        !sameOperationKey(currentOperation.key, operation.key) ||
        !operationIsCurrent(operation, context)
      ) {
        return false;
      }
      currentOperation = null;
      state = {
        ...state,
        overlay: state.overlay === null ? null : { ...state.overlay, status: 'unavailable' },
        result: {
          reason: 'frameUnavailable',
          requestIdentity: operation.request.requestIdentity,
          spaceLabel: 'Unavailable',
          status: 'unavailable',
        },
      };
      return true;
    },
    receive: (operation, result, context) => {
      if (
        disposed ||
        currentOperation === null ||
        !sameOperationKey(currentOperation.key, operation.key) ||
        !operationIsCurrent(operation, context) ||
        !isViewerSampleResultCurrent(result, operation.request)
      ) {
        return false;
      }
      currentOperation = null;
      state = {
        ...state,
        overlay: state.overlay === null ? null : { ...state.overlay, status: result.status },
        result,
      };
      return true;
    },
    snapshot: () => state,
    synchronize: (context) => {
      const nextIdentity = JSON.stringify([
        context.imageSessionId,
        context.sourceIdentity,
        context.graphRevision,
        context.geometryEpoch,
        context.samplerIdentity,
        context.suppressed,
      ]);
      if (contextIdentity === nextIdentity) return false;
      contextIdentity = nextIdentity;
      currentOperation = null;
      if (state.result === null && state.overlay === null) return false;
      state = { ...state, overlay: null, result: null };
      return true;
    },
    toggleLock: () => {
      if (disposed) return false;
      state = { ...state, locked: !state.locked };
      return true;
    },
  };
};
