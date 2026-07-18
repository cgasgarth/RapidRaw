import {
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from 'react';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import type { ViewerActiveTool } from './viewerInputResolver';
import {
  normalizeViewerSurfacePointerEvent,
  type ViewerSurfaceInputEvent,
  type ViewerSurfacePointerEvent,
} from './viewerInputRouter';

const viewerTargetTool = (target: EventTarget | null): ViewerActiveTool | undefined => {
  if (!(target instanceof Element)) return undefined;
  const value = target.closest<HTMLElement>('[data-viewer-input-tool]')?.dataset['viewerInputTool'];
  if (
    value === 'color-mixer' ||
    value === 'brush' ||
    value === 'compare-divider' ||
    value === 'crop' ||
    value === 'focus-retouch' ||
    value === 'mask' ||
    value === 'none' ||
    value === 'object-prompt' ||
    value === 'point-color' ||
    value === 'retouch' ||
    value === 'straighten' ||
    value === 'tone-curve' ||
    value === 'tone-equalizer' ||
    value === 'white-balance'
  )
    return value;
  return undefined;
};

/**
 * Presentation-only boundary for the editor viewer.
 *
 * The surface owns no tool state and never interprets pointer/keyboard events;
 * interaction controllers receive the ordinary DOM callbacks passed by the
 * editor and render declarative children into this stable presentation host.
 */
export interface ViewerSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  geometry: EditorOverlayGeometry;
  onInputEvent?: (event: ViewerSurfaceInputEvent) => void;
  presentation: EditorPresentationDescriptor;
}

export const viewerSurfaceDataAttributes = (
  presentation: EditorPresentationDescriptor,
  geometry: EditorOverlayGeometry,
): { 'data-viewer-surface': 'true'; 'data-presentation-fingerprint': string; 'data-geometry-epoch': string } => ({
  'data-viewer-surface': 'true',
  'data-presentation-fingerprint': presentation.fingerprint,
  'data-geometry-epoch': String(geometry.geometryEpoch),
});

export const viewerSurfaceA11yAttributes = ({
  role,
  tabIndex,
}: {
  role?: string | undefined;
  tabIndex?: number | undefined;
}): { 'aria-roledescription': string; role: string; tabIndex: number } => ({
  'aria-roledescription': 'image viewer',
  role: role ?? 'application',
  tabIndex: tabIndex ?? 0,
});

export function ViewerSurface({
  children,
  geometry,
  onInputEvent,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostPointerCapture,
  onDoubleClick,
  onBlur,
  onKeyDown,
  presentation,
  role,
  tabIndex,
  ...props
}: ViewerSurfaceProps) {
  const lastPointerTargetToolRef = useRef<ViewerActiveTool | undefined>(undefined);
  const dispatchPointerEvent = (event: PointerEvent<HTMLDivElement>, type: ViewerSurfacePointerEvent['type']): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const targetTool = viewerTargetTool(event.target);
    if (type === 'pointerdown') lastPointerTargetToolRef.current = targetTool;
    onInputEvent?.(
      normalizeViewerSurfacePointerEvent({
        altKey: event.altKey,
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        pressure: event.pressure,
        shiftKey: event.shiftKey,
        surfaceRect: {
          height: rect.height,
          layoutHeight: event.currentTarget.offsetHeight,
          layoutWidth: event.currentTarget.offsetWidth,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
        ...(targetTool === undefined ? {} : { targetTool }),
        type,
      }),
    );
  };
  const dispatchSemanticEvent = (type: 'blur' | 'doubleclick' | 'escape', target: EventTarget | null): void => {
    const targetTool =
      viewerTargetTool(target) ?? (type === 'doubleclick' ? lastPointerTargetToolRef.current : undefined);
    onInputEvent?.({ ...(targetTool === undefined ? {} : { targetTool }), type });
  };
  const a11y = viewerSurfaceA11yAttributes({ role, tabIndex });
  return (
    <div
      {...props}
      {...viewerSurfaceDataAttributes(presentation, geometry)}
      aria-roledescription={props['aria-roledescription'] ?? a11y['aria-roledescription']}
      onPointerCancelCapture={(event) => {
        dispatchPointerEvent(event, 'pointercancel');
        onPointerCancel?.(event);
      }}
      onPointerDownCapture={(event) => {
        dispatchPointerEvent(event, 'pointerdown');
        onPointerDown?.(event);
      }}
      onPointerMoveCapture={(event) => {
        dispatchPointerEvent(event, 'pointermove');
        onPointerMove?.(event);
      }}
      onPointerUpCapture={(event) => {
        dispatchPointerEvent(event, 'pointerup');
        onPointerUp?.(event);
      }}
      onLostPointerCaptureCapture={(event) => {
        dispatchPointerEvent(event, 'lostpointercapture');
        onLostPointerCapture?.(event);
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        dispatchSemanticEvent('blur', event.target);
        onBlur?.(event);
      }}
      onDoubleClick={(event: MouseEvent<HTMLDivElement>) => {
        dispatchSemanticEvent('doubleclick', event.target);
        onDoubleClick?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dispatchSemanticEvent('escape', event.target);
        } else {
          const targetTool = viewerTargetTool(event.target);
          onInputEvent?.({
            key: event.key,
            shiftKey: event.shiftKey,
            ...(targetTool === undefined ? {} : { targetTool }),
            type: 'keydown',
          });
        }
        onKeyDown?.(event);
      }}
      role={a11y.role}
      tabIndex={a11y.tabIndex}
    >
      {children}
    </div>
  );
}
