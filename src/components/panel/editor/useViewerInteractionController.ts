import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ViewerGestureOwner } from './viewerInputResolver';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  createViewerInteractionCoordinator,
  type ViewerInteractionContext,
  type ViewerInteractionTransition,
} from './viewerInteractionCoordinator';
import { dispatchViewerSurfaceInput, type ViewerSurfaceInputDispatchHandlers } from './viewerSurfaceInputDispatch';

interface UseViewerInteractionControllerInput {
  readonly context: ViewerInteractionContext;
  readonly handlers: ViewerSurfaceInputDispatchHandlers;
}

export interface ViewerInteractionControllerBinding {
  readonly owner: ViewerGestureOwner | null;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
  shouldCapturePointer(pointerId: number): boolean;
}

/** React binding for the session-owned viewer input authority. */
export const useViewerInteractionController = ({
  context,
  handlers,
}: UseViewerInteractionControllerInput): ViewerInteractionControllerBinding => {
  const coordinator = useMemo(() => createViewerInteractionCoordinator(), []);
  const currentRef = useRef({ context, handlers });
  currentRef.current = { context, handlers };
  const pointerCaptureRef = useRef<{ pointerId: number; shouldCapture: boolean } | null>(null);
  const [owner, setOwner] = useState<ViewerGestureOwner | null>(null);

  useEffect(() => {
    coordinator.synchronize(context);
    pointerCaptureRef.current = null;
    setOwner(coordinator.snapshot().owner);
  }, [
    context.activeTool,
    context.geometryEpoch,
    context.imageSessionId,
    context.sourceIdentity,
    context.sourceRevision,
    context.toolId,
    coordinator,
  ]);
  useEffect(
    () => () => {
      pointerCaptureRef.current = null;
      coordinator.dispose();
    },
    [coordinator],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      const current = currentRef.current;
      const { transition } = dispatchViewerSurfaceInput(coordinator, event, current.context, current.handlers);
      if (event.type === 'pointerdown') {
        pointerCaptureRef.current = { pointerId: event.pointerId, shouldCapture: transition.shouldCapturePointer };
      } else if (
        event.type === 'blur' ||
        event.type === 'escape' ||
        event.type === 'lostpointercapture' ||
        event.type === 'pointercancel' ||
        event.type === 'pointerup'
      ) {
        pointerCaptureRef.current = null;
      }
      setOwner((previous) => (previous === transition.owner ? previous : transition.owner));
    },
    [coordinator],
  );
  useEffect(() => {
    const handleWindowBlur = () => handleInputEvent({ type: 'blur' });
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [handleInputEvent]);
  const shouldCapturePointer = useCallback((pointerId: number) => {
    const capture = pointerCaptureRef.current;
    return capture?.pointerId === pointerId && capture.shouldCapture;
  }, []);

  return { handleInputEvent, owner, shouldCapturePointer };
};
