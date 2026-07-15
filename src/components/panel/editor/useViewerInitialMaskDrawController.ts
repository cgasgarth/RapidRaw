import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiPatch, MaskContainer } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import { overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { SubMask } from '../right/layers/Masks';
import {
  createViewerInitialMaskDrawInteractionController,
  isViewerInitialMaskDrawKeyCurrent,
  type ViewerInitialMaskDrawCommand,
  type ViewerInitialMaskDrawCurrentContext,
  type ViewerInitialMaskDrawOverlayDescriptor,
  type ViewerInitialMaskDrawSample,
} from './viewerInitialMaskDrawInteractionController';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';
import {
  isViewerKonvaPointerEvent,
  type ViewerKonvaPointerEvent,
  type ViewerPointerEndEvent,
  type ViewerPointerMoveEvent,
  viewerPointerIdentity,
} from './viewerPointerEvents';
import { createViewerPointerLifecycle } from './viewerPointerLifecycle';

interface UseViewerInitialMaskDrawControllerInput {
  readonly activeContainer: AiPatch | MaskContainer | null;
  readonly activeSubMask: SubMask | null;
  readonly baselineParameters: Readonly<Record<string, unknown>> | null;
  readonly context: ViewerInitialMaskDrawCurrentContext;
  readonly geometry: EditorOverlayGeometry;
  readonly groupOffsetX: number;
  readonly groupOffsetY: number;
  readonly imageSize: { readonly height: number; readonly width: number };
  readonly maxSafeScale: number;
  readonly onCommit: (command: ViewerInitialMaskDrawCommand) => void;
  readonly onLiveMaskPreview?: (container: AiPatch | MaskContainer) => void;
}

export interface ViewerInitialMaskDrawControllerBinding {
  readonly active: boolean;
  readonly overlay: ViewerInitialMaskDrawOverlayDescriptor | null;
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

/** Session-owned React/Konva boundary for initial Radial and Linear mask gestures. */
export const useViewerInitialMaskDrawController = ({
  activeContainer,
  activeSubMask,
  baselineParameters,
  context,
  geometry,
  groupOffsetX,
  groupOffsetY,
  imageSize,
  maxSafeScale,
  onCommit,
  onLiveMaskPreview,
}: UseViewerInitialMaskDrawControllerInput): ViewerInitialMaskDrawControllerBinding => {
  const controller = useMemo(() => createViewerInitialMaskDrawInteractionController(), []);
  const pointerLifecycle = useMemo(() => createViewerPointerLifecycle(), []);
  const stageRef = useRef<KonvaStage | null>(null);
  const mountedRef = useRef(true);
  const currentRef = useRef({
    activeContainer,
    activeSubMask,
    baselineParameters,
    context,
    geometry,
    imageSize,
    onCommit,
    onLiveMaskPreview,
  });
  currentRef.current = {
    activeContainer,
    activeSubMask,
    baselineParameters,
    context,
    geometry,
    imageSize,
    onCommit,
    onLiveMaskPreview,
  };
  const [overlay, setOverlay] = useState<ViewerInitialMaskDrawOverlayDescriptor | null>(null);
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
    ): ViewerInitialMaskDrawSample => {
      const currentGeometry = currentRef.current.geometry;
      const imagePoint = currentGeometry.cropToOriented(
        currentGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(viewPoint.x, viewPoint.y)),
      );
      return { ...viewerPointerIdentity(event), imagePoint, viewPoint };
    },
    [],
  );
  const publish = useCallback(
    (parameters?: Readonly<Record<string, unknown>>) => {
      const nextOverlay = controller.overlays()[0] ?? null;
      if (mountedRef.current) setOverlay(nextOverlay);
      const current = currentRef.current;
      const previewParameters = parameters ?? nextOverlay?.parameters;
      if (
        previewParameters === undefined ||
        current.onLiveMaskPreview === undefined ||
        current.activeContainer === null ||
        current.activeSubMask === null
      )
        return;
      const previewSubMask = { ...current.activeSubMask, parameters: { ...previewParameters } };
      current.onLiveMaskPreview({
        ...current.activeContainer,
        subMasks: current.activeContainer.subMasks.map((subMask) =>
          subMask.id === current.activeSubMask?.id ? previewSubMask : subMask,
        ),
      });
    },
    [controller],
  );
  const cancel = useCallback(
    (reason: string) => {
      const cancelledOverlay = controller.overlays()[0] ?? null;
      const current = currentRef.current;
      pointerLifecycle.cancel();
      controller.cancel();
      stageRef.current = null;
      if (mountedRef.current) setTransition(reason);
      publish(
        cancelledOverlay !== null &&
          current.baselineParameters !== null &&
          isViewerInitialMaskDrawKeyCurrent(cancelledOverlay.sessionKey, current.context)
          ? current.baselineParameters
          : undefined,
      );
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
      const began = controller.begin(current.context, toSample(point, event.evt), {
        baselineParameters: current.baselineParameters,
        imageSize: current.imageSize,
      });
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
      const metadata = viewerPointerIdentity(sourceEvent);
      const commands = controller.end(current.context, metadata.pointerId, metadata.pointerType);
      for (const command of commands) {
        if (!mountedRef.current) break;
        current.onCommit(command);
        publish(command.parameters);
      }
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
    [controller, publish],
  );

  const handleMouseDown = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      if ('button' in event.evt && event.evt.button !== 0) return true;
      const metadata = viewerPointerIdentity(event.evt);
      return pointerLifecycle.begin(metadata.pointerType, metadata.pointerId) ? begin(event) : true;
    },
    [begin, context.active, pointerLifecycle],
  );
  const handleMouseMove = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      const metadata = viewerPointerIdentity(event.evt);
      return pointerLifecycle.move(metadata.pointerType, metadata.pointerId) ? move(event) : true;
    },
    [context.active, move, pointerLifecycle],
  );
  const handleMouseUp = useCallback(
    (event: ViewerKonvaPointerEvent) => {
      if (!context.active) return false;
      const metadata = viewerPointerIdentity(event.evt);
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
      const metadata = viewerPointerIdentity(event);
      if (pointerLifecycle.move(metadata.pointerType, metadata.pointerId)) move(event);
    };
    const globalEnd = (event: MouseEvent | TouchEvent) => {
      const metadata = viewerPointerIdentity(event);
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
