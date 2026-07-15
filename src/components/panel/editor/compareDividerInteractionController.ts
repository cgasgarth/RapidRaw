import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import {
  clampCompareDivider,
  type EditorCompareOrientation,
  resolveCompareDividerGeometry,
} from '../../../utils/editorCompare';
import type { ViewerSurfacePointerEvent } from './viewerInputRouter';

export interface CompareDividerCurrentContext {
  readonly active: boolean;
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly imageRect: RenderSize;
  readonly orientation: EditorCompareOrientation;
  readonly position: number;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface CompareDividerSessionKey {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly operationGeneration: number;
  readonly orientation: EditorCompareOrientation;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly toolId: 'compare-divider';
}

export interface CompareDividerPointerSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly imageBounds: {
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  };
  readonly pointerId: number;
  readonly pointerType: 'mouse' | 'pen' | 'touch';
}

export type CompareDividerInputEvent =
  | ({
      readonly type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture';
    } & CompareDividerPointerSample)
  | { readonly key: string; readonly shiftKey: boolean; readonly type: 'keydown' }
  | { readonly type: 'blur' | 'escape' | 'reset' | 'session-invalidated' };

export type CompareDividerCommand =
  | { readonly key: CompareDividerSessionKey; readonly kind: 'set-position'; readonly position: number }
  | { readonly key: CompareDividerSessionKey; readonly kind: 'reset' };

export interface CompareDividerOverlayDescriptor {
  readonly accessibility: {
    readonly maximumPercent: 95;
    readonly minimumPercent: 5;
    readonly orientation: EditorCompareOrientation;
    readonly valuePercent: number;
  };
  readonly geometry: ReturnType<typeof resolveCompareDividerGeometry>;
  readonly geometryEpoch: number;
  readonly id: 'compare-divider';
  readonly pointerPolicy: 'capture';
  readonly sessionFingerprint: string;
  readonly zOrder: 'viewer-hud';
}

interface ActiveGesture {
  readonly key: CompareDividerSessionKey;
  readonly pointerId: number;
  readonly pointerType: CompareDividerPointerSample['pointerType'];
}

const sameCurrentIdentity = (left: CompareDividerCurrentContext, right: CompareDividerCurrentContext): boolean =>
  left.active === right.active &&
  left.geometryEpoch === right.geometryEpoch &&
  left.imageSessionId === right.imageSessionId &&
  left.orientation === right.orientation &&
  left.sourceIdentity === right.sourceIdentity &&
  left.sourceRevision === right.sourceRevision;

const compareDividerSessionFingerprint = (context: CompareDividerCurrentContext): string =>
  JSON.stringify([
    context.imageSessionId,
    context.sourceIdentity,
    context.sourceRevision,
    context.geometryEpoch,
    context.orientation,
    context.active,
    'compare-divider',
  ]);

export const resolveCompareDividerPointerPosition = (
  orientation: EditorCompareOrientation,
  sample: CompareDividerPointerSample,
): number | null => {
  const axisSize = orientation === 'vertical' ? sample.imageBounds.width : sample.imageBounds.height;
  if (!Number.isFinite(axisSize) || axisSize <= 0) return null;
  const axisStart = orientation === 'vertical' ? sample.imageBounds.left : sample.imageBounds.top;
  const axisPoint = orientation === 'vertical' ? sample.clientX : sample.clientY;
  return clampCompareDivider((axisPoint - axisStart) / axisSize);
};

/** Shared surface-to-image mapping used by divider command input and its rendered descriptor. */
export const compareDividerPointerSampleFromSurface = (
  event: ViewerSurfacePointerEvent,
  imageRect: RenderSize,
): CompareDividerPointerSample | null => {
  const surface = event.surfaceRect;
  if (
    surface === undefined ||
    surface.layoutWidth <= 0 ||
    surface.layoutHeight <= 0 ||
    surface.width <= 0 ||
    surface.height <= 0
  )
    return null;
  const scaleX = surface.width / surface.layoutWidth;
  const scaleY = surface.height / surface.layoutHeight;
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    imageBounds: {
      height: imageRect.height * scaleY,
      left: surface.x + imageRect.offsetX * scaleX,
      top: surface.y + imageRect.offsetY * scaleY,
      width: imageRect.width * scaleX,
    },
    pointerId: event.pointerId,
    pointerType: event.pointerType,
  };
};

