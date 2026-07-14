import type { ViewerActiveTool, ViewerFocusContext, ViewerGestureOwner } from './viewerInputResolver';
import {
  createViewerInputRouter,
  normalizeViewerPointerType,
  type ViewerInputRouterTransition,
  type ViewerSurfaceInputEvent,
} from './viewerInputRouter';
import {
  createViewerToolSessionRegistry,
  resolveViewerToolId,
  type ViewerToolCommand,
  type ViewerToolId,
  type ViewerToolSession,
} from './viewerToolControllers';

export interface ViewerInteractionContext {
  readonly activeTool: ViewerActiveTool;
  readonly focusContext: ViewerFocusContext;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly isTemporaryHand: boolean;
  readonly pointerCount: number;
  readonly sourceRevision: string;
  readonly toolId: ViewerToolId;
  readonly zoomed: boolean;
}

export interface ViewerInteractionSnapshot {
  readonly activeSession: ViewerToolSession | null;
  readonly owner: ViewerGestureOwner | null;
}

export interface ViewerInteractionTransition extends ViewerInteractionSnapshot {
  readonly forwardToTool: boolean;
  readonly input: ViewerInputRouterTransition;
  readonly shouldCapturePointer: boolean;
  readonly toolCommand: ViewerToolCommand | null;
}

export interface ViewerInteractionCoordinator {
  dispatch(event: ViewerSurfaceInputEvent, context: ViewerInteractionContext): ViewerInteractionTransition;
  dispose(): ViewerToolCommand | null;
  snapshot(): ViewerInteractionSnapshot;
  synchronize(context: ViewerInteractionContext): ViewerToolCommand | null;
}

type SessionIdentity = Pick<
  ViewerInteractionContext,
  'activeTool' | 'geometryEpoch' | 'imageSessionId' | 'sourceRevision' | 'toolId'
>;

const sameSessionIdentity = (left: SessionIdentity, right: SessionIdentity): boolean =>
  left.activeTool === right.activeTool &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.sourceRevision === right.sourceRevision &&
  left.toolId === right.toolId;

const pointerSample = (event: Extract<ViewerSurfaceInputEvent, { pointerId: number }>) => ({
  altKey: event.altKey,
  clientX: event.clientX,
  clientY: event.clientY,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  pointerType: normalizeViewerPointerType(event.pointerType),
  pressure: event.pressure,
  shiftKey: event.shiftKey,
});

/**
 * Session-owned authority for viewer gesture arbitration and lifecycle.
 *
 * The coordinator composes the canonical input router and tool registry so the
 * presentation component cannot accidentally advance one without the other.
 */
export const createViewerInteractionCoordinator = (): ViewerInteractionCoordinator => {
  const inputRouter = createViewerInputRouter();
  const toolSessions = createViewerToolSessionRegistry();
  let identity: SessionIdentity | null = null;
  let operationGeneration = 0;

  const snapshot = (): ViewerInteractionSnapshot => ({
    activeSession: toolSessions.active(),
    owner: inputRouter.getState().owner,
  });

  const synchronize = (context: ViewerInteractionContext): ViewerToolCommand | null => {
    if (identity !== null && sameSessionIdentity(identity, context)) return null;
    identity = {
      activeTool: context.activeTool,
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      sourceRevision: context.sourceRevision,
      toolId: context.toolId,
    };
    inputRouter.dispatch({ type: 'session-invalidated' });
    return toolSessions.invalidate();
  };

  const dispatch = (event: ViewerSurfaceInputEvent, context: ViewerInteractionContext): ViewerInteractionTransition => {
    synchronize(context);

    if (!('pointerId' in event)) {
      const input = inputRouter.dispatch({ type: event.type });
      const toolCommand = toolSessions.invalidate();
      return {
        ...snapshot(),
        forwardToTool: true,
        input,
        shouldCapturePointer: false,
        toolCommand,
      };
    }

    const sample = pointerSample(event);
    const input =
      event.type === 'pointerdown'
        ? inputRouter.dispatch({
            type: 'pointerdown',
            input: {
              activeTool: context.activeTool,
              button: event.button,
              focusContext: context.focusContext,
              isDragging: false,
              isTemporaryHand: context.isTemporaryHand,
              pointerCount: context.pointerCount,
              pointerType: sample.pointerType,
              zoomed: context.zoomed,
            },
            pointerId: event.pointerId,
            sample,
          })
        : inputRouter.dispatch({ type: event.type, pointerId: event.pointerId, sample });

    let toolCommand: ViewerToolCommand | null = null;
    if (
      event.type === 'pointerdown' &&
      !input.ignored &&
      input.resolution !== null &&
      input.state.owner !== null &&
      input.state.owner !== 'blocked'
    ) {
      operationGeneration += 1;
      toolCommand = toolSessions.begin(
        {
          geometryEpoch: context.geometryEpoch,
          imageSessionId: context.imageSessionId,
          operationGeneration,
          sourceRevision: context.sourceRevision,
          toolId: context.toolId,
        },
        event.pointerId,
        input.state.owner,
        sample,
      );
    } else if (event.type === 'pointermove') {
      toolCommand = toolSessions.reduce({ kind: 'update', pointerId: event.pointerId, sample });
    } else if (event.type === 'pointerup') {
      toolCommand = toolSessions.reduce({ kind: 'end', pointerId: event.pointerId });
    } else if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      toolCommand = toolSessions.reduce({ kind: 'cancel', pointerId: event.pointerId });
    }

    return {
      ...snapshot(),
      forwardToTool: !input.ignored && input.resolution?.owner !== 'blocked',
      input,
      shouldCapturePointer:
        event.type === 'pointerdown' && !input.ignored && (input.resolution?.shouldCapturePointer ?? false),
      toolCommand,
    };
  };

  return {
    dispatch,
    dispose: () => {
      inputRouter.dispatch({ type: 'session-invalidated' });
      identity = null;
      return toolSessions.invalidate();
    },
    snapshot,
    synchronize,
  };
};

export const viewerInteractionToolId = (tool: string): ViewerToolId => resolveViewerToolId(tool);
