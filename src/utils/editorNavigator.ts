import {
  getImageSpacePointAtViewportPoint,
  getTransformForImageSpacePoint,
  type ViewportPoint,
  type ViewportSnapshot,
  type ViewportTransform,
} from './editorViewportBounds';

export interface NavigatorViewportRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const getNavigatorViewportRect = (
  snapshot: ViewportSnapshot,
  transform: ViewportTransform,
): NavigatorViewportRect => {
  if (
    snapshot.containerWidth <= 0 ||
    snapshot.containerHeight <= 0 ||
    snapshot.renderSize.width <= 0 ||
    snapshot.renderSize.height <= 0
  ) {
    return { height: 1, width: 1, x: 0, y: 0 };
  }

  const topLeft = getImageSpacePointAtViewportPoint({ snapshot, transform, viewportPoint: { x: 0, y: 0 } });
  const bottomRight = getImageSpacePointAtViewportPoint({
    snapshot,
    transform,
    viewportPoint: { x: snapshot.containerWidth, y: snapshot.containerHeight },
  });
  const x = clamp01(topLeft.x);
  const y = clamp01(topLeft.y);
  const right = clamp01(bottomRight.x);
  const bottom = clamp01(bottomRight.y);

  return {
    height: Math.max(0, bottom - y),
    width: Math.max(0, right - x),
    x,
    y,
  };
};

export const getNavigatorPanTransform = ({
  imagePoint,
  snapshot,
  transform,
}: {
  imagePoint: ViewportPoint;
  snapshot: ViewportSnapshot;
  transform: ViewportTransform;
}): ViewportTransform =>
  getTransformForImageSpacePoint({
    focalPoint: { x: clamp01(imagePoint.x), y: clamp01(imagePoint.y) },
    scale: transform.scale,
    snapshot,
    viewportPoint: { x: snapshot.containerWidth / 2, y: snapshot.containerHeight / 2 },
  });
