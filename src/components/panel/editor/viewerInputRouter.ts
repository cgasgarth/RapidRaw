import {
  type ResolveViewerInputInput,
  resolveViewerInput,
  type ViewerGestureOwner,
  type ViewerInputResolution,
  type ViewerPointerType,
} from './viewerInputResolver';

export type ViewerInputEvent =
  | { type: 'pointerdown'; pointerId: number; input: ResolveViewerInputInput; sample?: ViewerPointerSample }
  | { type: 'pointermove'; pointerId: number; sample?: ViewerPointerSample }
  | { type: 'pointerup' | 'pointercancel' | 'lostpointercapture'; pointerId: number; sample?: ViewerPointerSample }
  | { type: 'blur' | 'escape' | 'session-invalidated' };

export interface ViewerPointerSample {
  readonly altKey?: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly pointerType: ViewerPointerType;
  readonly pressure: number;
  readonly shiftKey?: boolean;
}

export interface ViewerSurfacePointerEvent {
  readonly altKey: boolean;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly pointerId: number;
  readonly pointerType: ViewerPointerType;
  readonly pressure: number;
  readonly shiftKey: boolean;
  readonly surfaceRect?: {
    readonly height: number;
    readonly layoutHeight: number;
    readonly layoutWidth: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly type: 'lostpointercapture' | 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup';
}

export type ViewerSurfaceInputEvent = ViewerSurfacePointerEvent | { readonly type: 'blur' | 'escape' };

export const normalizeViewerSurfacePointerEvent = (event: {
  altKey?: boolean;
  button?: number;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  pointerId: number;
  pointerType?: string;
  pressure?: number;
  shiftKey?: boolean;
  surfaceRect?: ViewerSurfacePointerEvent['surfaceRect'];
  type: ViewerSurfacePointerEvent['type'];
}): ViewerSurfacePointerEvent => ({
  altKey: event.altKey ?? false,
  button: event.button ?? 0,
  clientX: event.clientX,
  clientY: event.clientY,
  ctrlKey: event.ctrlKey ?? false,
  metaKey: event.metaKey ?? false,
  pointerId: event.pointerId,
  pointerType: normalizeViewerPointerType(event.pointerType ?? 'mouse'),
  pressure: Math.min(1, Math.max(0, event.pressure ?? 0)),
  shiftKey: event.shiftKey ?? false,
  ...(event.surfaceRect === undefined ? {} : { surfaceRect: event.surfaceRect }),
  type: event.type,
});

export interface ViewerInputRouterState {
  activePointerId: number | null;
  lastPointerSample: ViewerPointerSample | null;
  owner: ViewerGestureOwner | null;
  sessionGeneration: number;
}

export interface ViewerInputRouterTransition {
  state: ViewerInputRouterState;
  resolution: ViewerInputResolution | null;
  ignored: boolean;
}

export const initialViewerInputRouterState = (): ViewerInputRouterState => ({
  activePointerId: null,
  lastPointerSample: null,
  owner: null,
  sessionGeneration: 0,
});

const clearGesture = (state: ViewerInputRouterState): ViewerInputRouterState => ({
  ...state,
  activePointerId: null,
  lastPointerSample: null,
  owner: null,
});

export const reduceViewerInputRouter = (
  state: ViewerInputRouterState,
  event: ViewerInputEvent,
): ViewerInputRouterTransition => {
  if (event.type === 'pointerdown') {
    if (state.activePointerId !== null) return { state, resolution: null, ignored: true };
    const resolution = resolveViewerInput(event.input);
    if (resolution.owner === 'blocked') return { state, resolution, ignored: false };
    return {
      state: {
        ...state,
        activePointerId: event.pointerId,
        lastPointerSample: event.sample ?? null,
        owner: resolution.owner,
      },
      resolution,
      ignored: false,
    };
  }

  if (event.type === 'pointermove') {
    const ignored = state.activePointerId !== event.pointerId;
    return {
      state: ignored || event.sample === undefined ? state : { ...state, lastPointerSample: event.sample },
      resolution: null,
      ignored,
    };
  }

  if (
    event.type === 'pointerup' ||
    event.type === 'pointercancel' ||
    event.type === 'lostpointercapture' ||
    event.type === 'blur' ||
    event.type === 'escape'
  ) {
    const isPointerRelease =
      event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture';
    const ignored = isPointerRelease && state.activePointerId !== event.pointerId;
    return { state: ignored ? state : clearGesture(state), resolution: null, ignored };
  }

  return {
    state: { ...clearGesture(state), sessionGeneration: state.sessionGeneration + 1 },
    resolution: null,
    ignored: false,
  };
};

export interface ViewerInputRouter {
  getState(): ViewerInputRouterState;
  dispatch(event: ViewerInputEvent): ViewerInputRouterTransition;
}

export const createViewerInputRouter = (initialState = initialViewerInputRouterState()): ViewerInputRouter => {
  let state = initialState;
  return {
    getState: () => state,
    dispatch: (event) => {
      const transition = reduceViewerInputRouter(state, event);
      state = transition.state;
      return transition;
    },
  };
};

export const normalizeViewerPointerType = (pointerType: string): ViewerPointerType => {
  if (pointerType === 'touch' || pointerType === 'pen') return pointerType;
  return 'mouse';
};
