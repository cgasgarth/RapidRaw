import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import { overlayPoint } from '../../../utils/editorOverlayGeometry';
import {
  createViewerAiMaskBoxInteractionController,
  type ViewerAiMaskBoxCommand,
  type ViewerAiMaskBoxCurrentContext,
  type ViewerAiMaskBoxOverlayDescriptor,
  type ViewerAiMaskBoxPointerType,
  type ViewerAiMaskBoxSample,
} from './viewerAiMaskBoxInteractionController';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  isViewerKonvaPointerEvent,
  type ViewerKonvaPointerEvent,
  type ViewerPointerEndEvent,
  type ViewerPointerMoveEvent,
} from './viewerPointerEvents';
import { createViewerPointerLifecycle } from './viewerPointerLifecycle';

interface UseViewerAiMaskBoxControllerInput {
  readonly baselineParameters: Readonly<Record<string, unknown>> | null;
  readonly context: ViewerAiMaskBoxCurrentContext;
  readonly geometry: EditorOverlayGeometry;
  readonly groupOffsetX: number;
  readonly groupOffsetY: number;
  readonly maxSafeScale: number;
  readonly onCommit: (command: ViewerAiMaskBoxCommand) => void;
}

export interface ViewerAiMaskBoxControllerBinding {
  readonly active: boolean;
  readonly overlay: ViewerAiMaskBoxOverlayDescriptor | null;
  readonly transition: string;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
  handleMouseDown(event: ViewerKonvaPointerEvent): boolean;
  handleMouseMove(event: ViewerKonvaPointerEvent): boolean;
  handleMouseUp(event: ViewerKonvaPointerEvent): boolean;
  handlePenCancel(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenDown(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenMove(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenUp(event: KonvaEventObject<PointerEvent>): boolean;
  handleTouchEnd(event: ViewerKonvaPointerEvent): boolean;
  handleTouchMove(event: ViewerKonvaPointerEvent): boolean;
  handleTouchStart(event: ViewerKonvaPointerEvent): boolean;
}

const pointerMetadata = (event: MouseEvent | PointerEvent | TouchEvent) => {
  const pointerType: ViewerAiMaskBoxPointerType =
    'pointerType' in event && (event.pointerType === 'pen' || event.pointerType === 'touch')
      ? event.pointerType
      : 'touches' in event
        ? 'touch'
        : 'mouse';
  const touch = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : undefined;
  return { pointerId: 'pointerId' in event ? event.pointerId : touch ? touch.identifier + 1 : 1, pointerType };
};

/** Session-owned React/Konva boundary for AI Subject and Quick Eraser box gestures. */
export const useViewerAiMaskBoxController = ({
  baselineParameters,
  context,
  geometry,
  groupOffsetX,
  groupOffsetY,
  maxSafeScale,
  onCommit,
}: UseViewerAiMaskBoxControllerInput): ViewerAiMaskBoxControllerBinding => {
  const controller = useMemo(() => createViewerAiMaskBoxInteractionController(), []);
  const pointerLifecycle = useMemo(() => createViewerPointerLifecycle(), []);
  const stageRef = useRef<KonvaStage | null>(null);
  const mountedRef = useRef(true);
  const currentRef = useRef({ baselineParameters, context, geometry, onCommit });
  currentRef.current = { baselineParameters, context, geometry, onCommit };
  const [overlay, setOverlay] = useState<ViewerAiMaskBoxOverlayDescriptor | null>(null);
  const [transition, setTransition] = useState('idle');

  const toViewPoint = useCallback(
    (stage: KonvaStage | null): { readonly x: number; readonly y: number } | null => {
      const point = stage?.getPointerPosition();
      if (point === null || point === undefined) return null;
      return { x: point.x / maxSafeScale - groupOffsetX, y: point.y / maxSafeScale - groupOffsetY };
    },
    [groupOffsetX, groupOffsetY, maxSafeScale],
  );
  const toSample = useCallback(
    (
      viewPoint: { readonly x: number; readonly y: number },
      event: MouseEvent | PointerEvent | TouchEvent,
    ): ViewerAiMaskBoxSample => {
      const currentGeometry = currentRef.current.geometry;
      const imagePoint = currentGeometry.cropToOriented(
        currentGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(viewPoint.x, viewPoint.y)),
      );
      return { ...pointerMetadata(event), imagePoint, viewPoint };
    },
    [],
  );
  const publish = useCallback(() => {
    if (mountedRef.current) setOverlay(controller.overlays()[0] ?? null);
  }, [controller]);
  const cancel = useCallback(
    (reason: string) => {
      pointerLifecycle.cancel();
      controller.cancel();
      stageRef.current = null;
      if (mountedRef.current) setTransition(reason);
      publish();
    },
    [controller, pointerLifecycle, publish],
  );
  const begin = useCallback(
    (event: ViewerKonvaPointerEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      if ('button' in event.evt && event.evt.button !== 0) return true;
      if (current.baselineParameters === null) return true;
      const stage = event.target.getStage();
      const point = toViewPoint(stage);
      if (point === null) {
        cancel('pointer-start-missing');
        return true;
      }
      stageRef.current = stage;
      const began = controller.begin(current.context, toSample(point, event.evt), current.baselineParameters);
      setTransition(began ? 'pointer-started' : 'pointer-start-rejected');
      publish();
      if (event.evt.cancelable) event.evt.preventDefault();
      return true;
    },
    [cancel, controller, publish, toSample, toViewPoint],
  );
  const move = useCallback(
    (event: ViewerPointerMoveEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      const stage = isViewerKonvaPointerEvent(event) ? event.target.getStage() : stageRef.current;
      if (!isViewerKonvaPointerEvent(event) && stage !== null) stage.setPointersPositions(event);
      const point = toViewPoint(stage);
      if (point === null) return true;
      const sourceEvent = isViewerKonvaPointerEvent(event) ? event.evt : event;
      if (controller.move(current.context, toSample(point, sourceEvent)) || !controller.isActive()) publish();
      if (sourceEvent.cancelable) sourceEvent.preventDefault();
      return true;
    },
    [controller, publish, toSample, toViewPoint],
  );
  const end = useCallback(
    (event?: ViewerPointerEndEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      const sourceEvent = event && isViewerKonvaPointerEvent(event) ? event.evt : event;
      if (sourceEvent === undefined) return true;
      const metadata = pointerMetadata(sourceEvent);
      const stage = event && isViewerKonvaPointerEvent(event) ? event.target.getStage() : null;
      const point = toViewPoint(stage);
      const commands = controller.end(
        current.context,
        metadata.pointerId,
        metadata.pointerType,
        point === null ? undefined : toSample(point, sourceEvent),
      );
      for (const command of commands) if (mountedRef.current) current.onCommit(command);
      stageRef.current = null;
      setTransition(
        commands.length > 0
          ? 'pointer-ended'
          : controller.isActive()
            ? 'unrelated-pointer-ended'
            : 'session-invalidated',
      );
      publish();
      return true;
    },
    [controller, publish, toSample, toViewPoint],
  );

  const handleMouseDown = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.begin(metadata.pointerType, metadata.pointerId) ? begin(event) : true;
    },
    [begin, context.active, pointerLifecycle],
  );
  const handleMouseMove = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.move(metadata.pointerType, metadata.pointerId) ? move(event) : true;
    },
    [context.active, move, pointerLifecycle],
  );
  const handleMouseUp = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.end(metadata.pointerType, metadata.pointerId) ? end(event) : true;
    },
    [context.active, end, pointerLifecycle],
  );
  const handleTouchStart = handleMouseDown;
  const handleTouchMove = handleMouseMove;
  const handleTouchEnd = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      const handled = handleMouseUp(event);
      queueMicrotask(() => pointerLifecycle.releaseCompatibilityMouse());
      return handled;
    },
    [handleMouseUp, pointerLifecycle],
  );
  const handlePenDown = useCallback(
    (event: KonvaEventObject<PointerEvent>) =>
      !context.active || event.evt.pointerType !== 'pen'
        ? false
        : pointerLifecycle.begin('pen', event.evt.pointerId)
          ? begin(event)
          : true,
    [begin, context.active, pointerLifecycle],
  );
  const handlePenMove = useCallback(
    (event: KonvaEventObject<PointerEvent>) =>
      !context.active || event.evt.pointerType !== 'pen'
        ? false
        : pointerLifecycle.move('pen', event.evt.pointerId)
          ? move(event)
          : true,
    [context.active, move, pointerLifecycle],
  );
  const handlePenUp = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (!context.active || event.evt.pointerType !== 'pen') return false;
      if (!pointerLifecycle.end('pen', event.evt.pointerId)) return true;
      const handled = end(event);
      queueMicrotask(() => pointerLifecycle.releaseCompatibilityMouse());
      return handled;
    },
    [context.active, end, pointerLifecycle],
  );
  const handlePenCancel = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (!context.active || event.evt.pointerType !== 'pen') return false;
      if (pointerLifecycle.move('pen', event.evt.pointerId)) cancel('pointercancel');
      return true;
    },
    [cancel, context.active, pointerLifecycle],
  );
  const handleInputEvent = useCallback(
    (event: ViewerSurfaceInputEvent) => {
      if (
        event.type === 'blur' ||
        event.type === 'escape' ||
        event.type === 'lostpointercapture' ||
        event.type === 'pointercancel'
      )
        cancel(event.type);
    },
    [cancel],
  );

  useEffect(() => {
    if (!controller.synchronize(context)) return;
    pointerLifecycle.cancel();
    stageRef.current = null;
    setTransition('session-invalidated');
    publish();
  }, [context, controller, pointerLifecycle, publish]);
  useEffect(() => {
    if (!context.active) return;
    const globalMove = (event: MouseEvent | TouchEvent) => {
      const metadata = pointerMetadata(event);
      if (pointerLifecycle.move(metadata.pointerType, metadata.pointerId)) move(event);
    };
    const globalEnd = (event: MouseEvent | TouchEvent) => {
      const metadata = pointerMetadata(event);
      if (!pointerLifecycle.end(metadata.pointerType, metadata.pointerId)) return;
      end(event);
      queueMicrotask(() => pointerLifecycle.releaseCompatibilityMouse());
    };
    const globalCancel = () => cancel('pointercancel');
    window.addEventListener('mousemove', globalMove, { passive: false });
    window.addEventListener('mouseup', globalEnd);
    window.addEventListener('touchmove', globalMove, { passive: false });
    window.addEventListener('touchend', globalEnd);
    window.addEventListener('touchcancel', globalCancel);
    window.addEventListener('pointercancel', globalCancel);
    return () => {
      window.removeEventListener('mousemove', globalMove);
      window.removeEventListener('mouseup', globalEnd);
      window.removeEventListener('touchmove', globalMove);
      window.removeEventListener('touchend', globalEnd);
      window.removeEventListener('touchcancel', globalCancel);
      window.removeEventListener('pointercancel', globalCancel);
    };
  }, [cancel, context.active, end, move, pointerLifecycle]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pointerLifecycle.cancel();
      controller.cancel();
      stageRef.current = null;
    };
  }, [controller, pointerLifecycle]);

  return {
    active: overlay !== null,
    handleInputEvent,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handlePenCancel,
    handlePenDown,
    handlePenMove,
    handlePenUp,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    overlay,
    transition,
  };
};
