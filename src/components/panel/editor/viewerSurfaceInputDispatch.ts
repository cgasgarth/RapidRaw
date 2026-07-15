import type { ViewerActiveTool } from './viewerInputResolver';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import type {
  ViewerInteractionContext,
  ViewerInteractionCoordinator,
  ViewerInteractionTransition,
} from './viewerInteractionCoordinator';

export type ViewerSurfaceInputHandler = (event: ViewerSurfaceInputEvent) => void;

export interface ViewerSurfaceInputDispatchHandlers {
  readonly lifecycle: readonly ViewerSurfaceInputHandler[];
  readonly observers: readonly ViewerSurfaceInputHandler[];
  readonly tools: Readonly<Partial<Record<ViewerActiveTool, ViewerSurfaceInputHandler>>>;
}

export interface ViewerSurfaceInputDispatchResult {
  readonly routedTool: ViewerActiveTool | null;
  readonly transition: ViewerInteractionTransition;
}

const isCancellation = (event: ViewerSurfaceInputEvent): boolean =>
  event.type === 'blur' ||
  event.type === 'escape' ||
  event.type === 'lostpointercapture' ||
  event.type === 'pointercancel';

/**
 * Advances the canonical owner first, then forwards to at most one active tool.
 * Passive observers cannot own a gesture; lifecycle handlers only receive the
 * cancellation events needed to tear down Konva-backed sessions.
 */
export const dispatchViewerSurfaceInput = (
  coordinator: ViewerInteractionCoordinator,
  event: ViewerSurfaceInputEvent,
  context: ViewerInteractionContext,
  handlers: ViewerSurfaceInputDispatchHandlers,
): ViewerSurfaceInputDispatchResult => {
  const transition = coordinator.dispatch(event, context);
  for (const observer of new Set(handlers.observers)) observer(event);

  const invoked = new Set<ViewerSurfaceInputHandler>();
  if (isCancellation(event)) {
    for (const lifecycleHandler of handlers.lifecycle) {
      if (invoked.has(lifecycleHandler)) continue;
      lifecycleHandler(event);
      invoked.add(lifecycleHandler);
    }
  }

  const activeHandler = handlers.tools[context.activeTool];
  const isWhiteBalanceHover = event.type === 'pointermove' && context.activeTool === 'white-balance';
  if (activeHandler !== undefined && !invoked.has(activeHandler) && (transition.forwardToTool || isWhiteBalanceHover)) {
    activeHandler(event);
    invoked.add(activeHandler);
    return { routedTool: context.activeTool, transition };
  }

  return { routedTool: null, transition };
};
