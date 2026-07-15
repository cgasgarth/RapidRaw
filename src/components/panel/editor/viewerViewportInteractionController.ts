import {
  applyPointerOverscrollResistance,
  applyWheelPanResistance,
  getRecentPanVelocity,
  getWheelPanDelta,
  getWheelZoomExponent,
  getWheelZoomMultiplier,
  MAX_PAN_VELOCITY_SAMPLES,
  PAN_VELOCITY_THRESHOLD,
  type TransformBounds,
} from '../../../utils/editorGestureMath';
import type { TransformState } from '../../ui/AppProperties';
import {
  isViewerDrag,
  resolveViewerInput,
  resolveViewerWheelIntent,
  type ViewerActiveTool,
  type ViewerGestureOwner,
  type ViewerPointerType,
} from './viewerInputResolver';

export type ViewerViewportCancelReason =
  | 'blur'
  | 'escape'
  | 'lostpointercapture'
  | 'pointercancel'
  | 'session-invalidated'
  | 'unmount';

export interface ViewerViewportSessionIdentity {
  readonly activeTool: ViewerActiveTool;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly toolId: 'viewer-viewport';
}

export interface ViewerViewportSessionKey extends ViewerViewportSessionIdentity {
  readonly operationGeneration: number;
}

export interface ViewerViewportCurrentContext extends Omit<ViewerViewportSessionIdentity, 'toolId'> {
  readonly getBounds: (scale: number) => TransformBounds;
  readonly inputMode: 'mouse' | 'trackpad';
  readonly maxScale: number;
  readonly minScale: number;
  readonly surface: { readonly height: number; readonly left: number; readonly top: number; readonly width: number };
  readonly transform: TransformState;
  readonly zoomSpeedMultiplier: number;
}

interface ViewerViewportPointerEvent {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: ViewerPointerType;
  readonly time: number;
}

export type ViewerViewportInputEvent =
  | ({ readonly type: 'pointerdown' | 'pointermove' | 'pointerup' } & ViewerViewportPointerEvent)
  | ({ readonly type: 'pointercancel' | 'lostpointercapture' } & Pick<ViewerViewportPointerEvent, 'pointerId'>)
  | {
      readonly altKey: boolean;
      readonly clientX: number;
      readonly clientY: number;
      readonly ctrlKey: boolean;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly shiftKey: boolean;
      readonly type: 'wheel';
    }
  | { readonly active: boolean; readonly type: 'temporary-hand' }
  | {
      readonly reason: Exclude<ViewerViewportCancelReason, 'lostpointercapture' | 'pointercancel'>;
      readonly type: 'cancel';
    };

export interface ViewerViewportControllerState {
  readonly activePointerCount: number;
  readonly isDragging: boolean;
  readonly isMiddleMousePanning: boolean;
  readonly isPanning: boolean;
  readonly temporaryHand: boolean;
}

export interface ViewerViewportTransition {
  readonly cancelMotion: boolean;
  readonly capturePointerId: number | null;
  readonly dragged: boolean;
  readonly focalPoint: { readonly source: 'center' | 'pointer'; readonly x: number; readonly y: number } | null;
  readonly physics: { readonly vx: number; readonly vy: number } | null;
  readonly releasePointerId: number | null;
  readonly semanticZoomScale: number | null;
  readonly sessionKey: ViewerViewportSessionKey | null;
  readonly state: ViewerViewportControllerState;
  readonly transform: TransformState | null;
  readonly wheelSnap: boolean;
}

interface PointerRecord {
  owner: ViewerGestureOwner;
  readonly pointerType: ViewerPointerType;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
}

interface PinchRecord {
  readonly distance: number;
  readonly midX: number;
  readonly midY: number;
}

const sameIdentity = (left: ViewerViewportSessionIdentity, right: ViewerViewportCurrentContext): boolean =>
  left.activeTool === right.activeTool &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision;

