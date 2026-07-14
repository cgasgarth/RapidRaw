import type { FocusEvent, HTMLAttributes, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';
import {
  normalizeViewerSurfacePointerEvent,
  type ViewerSurfaceInputEvent,
  type ViewerSurfacePointerEvent,
} from './viewerInputRouter';

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
  onBlur,
  onKeyDown,
  presentation,
  role,
  tabIndex,
  ...props
}: ViewerSurfaceProps) {
  const dispatchPointerEvent = (event: PointerEvent<HTMLDivElement>, type: ViewerSurfacePointerEvent['type']): void => {
    onInputEvent?.(
      normalizeViewerSurfacePointerEvent({
        ...event,
        type,
      }),
    );
  };
  const dispatchSemanticEvent = (type: 'blur' | 'escape'): void => onInputEvent?.({ type });
  const a11y = viewerSurfaceA11yAttributes({ role, tabIndex });
  return (
    <div
      {...props}
      {...viewerSurfaceDataAttributes(presentation, geometry)}
      aria-roledescription={props['aria-roledescription'] ?? a11y['aria-roledescription']}
      onPointerCancel={(event) => {
        dispatchPointerEvent(event, 'pointercancel');
        onPointerCancel?.(event);
      }}
      onPointerDown={(event) => {
        dispatchPointerEvent(event, 'pointerdown');
        onPointerDown?.(event);
      }}
      onPointerMove={(event) => {
        dispatchPointerEvent(event, 'pointermove');
        onPointerMove?.(event);
      }}
      onPointerUp={(event) => {
        dispatchPointerEvent(event, 'pointerup');
        onPointerUp?.(event);
      }}
      onLostPointerCapture={(event) => {
        dispatchPointerEvent(event, 'lostpointercapture');
        onLostPointerCapture?.(event);
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        dispatchSemanticEvent('blur');
        onBlur?.(event);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dispatchSemanticEvent('escape');
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
