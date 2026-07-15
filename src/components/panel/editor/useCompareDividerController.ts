import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type CompareDividerCommand,
  type CompareDividerCurrentContext,
  compareDividerPointerSampleFromSurface,
  createCompareDividerInteractionController,
  createCompareDividerOverlayDescriptor,
} from './compareDividerInteractionController';
import { isViewerSurfacePointerEvent, type ViewerSurfaceInputEvent } from './viewerInputRouter';

interface UseCompareDividerControllerInput {
  readonly context: CompareDividerCurrentContext;
  readonly onPositionChange: (position: number) => void;
  readonly onReset: () => void;
}

export interface CompareDividerControllerBinding {
  readonly descriptor: ReturnType<typeof createCompareDividerOverlayDescriptor>;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
}

/** Canonical-router binding for the keyed compare controller. */
export const useCompareDividerController = ({
  context,
  onPositionChange,
  onReset,
}: UseCompareDividerControllerInput): CompareDividerControllerBinding => {
  const controller = useMemo(() => createCompareDividerInteractionController(), []);
  const currentRef = useRef({ context, onPositionChange, onReset });
  currentRef.current = { context, onPositionChange, onReset };
  const descriptor = createCompareDividerOverlayDescriptor(context);

  const execute = useCallback((commands: readonly CompareDividerCommand[]) => {
    const current = currentRef.current;
    for (const command of commands) {
      if (command.kind === 'reset') current.onReset();
      else current.onPositionChange(command.position);
    }
  }, []);

  useEffect(() => {
    controller.dispatch(currentRef.current.context, { type: 'session-invalidated' });
  }, [controller, descriptor.sessionFingerprint]);
  useEffect(
    () => () => {
      controller.dispatch(currentRef.current.context, { type: 'session-invalidated' });
    },
    [controller],
  );

  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      const current = currentRef.current.context;
      if (event.type === 'keydown') {
        execute(controller.dispatch(current, { key: event.key, shiftKey: event.shiftKey, type: 'keydown' }));
        return;
      }
      if (event.type === 'doubleclick') {
        execute(controller.dispatch(current, { type: 'reset' }));
        return;
      }
      if (event.type === 'blur' || event.type === 'escape') {
        controller.dispatch(current, { type: event.type });
        return;
      }
      if (!isViewerSurfacePointerEvent(event)) return;
      const sample = compareDividerPointerSampleFromSurface(event, current.imageRect);
      if (sample !== null) execute(controller.dispatch(current, { ...sample, type: event.type }));
    },
    [controller, execute],
  );

  return { descriptor, handleInputEvent };
};