const boundedTransform = (
  context: ViewerViewportCurrentContext,
  positionX: number,
  positionY: number,
  scale: number,
): TransformState => {
  const safeScale = Math.min(Math.max(Number.isFinite(scale) ? scale : 1, context.minScale), context.maxScale);
  const bounds = context.getBounds(safeScale);
  return {
    positionX: Math.min(Math.max(Number.isFinite(positionX) ? positionX : 0, bounds.minX), bounds.maxX),
    positionY: Math.min(Math.max(Number.isFinite(positionY) ? positionY : 0, bounds.minY), bounds.maxY),
    scale: safeScale,
  };
};

export interface ViewerViewportInteractionController {
  dispatch(context: ViewerViewportCurrentContext, event: ViewerViewportInputEvent): ViewerViewportTransition;
  getState(): ViewerViewportControllerState;
  synchronize(context: ViewerViewportCurrentContext): ViewerViewportTransition;
}

/** Owns viewport gesture identity, pointer lifecycle, and transform commands without DOM or React state. */
export const createViewerViewportInteractionController = (): ViewerViewportInteractionController => {
  const pointers = new Map<number, PointerRecord>();
  const draggedPointers = new Set<number>();
  let currentIdentity: ViewerViewportSessionIdentity | null = null;
  let generation = 0;
  let sessionKey: ViewerViewportSessionKey | null = null;
  let temporaryHand = false;
  let panning = false;
  let middleMousePanning = false;
  let hadViewerGesture = false;
  let lastPan: { x: number; y: number } | null = null;
  let lastPinch: PinchRecord | null = null;
  let panHistory: Array<{ t: number; x: number; y: number }> = [];

  const state = (): ViewerViewportControllerState => ({
    activePointerCount: pointers.size,
    isDragging: draggedPointers.size > 0,
    isMiddleMousePanning: middleMousePanning,
    isPanning: panning,
    temporaryHand,
  });

  const transition = (values: Partial<Omit<ViewerViewportTransition, 'state'>> = {}): ViewerViewportTransition => ({
    cancelMotion: false,
    capturePointerId: null,
    dragged: false,
    focalPoint: null,
    physics: null,
    releasePointerId: null,
    semanticZoomScale: null,
    sessionKey,
    transform: null,
    wheelSnap: false,
    ...values,
    state: state(),
  });

  const clearGesture = (clearHand: boolean): void => {
    pointers.clear();
    draggedPointers.clear();
    sessionKey = null;
    panning = false;
    middleMousePanning = false;
    hadViewerGesture = false;
    lastPan = null;
    lastPinch = null;
    panHistory = [];
    if (clearHand) temporaryHand = false;
  };

  const beginSession = (context: ViewerViewportCurrentContext): ViewerViewportSessionKey => {
    generation += 1;
    sessionKey = {
      activeTool: context.activeTool,
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      operationGeneration: generation,
      sourceIdentity: context.sourceIdentity,
      sourceRevision: context.sourceRevision,
      toolId: 'viewer-viewport',
    };
    return sessionKey;
  };

  const synchronize = (context: ViewerViewportCurrentContext): ViewerViewportTransition => {
    if (currentIdentity !== null && sameIdentity(currentIdentity, context)) return transition();
    const invalidated = currentIdentity !== null;
    clearGesture(false);
    currentIdentity = {
      activeTool: context.activeTool,
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      sourceIdentity: context.sourceIdentity,
      sourceRevision: context.sourceRevision,
      toolId: 'viewer-viewport',
    };
    return transition({ cancelMotion: invalidated });
  };

  const localPoint = (context: ViewerViewportCurrentContext, clientX: number, clientY: number) => ({
    x: clientX - context.surface.left,
    y: clientY - context.surface.top,
  });

  return {
    dispatch: (context, event) => {
      const synchronized = synchronize(context);
      if (
        synchronized.cancelMotion &&
        event.type !== 'pointerdown' &&
        event.type !== 'temporary-hand' &&
        event.type !== 'wheel'
      ) {
        return synchronized;
      }

      if (event.type === 'temporary-hand') {
        temporaryHand = event.active;
        return transition({ cancelMotion: synchronized.cancelMotion });
      }
      if (event.type === 'cancel') {
        clearGesture(event.reason === 'blur' || event.reason === 'escape' || event.reason === 'unmount');
        return transition({ cancelMotion: true });
      }
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        if (!pointers.has(event.pointerId)) return transition();
        clearGesture(false);
        return transition({ cancelMotion: true, releasePointerId: event.pointerId });
      }
      if (event.type === 'wheel') {
        const key = beginSession(context);
        const anchor = localPoint(context, event.clientX, event.clientY);
        const zoomIntent =
          resolveViewerWheelIntent({ ctrlKey: event.ctrlKey, inputMode: context.inputMode }) === 'zoom';
        if (zoomIntent) {
          const multiplier = getWheelZoomMultiplier(context.inputMode === 'trackpad', context.zoomSpeedMultiplier);
          const exponent = getWheelZoomExponent(event, multiplier);
          const scale = Math.min(
            Math.max(context.transform.scale * Math.exp(-exponent), context.minScale),
            context.maxScale,
          );
          const ratio = scale / context.transform.scale;
          const next = boundedTransform(
            context,
            anchor.x - (anchor.x - context.transform.positionX) * ratio,
            anchor.y - (anchor.y - context.transform.positionY) * ratio,
            scale,
          );
          return transition({
            cancelMotion: true,
            focalPoint: { source: 'pointer', ...anchor },
            semanticZoomScale: next.scale,
            sessionKey: key,
            transform: next,
          });
        }
        if (context.transform.scale <= 1.01) return transition({ cancelMotion: true, sessionKey: key });
        const delta = getWheelPanDelta(event, context.inputMode === 'trackpad');
        const nextPosition = applyWheelPanResistance(
          context.transform.positionX - delta.dx,
          context.transform.positionY - delta.dy,
          context.getBounds(context.transform.scale),
        );
        return transition({
          cancelMotion: true,
          focalPoint: { source: 'pointer', ...anchor },
          sessionKey: key,
          transform: {
            positionX: nextPosition.x,
            positionY: nextPosition.y,
            scale: context.transform.scale,
          },
          wheelSnap: true,
        });
      }

      if (event.type === 'pointerdown') {
        if (pointers.has(event.pointerId)) return transition();
        const resolution = resolveViewerInput({
          activeTool: context.activeTool,
          button: event.button,
          focusContext: 'viewer',
          isDragging: false,
          isTemporaryHand: temporaryHand,
          pointerCount: pointers.size + 1,
          pointerType: event.pointerType,
          zoomed: context.transform.scale > 1.01,
        });
        pointers.set(event.pointerId, {
          owner: resolution.owner,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
        });
        if (event.pointerType === 'touch' && pointers.size >= 2) {
          for (const pointer of pointers.values()) {
            if (pointer.pointerType === 'touch') pointer.owner = 'viewer-pan';
          }
        }
        const pointer = pointers.get(event.pointerId);
        if (pointer?.owner !== 'viewer-pan') return transition();
        const key = sessionKey ?? beginSession(context);
        hadViewerGesture = true;
        if (resolution.reason === 'middle-button') middleMousePanning = true;
        if (pointers.size === 1) {
          lastPan = { x: event.clientX, y: event.clientY };
        } else if (pointers.size === 2) {
          const [first, second] = Array.from(pointers.values());
          if (first && second) {
            lastPinch = {
              distance: Math.hypot(first.x - second.x, first.y - second.y),
              midX: (first.x + second.x) / 2,
              midY: (first.y + second.y) / 2,
            };
          }
        }
        const anchor = localPoint(context, event.clientX, event.clientY);
        return transition({
          cancelMotion: true,
          capturePointerId: resolution.shouldCapturePointer ? event.pointerId : null,
          focalPoint: { source: 'pointer', ...anchor },
          sessionKey: key,
        });
      }

      if (event.type === 'pointermove') {
        const pointer = pointers.get(event.pointerId);
        if (!pointer) return transition();
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (
          pointer.owner === 'viewer-pan' &&
          isViewerDrag({ x: pointer.startX, y: pointer.startY }, { x: event.clientX, y: event.clientY })
        ) {
          draggedPointers.add(event.pointerId);
        }
        if (pointers.size === 1 && pointer.owner === 'viewer-pan' && draggedPointers.has(event.pointerId) && lastPan) {
          panning = true;
          panHistory.push({ t: event.time, x: event.clientX, y: event.clientY });
          if (panHistory.length > MAX_PAN_VELOCITY_SAMPLES) panHistory.shift();
          let dx = event.clientX - lastPan.x;
          let dy = event.clientY - lastPan.y;
          lastPan = { x: event.clientX, y: event.clientY };
          ({ dx, dy } = applyPointerOverscrollResistance(
            dx,
            dy,
            { x: context.transform.positionX, y: context.transform.positionY },
            context.getBounds(context.transform.scale),
          ));
          const anchor = localPoint(context, event.clientX, event.clientY);
          return transition({
            dragged: true,
            focalPoint: { source: 'pointer', ...anchor },
            transform: {
              positionX: context.transform.positionX + dx,
              positionY: context.transform.positionY + dy,
              scale: context.transform.scale,
            },
          });
        }
        if (pointers.size === 2 && lastPinch) {
          const [first, second] = Array.from(pointers.values());
          if (!first || !second || first.owner !== 'viewer-pan' || second.owner !== 'viewer-pan') return transition();
          panning = true;
          for (const [pointerId] of pointers) draggedPointers.add(pointerId);
          const distance = Math.hypot(first.x - second.x, first.y - second.y);
          if (!Number.isFinite(distance) || lastPinch.distance <= 0) return transition();
          const midX = (first.x + second.x) / 2;
          const midY = (first.y + second.y) / 2;
          const anchor = localPoint(context, midX, midY);
          const scale = Math.min(
            Math.max(context.transform.scale * (distance / lastPinch.distance), context.minScale),
            context.maxScale,
          );
          const ratio = scale / context.transform.scale;
          const next = boundedTransform(
            context,
            anchor.x - (anchor.x - context.transform.positionX) * ratio + (midX - lastPinch.midX),
            anchor.y - (anchor.y - context.transform.positionY) * ratio + (midY - lastPinch.midY),
            scale,
          );
          lastPinch = { distance, midX, midY };
          return transition({
            dragged: true,
            focalPoint: { source: 'pointer', ...anchor },
            semanticZoomScale: next.scale,
            transform: next,
          });
        }
        return transition({ dragged: draggedPointers.has(event.pointerId) });
      }

      if (event.type !== 'pointerup') return transition();
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return transition();
      const wasViewerGesture = pointer.owner === 'viewer-pan';
      const dragged = draggedPointers.delete(event.pointerId);
      pointers.delete(event.pointerId);
      if (pointers.size === 1) {
        const remaining = Array.from(pointers.values())[0];
        lastPan = remaining?.owner === 'viewer-pan' ? { x: remaining.x, y: remaining.y } : null;
        lastPinch = null;
        return transition({ dragged, releasePointerId: event.pointerId });
      }
      if (pointers.size > 0) return transition({ dragged, releasePointerId: event.pointerId });

      panning = false;
      middleMousePanning = false;
      lastPan = null;
      lastPinch = null;
      const velocity = getRecentPanVelocity(panHistory, event.time);
      panHistory = [];
      const bounds = context.getBounds(context.transform.scale);
      const outOfBounds =
        context.transform.positionX > bounds.maxX ||
        context.transform.positionX < bounds.minX ||
        context.transform.positionY > bounds.maxY ||
        context.transform.positionY < bounds.minY;
      const shouldStartPhysics =
        wasViewerGesture &&
        hadViewerGesture &&
        (Math.abs(velocity.vx) > PAN_VELOCITY_THRESHOLD ||
          Math.abs(velocity.vy) > PAN_VELOCITY_THRESHOLD ||
          outOfBounds);
      hadViewerGesture = false;
      sessionKey = null;
      return transition({
        dragged,
        focalPoint: {
          source: 'center',
          x: context.surface.width / 2,
          y: context.surface.height / 2,
        },
        physics: shouldStartPhysics ? velocity : null,
        releasePointerId: event.pointerId,
      });
    },
    getState: state,
    synchronize,
  };
};

export const isViewerViewportSessionCurrent = (
  key: ViewerViewportSessionKey,
  context: ViewerViewportCurrentContext,
): boolean => sameIdentity(key, context);
