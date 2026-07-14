import { type EditorOverlayGeometry, overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { ViewerFocusRetouchOverlayDescriptor } from './viewerFocusRetouchInteractionController';

export const ViewerFocusRetouchOverlay = ({
  descriptors,
  geometry,
}: {
  readonly descriptors: readonly ViewerFocusRetouchOverlayDescriptor[];
  readonly geometry: EditorOverlayGeometry;
}) => {
  if (descriptors.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full pointer-events-none"
      data-testid="viewer-focus-retouch-overlay"
    >
      {descriptors.map((descriptor) => {
        const points = descriptor.pointsFixed1256Px
          .map((point) =>
            geometry.cropToView(geometry.orientedToCrop(overlayPoint<'oriented-pixels'>(point.x / 256, point.y / 256))),
          )
          .map((point) => `${String(point.x)},${String(point.y)}`)
          .join(' ');
        return (
          <polyline
            data-geometry-epoch={descriptor.geometryEpoch}
            fill="none"
            key={descriptor.id}
            points={points}
            stroke="rgba(14, 165, 233, 0.85)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
};
