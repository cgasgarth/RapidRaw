import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import { overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { SubMaskParameters } from '../right/layers/Masks';
import {
  createViewerParametricMaskTargetInteractionController,
  type ViewerParametricMaskTargetCommand,
  type ViewerParametricMaskTargetCurrentContext,
  type ViewerParametricMaskTargetOverlayDescriptor,
  type ViewerParametricMaskTargetSettings,
} from './viewerParametricMaskTargetInteractionController';
import { type ViewerKonvaPointerEvent, viewerPointerIdentity } from './viewerPointerEvents';
import { createViewerPointerLifecycle } from './viewerPointerLifecycle';

interface UseViewerParametricMaskTargetControllerInput {
  readonly baselineParameters: Readonly<SubMaskParameters> | null;
  readonly context: ViewerParametricMaskTargetCurrentContext;
  readonly geometry: EditorOverlayGeometry;
  readonly groupOffsetX: number;
  readonly groupOffsetY: number;
  readonly maxSafeScale: number;
  readonly onCommit: (command: ViewerParametricMaskTargetCommand) => void;
  readonly settings: Omit<ViewerParametricMaskTargetSettings, 'baselineParameters'>;
}

export interface ViewerParametricMaskTargetControllerBinding {
  readonly active: boolean;
  readonly overlay: ViewerParametricMaskTargetOverlayDescriptor | null;
  readonly transition: string;
  cancel(reason: string): void;
  handleMouseDown(event: ViewerKonvaPointerEvent): boolean;
  handleMouseUp(event: ViewerKonvaPointerEvent): boolean;
  handlePenCancel(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenDown(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenUp(event: KonvaEventObject<PointerEvent>): boolean;
  handleTouchCancel(event: KonvaEventObject<TouchEvent>): boolean;
  handleTouchEnd(event: ViewerKonvaPointerEvent): boolean;
  handleTouchStart(event: ViewerKonvaPointerEvent): boolean;
}

/** Session-owned React/Konva boundary for Color and Luminance target placement. */
export const useViewerParametricMaskTargetController = ({
  baselineParameters,
  context,
  geometry,
  groupOffsetX,
  groupOffsetY,
  maxSafeScale,
  onCommit,
  settings,
}: UseViewerParametricMaskTargetControllerInput): ViewerParametricMaskTargetControllerBinding => {
  const controller = useMemo(() => createViewerParametricMaskTargetInteractionController(), []);
  const pointerLifecycle = useMemo(() => createViewerPointerLifecycle(), []);
  const mountedRef = useRef(true);
  const currentRef = useRef({ baselineParameters, context, geometry, onCommit, settings });
  currentRef.current = { baselineParameters, context, geometry, onCommit, settings };
  const [overlay, setOverlay] = useState<ViewerParametricMaskTargetOverlayDescriptor | null>(null);
  const [transition, setTransition] = useState('idle');

  const publish = useCallback(() => {
    if (mountedRef.current) setOverlay(controller.overlays()[0] ?? null);
  }, [controller]);
  const cancel = useCallback(
    (reason: string) => {
      pointerLifecycle.cancel();
      controller.cancel();
      if (mountedRef.current) setTransition(reason);
      publish();
    },
    [controller, pointerLifecycle, publish],
  );
  const imagePoint = useCallback(
    (stage: KonvaStage | null): { readonly x: number; readonly y: number } | null => {
      const point = stage?.getPointerPosition();
      if (point === null || point === undefined) return null;
      const viewPoint = overlayPoint<'view-css-pixels'>(
        point.x / maxSafeScale - groupOffsetX,
        point.y / maxSafeScale - groupOffsetY,
      );
      const currentGeometry = currentRef.current.geometry;
      return currentGeometry.cropToOriented(currentGeometry.viewToCrop(viewPoint));
    },
    [groupOffsetX, groupOffsetY, maxSafeScale],
  );
  const begin = useCallback(
    (event: ViewerKonvaPointerEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      if ('button' in event.evt && event.evt.button !== 0) return true;
      const pointer = viewerPointerIdentity(event.evt);
      if (!pointerLifecycle.begin(pointer.pointerType, pointer.pointerId)) return true;
      const point = imagePoint(event.target.getStage());
      if (point === null || current.baselineParameters === null) {
        cancel('pointer-start-rejected');
        return true;
      }
      const descriptor = controller.begin(
        current.context,
        { imagePoint: point, ...pointer },
        { baselineParameters: current.baselineParameters, ...current.settings },
      );
      if (descriptor === null) {
        cancel('pointer-start-rejected');
        return true;
      }
      if (event.evt.cancelable) event.evt.preventDefault();
      if (mountedRef.current) setTransition('pointer-started');
      publish();
      return true;
    },
    [cancel, controller, imagePoint, pointerLifecycle, publish],
  );
  const end = useCallback(
    (event: MouseEvent | PointerEvent | TouchEvent): boolean => {
      const inferredPointer = viewerPointerIdentity(event);
      const activePointer = pointerLifecycle.snapshot().active;
      const pointer =
        'touches' in event && event.type === 'touchend' && activePointer?.pointerType === 'touch'
          ? activePointer
          : inferredPointer;
      if (!pointerLifecycle.end(pointer.pointerType, pointer.pointerId)) return false;
      const current = currentRef.current;
      const command = controller.end(current.context, pointer.pointerId, pointer.pointerType);
      if (command !== null && mountedRef.current) current.onCommit(command);
      if (mountedRef.current) setTransition(command === null ? 'session-invalidated' : 'committed');
      publish();
      if (pointer.pointerType === 'touch') queueMicrotask(() => pointerLifecycle.releaseCompatibilityMouse());
      return true;
    },
    [controller, pointerLifecycle, publish],
  );

  const handleMouseDown = begin;
  const handleMouseUp = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!currentRef.current.context.active && !controller.isActive()) return false;
      return end(event.evt);
    },
    [controller, end],
  );
  const handleTouchStart = begin;
  const handleTouchEnd = handleMouseUp;
  const handleTouchCancel = useCallback(
    (event: KonvaEventObject<TouchEvent>) => {
      const activePointer = pointerLifecycle.snapshot().active;
      if (activePointer?.pointerType !== 'touch') return false;
      const pointer = viewerPointerIdentity(event.evt);
      if (event.evt.changedTouches.length > 0 && pointer.pointerId !== activePointer.pointerId) return false;
      cancel('touchcancel');
      return true;
    },
    [cancel, pointerLifecycle],
  );
  const handlePenDown = useCallback(
    (event: KonvaEventObject<PointerEvent>) =>
      event.evt.pointerType === 'pen' && currentRef.current.context.active ? begin(event) : false,
    [begin],
  );
  const handlePenUp = useCallback(
    (event: KonvaEventObject<PointerEvent>) =>
      event.evt.pointerType === 'pen' && (currentRef.current.context.active || controller.isActive())
        ? end(event.evt)
        : false,
    [controller, end],
  );
  const handlePenCancel = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (event.evt.pointerType !== 'pen' || !controller.isActive()) return false;
      cancel('pointer-cancel');
      return true;
    },
    [cancel, controller],
  );

  useLayoutEffect(() => {
    const invalidated = controller.synchronize(context);
    if (invalidated !== null) {
      pointerLifecycle.cancel();
      if (mountedRef.current) setTransition('session-invalidated');
      publish();
    }
  }, [context, controller, pointerLifecycle, publish]);
  useEffect(() => {
    const release = (event: MouseEvent | PointerEvent | TouchEvent) => end(event);
    const cancelForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && controller.isActive()) cancel('escape');
    };
    const cancelForBlur = () => {
      if (controller.isActive()) cancel('blur');
    };
    const cancelPointer = (event: PointerEvent) => {
      const activePointer = pointerLifecycle.snapshot().active;
      if (activePointer?.pointerId === event.pointerId) cancel(event.type);
    };
    const cancelTouch = (event: TouchEvent) => {
      const activePointer = pointerLifecycle.snapshot().active;
      if (activePointer?.pointerType !== 'touch') return;
      const pointer = viewerPointerIdentity(event);
      if (event.changedTouches.length > 0 && pointer.pointerId !== activePointer.pointerId) return;
      cancel('touchcancel');
    };
    window.addEventListener('blur', cancelForBlur);
    window.addEventListener('keydown', cancelForEscape, { capture: true });
    window.addEventListener('lostpointercapture', cancelPointer, { capture: true });
    window.addEventListener('mouseup', release, { capture: true });
    window.addEventListener('pointercancel', cancelPointer, { capture: true });
    window.addEventListener('pointerup', release, { capture: true });
    window.addEventListener('touchcancel', cancelTouch, { capture: true });
    window.addEventListener('touchend', release, { capture: true });
    return () => {
      window.removeEventListener('blur', cancelForBlur);
      window.removeEventListener('keydown', cancelForEscape, { capture: true });
      window.removeEventListener('lostpointercapture', cancelPointer, { capture: true });
      window.removeEventListener('mouseup', release, { capture: true });
      window.removeEventListener('pointercancel', cancelPointer, { capture: true });
      window.removeEventListener('pointerup', release, { capture: true });
      window.removeEventListener('touchcancel', cancelTouch, { capture: true });
      window.removeEventListener('touchend', release, { capture: true });
    };
  }, [cancel, controller, end, pointerLifecycle]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pointerLifecycle.cancel();
      controller.cancel();
    };
  }, [controller, pointerLifecycle]);

  return {
    active: controller.isActive(),
    cancel,
    handleMouseDown,
    handleMouseUp,
    handlePenCancel,
    handlePenDown,
    handlePenUp,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchStart,
    overlay,
    transition,
  };
};
