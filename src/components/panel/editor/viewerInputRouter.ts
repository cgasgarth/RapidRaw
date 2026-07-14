import {
  type ResolveViewerInputInput,
  resolveViewerInput,
  type ViewerGestureOwner,
  type ViewerInputResolution,
  type ViewerPointerType,
} from './viewerInputResolver';

export type ViewerInputEvent =
  | { type: 'pointerdown'; pointerId: number; input: ResolveViewerInputInput }
  | { type: 'pointermove'; pointerId: number }
  | { type: 'pointerup' | 'pointercancel' | 'lostpointercapture'; pointerId: number }
  | { type: 'blur' | 'escape' | 'session-invalidated' };

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
  readonly type: 'lostpointercapture' | 'pointercancel' | 'pointerdown' | 'pointermove' | 'pointerup';
}

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
  type: event.type,
});

export interface ViewerInputRouterState {
  activePointerId: number | null;
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
  owner: null,
  sessionGeneration: 0,
});

const clearGesture = (state: ViewerInputRouterState): ViewerInputRouterState => ({
  ...state,
  activePointerId: null,
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
      state: { ...state, activePointerId: event.pointerId, owner: resolution.owner },
      resolution,
      ignored: false,
    };
  }

  if (event.type === 'pointermove') {
    return { state, resolution: null, ignored: state.activePointerId !== event.pointerId };
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
