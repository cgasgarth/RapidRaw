import type { HTMLAttributes, ReactNode } from 'react';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { EditorPresentationDescriptor } from '../../../utils/editorPresentationDescriptor';

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

export function ViewerSurface({ children, geometry, presentation, ...props }: ViewerSurfaceProps) {
  return (
    <div {...props} {...viewerSurfaceDataAttributes(presentation, geometry)}>
      {children}
    </div>
  );
}