export const createCompareDividerOverlayDescriptor = (
  context: CompareDividerCurrentContext,
): CompareDividerOverlayDescriptor => ({
  accessibility: {
    maximumPercent: 95,
    minimumPercent: 5,
    orientation: context.orientation,
    valuePercent: Math.round(clampCompareDivider(context.position) * 100),
  },
  geometry: resolveCompareDividerGeometry({
    dividerPosition: context.position,
    imageRect: context.imageRect,
    orientation: context.orientation,
  }),
  geometryEpoch: context.geometryEpoch,
  id: 'compare-divider',
  pointerPolicy: 'capture',
  sessionFingerprint: compareDividerSessionFingerprint(context),
  zOrder: 'viewer-hud',
});

export interface CompareDividerInteractionController {
  dispatch(context: CompareDividerCurrentContext, event: CompareDividerInputEvent): readonly CompareDividerCommand[];
  invalidate(): void;
  isActive(): boolean;
}

/** Keyed compare-divider authority. DOM adapters only capture/release pointers and execute returned commands. */
export const createCompareDividerInteractionController = (): CompareDividerInteractionController => {
  let active: ActiveGesture | null = null;
  let generation = 0;
  let synchronizedContext: CompareDividerCurrentContext | null = null;

  const nextKey = (context: CompareDividerCurrentContext): CompareDividerSessionKey => {
    generation += 1;
    return {
      geometryEpoch: context.geometryEpoch,
      imageSessionId: context.imageSessionId,
      operationGeneration: generation,
      orientation: context.orientation,
      sourceIdentity: context.sourceIdentity,
      sourceRevision: context.sourceRevision,
      toolId: 'compare-divider',
    };
  };

  const synchronize = (context: CompareDividerCurrentContext): boolean => {
    const invalidated = synchronizedContext !== null && !sameCurrentIdentity(synchronizedContext, context);
    if (invalidated || !context.active) active = null;
    synchronizedContext = context;
    return invalidated;
  };

  return {
    dispatch: (context, event) => {
      const invalidated = synchronize(context);
      if (event.type === 'session-invalidated') {
        active = null;
        return [];
      }
      if (event.type === 'blur' || event.type === 'escape') {
        active = null;
        return [];
      }
      if (!context.active || invalidated) return [];

      if (event.type === 'pointerdown') {
        if (active !== null) return [];
        const position = resolveCompareDividerPointerPosition(context.orientation, event);
        if (position === null) return [];
        const key = nextKey(context);
        active = { key, pointerId: event.pointerId, pointerType: event.pointerType };
        return [{ key, kind: 'set-position', position }];
      }

      if (
        event.type === 'pointermove' ||
        event.type === 'pointerup' ||
        event.type === 'pointercancel' ||
        event.type === 'lostpointercapture'
      ) {
        if (active === null || active.pointerId !== event.pointerId || active.pointerType !== event.pointerType) {
          return [];
        }
        if (event.type === 'pointermove') {
          const position = resolveCompareDividerPointerPosition(context.orientation, event);
          return position === null ? [] : [{ key: active.key, kind: 'set-position', position }];
        }
        active = null;
        return [];
      }

      if (event.type === 'reset') return [{ key: nextKey(context), kind: 'reset' }];
      if (event.type !== 'keydown') return [];
      const decrementKey = context.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const incrementKey = context.orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === 'Home') {
        return [{ key: nextKey(context), kind: 'set-position', position: 0.05 }];
      }
      if (event.key === 'End') {
        return [{ key: nextKey(context), kind: 'set-position', position: 0.95 }];
      }
      if (event.key !== decrementKey && event.key !== incrementKey) return [];
      const direction = event.key === incrementKey ? 1 : -1;
      return [
        {
          key: nextKey(context),
          kind: 'set-position',
          position: clampCompareDivider(context.position + direction * (event.shiftKey ? 0.1 : 0.01)),
        },
      ];
    },
    invalidate: () => {
      active = null;
      synchronizedContext = null;
    },
    isActive: () => active !== null,
  };
};
