import { type EditorOverlayGeometry, overlayPoint } from '../../../utils/editorOverlayGeometry';
import type { ViewerRetouchPoint } from './viewerRetouchHandlesController';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const viewerRetouchViewToNormalized = (
  geometry: EditorOverlayGeometry,
  point: ViewerRetouchPoint,
): ViewerRetouchPoint => {
  const normalized = geometry.orientedToNormalized(
    geometry.cropToOriented(geometry.viewToCrop(overlayPoint<'view-css-pixels'>(point.x, point.y))),
  );
  return { x: clamp01(normalized.x), y: clamp01(normalized.y) };
};

export const viewerRetouchNormalizedToView = (
  geometry: EditorOverlayGeometry,
  point: ViewerRetouchPoint,
): ViewerRetouchPoint =>
  geometry.cropToView(
    geometry.orientedToCrop(
      geometry.normalizedOrientedToOriented(overlayPoint<'normalized-oriented'>(point.x, point.y)),
    ),
  );

export const resolveViewerRetouchFootprint = ({
  featherRadiusPx,
  handleRadius,
  radiusPx,
  rotationDegrees,
  scale,
  sourcePoint,
  viewRadiusFromCrop,
}: {
  readonly featherRadiusPx: number;
  readonly handleRadius: number;
  readonly radiusPx: number;
  readonly rotationDegrees: number;
  readonly scale: number;
  readonly sourcePoint: ViewerRetouchPoint;
  readonly viewRadiusFromCrop: (radius: number) => number;
}) => {
  const radius = viewRadiusFromCrop(radiusPx);
  const featherRadius = viewRadiusFromCrop(Math.max(0, radiusPx + featherRadiusPx));
  const sourceFootprintRadius = radius / Math.max(0.1, scale);
  const axisLength = Math.max(handleRadius * 1.5, sourceFootprintRadius);
  const radians = (-rotationDegrees * Math.PI) / 180;
  return {
    axisEnd: {
      x: sourcePoint.x + axisLength * Math.cos(radians),
      y: sourcePoint.y + axisLength * Math.sin(radians),
    },
    featherRadius,
    radius,
    sourceFootprintRadius,
  };
};
