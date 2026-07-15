import type { KonvaEventObject } from 'konva/lib/Node';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiPatch, MaskContainer } from '../../../utils/adjustments';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import { overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { SubMask } from '../right/layers/Masks';
import {
  createViewerBrushCommandAdapter,
  type ViewerBrushCommandCaptureSummary,
  type ViewerBrushCommitResult,
  type ViewerBrushParameters,
} from './viewerBrushCommandAdapter';
import {
  createViewerBrushInteractionController,
  type ViewerBrushCancelReason,
  type ViewerBrushCommand,
  type ViewerBrushCurrentContext,
  type ViewerBrushLine,
  type ViewerBrushPointerSample,
  type ViewerBrushSettings,
} from './viewerBrushInteractionController';
import { createViewerBrushPointerLifecycle } from './viewerBrushPointerLifecycle';
import type { ViewerSurfaceInputEvent } from './viewerInputRouter';

export type ViewerBrushKonvaEvent = KonvaEventObject<MouseEvent | PointerEvent | TouchEvent>;
export type ViewerBrushMoveEvent = ViewerBrushKonvaEvent | MouseEvent | TouchEvent;
export type ViewerBrushEndEvent = ViewerBrushKonvaEvent | MouseEvent | TouchEvent;

interface ViewerBrushCursorDescriptor {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
}

interface UseViewerBrushControllerInput {
  readonly activeContainer: AiPatch | MaskContainer | null;
  readonly activeSubMask: SubMask | null;
  readonly context: ViewerBrushCurrentContext;
  readonly geometry: EditorOverlayGeometry;
  readonly groupOffsetX: number;
  readonly groupOffsetY: number;
  readonly imagePath: string;
  readonly imageSize: { readonly height: number; readonly width: number };
  readonly maxSafeScale: number;
  readonly onCommit: (result: ViewerBrushCommitResult) => void;
  readonly onLiveMaskPreview?: (container: AiPatch | MaskContainer) => void;
  readonly parameters: ViewerBrushParameters | null;
  readonly settings: ViewerBrushSettings;
}

export interface ViewerBrushControllerBinding {
  readonly commandCapture: ViewerBrushCommandCaptureSummary | null;
  readonly cursor: ViewerBrushCursorDescriptor;
  readonly liveLine: ViewerBrushLine | null;
  cancel(reason: ViewerBrushCancelReason): void;
  handleInputEvent(event: ViewerSurfaceInputEvent): void;
  handleMouseDown(event: ViewerBrushKonvaEvent): boolean;
  handleMouseEnter(): void;
  handleMouseLeave(): void;
  handleMouseMove(event: ViewerBrushKonvaEvent): boolean;
  handleMouseUp(event: ViewerBrushKonvaEvent): boolean;
  handlePenCancel(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenDown(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenMove(event: KonvaEventObject<PointerEvent>): boolean;
  handlePenUp(event: KonvaEventObject<PointerEvent>): boolean;
  handleTouchEnd(event: ViewerBrushKonvaEvent): boolean;
  handleTouchMove(event: ViewerBrushKonvaEvent): boolean;
  handleTouchStart(event: ViewerBrushKonvaEvent): boolean;
}

const isKonvaEvent = (event: ViewerBrushMoveEvent): event is ViewerBrushKonvaEvent =>
  'evt' in event && 'target' in event;

const pointerMetadata = (event: MouseEvent | PointerEvent | TouchEvent) => {
  const pointerType =
    'pointerType' in event && (event.pointerType === 'pen' || event.pointerType === 'touch')
      ? event.pointerType
      : 'touches' in event
        ? 'touch'
        : 'mouse';
  const pressure =
    'pressure' in event && pointerType !== 'mouse' ? Math.max(0, Math.min(1, event.pressure)) : undefined;
  const touch = 'touches' in event ? (event.touches[0] ?? event.changedTouches[0]) : undefined;
  return {
    altKey: event.altKey,
    pointerId: 'pointerId' in event ? event.pointerId : touch ? touch.identifier + 1 : 1,
    pointerType,
    ...(pressure === undefined ? {} : { pressure }),
    shiftKey: event.shiftKey,
  } as const;
};

/** React/Konva binding for one exact, session-owned brush stroke authority. */
export const useViewerBrushController = ({
  activeContainer,
  activeSubMask,
  context,
  geometry,
  groupOffsetX,
  groupOffsetY,
  imagePath,
  imageSize,
  maxSafeScale,
  onCommit,
  onLiveMaskPreview,
  parameters,
  settings,
}: UseViewerBrushControllerInput): ViewerBrushControllerBinding => {
  const controller = useMemo(() => createViewerBrushInteractionController(), []);
  const commandAdapter = useMemo(() => createViewerBrushCommandAdapter(), []);
  const pointerLifecycle = useMemo(() => createViewerBrushPointerLifecycle(), []);
  const stageRef = useRef<KonvaStage | null>(null);
  const mountedRef = useRef(true);
  const currentRef = useRef({
    activeContainer,
    activeSubMask,
    context,
    geometry,
    imagePath,
    imageSize,
    onCommit,
    onLiveMaskPreview,
    parameters,
    settings,
  });
  currentRef.current = {
    activeContainer,
    activeSubMask,
    context,
    geometry,
    imagePath,
    imageSize,
    onCommit,
    onLiveMaskPreview,
    parameters,
    settings,
  };
  const [commandCapture, setCommandCapture] = useState<ViewerBrushCommandCaptureSummary | null>(null);
  const [cursor, setCursor] = useState<ViewerBrushCursorDescriptor>({ visible: false, x: 0, y: 0 });
  const [liveLine, setLiveLine] = useState<ViewerBrushLine | null>(null);

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
    ): ViewerBrushPointerSample => {
      const { geometry: currentGeometry } = currentRef.current;
      const imagePoint = currentGeometry.cropToOriented(
        currentGeometry.viewToCrop(overlayPoint<'view-css-pixels'>(viewPoint.x, viewPoint.y)),
      );
      const metadata = pointerMetadata(event);
      return {
        altKey: metadata.altKey,
        imagePoint: {
          ...(metadata.pressure === undefined ? {} : { pressure: metadata.pressure }),
          x: imagePoint.x,
          y: imagePoint.y,
        },
        pointerId: metadata.pointerId,
        pointerType: metadata.pointerType,
        shiftKey: metadata.shiftKey,
        viewPoint: {
          ...(metadata.pressure === undefined ? {} : { pressure: metadata.pressure }),
          ...viewPoint,
        },
      };
    },
    [],
  );
  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    const line = controller.overlays()[0]?.imageLine ?? null;
    setLiveLine(line);
    const current = currentRef.current;
    if (line === null || current.onLiveMaskPreview === undefined || !current.activeContainer || !current.activeSubMask)
      return;
    const previewSubMask = {
      ...current.activeSubMask,
      parameters: { ...(current.parameters ?? {}), lines: [...(current.parameters?.lines ?? []), line] },
    };
    current.onLiveMaskPreview({
      ...current.activeContainer,
      subMasks: current.activeContainer.subMasks.map((subMask) =>
        subMask.id === current.activeSubMask?.id ? previewSubMask : subMask,
      ),
    });
  }, [controller]);
  const execute = useCallback(
    (commands: readonly ViewerBrushCommand[]) => {
      const current = currentRef.current;
      for (const command of commands) {
        if (command.kind !== 'commit' || !current.activeSubMask || !current.parameters) continue;
        const result = commandAdapter.commit(command, {
          current: current.context,
          imagePath: current.imagePath,
          imageSize: current.imageSize,
          parameters: current.parameters,
          subMask: current.activeSubMask,
        });
        if (result !== null && mountedRef.current) {
          setCommandCapture(result.summary);
          current.onCommit(result);
        }
      }
      if (commands.some(({ kind }) => kind === 'cancel')) pointerLifecycle.cancel();
      if (commands.some(({ kind }) => kind === 'cancel' || kind === 'commit')) stageRef.current = null;
      publish();
    },
    [commandAdapter, pointerLifecycle, publish],
  );
  const cancel = useCallback(
    (reason: ViewerBrushCancelReason) => {
      pointerLifecycle.cancel();
      execute(controller.cancel(reason));
    },
    [controller, execute, pointerLifecycle],
  );
  const handleStart = useCallback(
    (event: ViewerBrushKonvaEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      if ('button' in event.evt && event.evt.button !== 0) return true;
      if (event.evt.cancelable) event.evt.preventDefault();
      const stage = event.target.getStage();
      const point = toViewPoint(stage);
      if (point === null) return true;
      stageRef.current = stage;
      execute(controller.begin(current.context, toSample(point, event.evt), current.settings));
      return true;
    },
    [controller, execute, toSample, toViewPoint],
  );
  const handleMove = useCallback(
    (event: ViewerBrushMoveEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      const stage = isKonvaEvent(event) ? event.target.getStage() : stageRef.current;
      if (!isKonvaEvent(event) && stage !== null) stage.setPointersPositions(event);
      const point = toViewPoint(stage);
      setCursor((previous) => (point === null ? { ...previous, visible: false } : { ...point, visible: true }));
      if (point !== null) {
        const sourceEvent = isKonvaEvent(event) ? event.evt : event;
        execute(controller.move(current.context, toSample(point, sourceEvent)));
        if (sourceEvent.cancelable) sourceEvent.preventDefault();
      }
      return true;
    },
    [controller, execute, toSample, toViewPoint],
  );
  const handleEnd = useCallback(
    (event?: ViewerBrushEndEvent): boolean => {
      const current = currentRef.current;
      if (!current.context.active) return false;
      const stage = event && isKonvaEvent(event) ? event.target.getStage() : null;
      const point = toViewPoint(stage);
      execute(
        controller.end(
          current.context,
          event && isKonvaEvent(event) && point !== null ? toSample(point, event.evt) : undefined,
        ),
      );
      return true;
    },
    [controller, execute, toSample, toViewPoint],
  );

  const handleMouseDown = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      if ('button' in event.evt && event.evt.button !== 0) return true;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.begin(metadata.pointerType, metadata.pointerId) ? handleStart(event) : true;
    },
    [context.active, handleStart, pointerLifecycle],
  );
  const handleMouseMove = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.move(metadata.pointerType, metadata.pointerId) ? handleMove(event) : true;
    },
    [context.active, handleMove, pointerLifecycle],
  );
  const handleMouseUp = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.end(metadata.pointerType, metadata.pointerId) ? handleEnd(event) : true;
    },
    [context.active, handleEnd, pointerLifecycle],
  );
  const handleTouchStart = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.begin(metadata.pointerType, metadata.pointerId) ? handleStart(event) : true;
    },
    [context.active, handleStart, pointerLifecycle],
  );
  const handleTouchMove = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      return pointerLifecycle.move(metadata.pointerType, metadata.pointerId) ? handleMove(event) : true;
    },
    [context.active, handleMove, pointerLifecycle],
  );
  const handleTouchEnd = useCallback(
    (event: ViewerBrushKonvaEvent) => {
      if (!context.active) return false;
      const metadata = pointerMetadata(event.evt);
      if (!pointerLifecycle.end(metadata.pointerType, metadata.pointerId)) return true;
      const handled = handleEnd(event);
      queueMicrotask(() => {
        pointerLifecycle.releaseCompatibilityMouse();
      });
      return handled;
    },
    [context.active, handleEnd, pointerLifecycle],
  );
  const handlePenDown = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (!context.active || event.evt.pointerType !== 'pen') return false;
      return pointerLifecycle.begin('pen', event.evt.pointerId) ? handleStart(event) : true;
    },
    [context.active, handleStart, pointerLifecycle],
  );
  const handlePenMove = useCallback(
    (event: KonvaEventObject<PointerEvent>) =>
      context.active && event.evt.pointerType === 'pen' && pointerLifecycle.move('pen', event.evt.pointerId)
        ? handleMove(event)
        : context.active,
    [context.active, handleMove, pointerLifecycle],
  );
  const handlePenUp = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (!context.active || event.evt.pointerType !== 'pen') return false;
      if (!pointerLifecycle.end('pen', event.evt.pointerId)) return true;
      const handled = handleEnd(event);
      queueMicrotask(() => {
        pointerLifecycle.releaseCompatibilityMouse();
      });
      return handled;
    },
    [context.active, handleEnd, pointerLifecycle],
  );
  const handlePenCancel = useCallback(
    (event: KonvaEventObject<PointerEvent>) => {
      if (!context.active || event.evt.pointerType !== 'pen' || !pointerLifecycle.move('pen', event.evt.pointerId))
        return context.active;
      cancel('pointercancel');
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
    const current = currentRef.current;
    const commands = controller.synchronize(current.context);
    if (current.activeSubMask && current.parameters) {
      commandAdapter.synchronize({
        current: current.context,
        imagePath: current.imagePath,
        imageSize: current.imageSize,
        parameters: current.parameters,
        subMask: current.activeSubMask,
      });
    }
    if (commands.length > 0) execute(commands);
  }, [
    commandAdapter,
    context.active,
    context.adjustmentRevision,
    context.containerId,
    context.containerKind,
    context.geometryEpoch,
    context.imageSessionId,
    context.maskId,
    context.sourceIdentity,
    context.sourceRevision,
    controller,
    execute,
    parameters,
  ]);
  useEffect(() => {
    if (!context.active) return;
    const globalMove = (event: MouseEvent | TouchEvent) => {
      const metadata = pointerMetadata(event);
      if (pointerLifecycle.move(metadata.pointerType, metadata.pointerId)) handleMove(event);
    };
    const globalEnd = (event: MouseEvent | TouchEvent) => {
      const metadata = pointerMetadata(event);
      if (!pointerLifecycle.end(metadata.pointerType, metadata.pointerId)) return;
      handleEnd(event);
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
  }, [cancel, context.active, handleEnd, handleMove, pointerLifecycle]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pointerLifecycle.cancel();
      controller.cancel('unmount');
      stageRef.current = null;
    };
  }, [controller, pointerLifecycle]);

  return {
    cancel,
    commandCapture,
    cursor,
    handleInputEvent,
    handleMouseDown,
    handleMouseEnter: () => {
      if (context.active) setCursor((previous) => ({ ...previous, visible: true }));
    },
    handleMouseLeave: () => setCursor((previous) => ({ ...previous, visible: false })),
    handleMouseMove,
    handleMouseUp,
    handlePenCancel,
    handlePenDown,
    handlePenMove,
    handlePenUp,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    liveLine,
  };
};
