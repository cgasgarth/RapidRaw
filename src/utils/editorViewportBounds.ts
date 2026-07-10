import type { RenderSize } from '../hooks/viewport/useImageRenderSize';
import type { EditorZoomMode } from './editorZoom';

export interface TransformBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface ViewportBoundsInput {
  containerHeight: number;
  containerWidth: number;
  renderSize: RenderSize;
  scale: number;
}

export interface ViewportSnapshot {
  containerHeight: number;
  containerWidth: number;
  renderSize: RenderSize;
}

export type ViewportFocalPointSource = 'center' | 'navigator' | 'pointer';

export interface ViewportFocalPoint {
  source: ViewportFocalPointSource;
  viewportX: number;
  viewportY: number;
  x: number;
  y: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ReconcileViewportTransformInput {
  contextChanged: boolean;
  current: ViewportSnapshot;
  focalPoint?: ViewportPoint | null;
  mode?: EditorZoomMode;
  previous: ViewportSnapshot | null;
  targetScale?: number;
  transform: ViewportTransform;
  viewportAnchor?: ViewportPoint | null;
}

export interface ViewportTransform {
  positionX: number;
  positionY: number;
  scale: number;
}

export const FIT_TRANSFORM: ViewportTransform = { scale: 1, positionX: 0, positionY: 0 };

const centerOfSnapshot = (snapshot: ViewportSnapshot): ViewportPoint => ({
  x: snapshot.containerWidth / 2,
  y: snapshot.containerHeight / 2,
});

const centeredAxisBounds = (
  containerSize: number,
  renderOffset: number,
  renderLength: number,
  scale: number,
): { max: number; min: number } => {
  const scaledLength = renderLength * scale;
  const scaledOffset = renderOffset * scale;

  if (scaledLength <= containerSize) {
    const centeredPosition = (containerSize - scaledLength) / 2 - scaledOffset;
    return { min: centeredPosition, max: centeredPosition };
  }

  return {
    min: containerSize - (renderOffset + renderLength) * scale,
    max: -scaledOffset,
  };
};

export const getImageTransformBounds = ({
  containerHeight,
  containerWidth,
  renderSize,
  scale,
}: ViewportBoundsInput): TransformBounds => {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    renderSize.width <= 0 ||
    renderSize.height <= 0 ||
    !Number.isFinite(scale) ||
    scale <= 0
  ) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  const horizontal = centeredAxisBounds(containerWidth, renderSize.offsetX, renderSize.width, scale);
  const vertical = centeredAxisBounds(containerHeight, renderSize.offsetY, renderSize.height, scale);

  return { minX: horizontal.min, maxX: horizontal.max, minY: vertical.min, maxY: vertical.max };
};

const isValidSnapshot = (snapshot: ViewportSnapshot | null): snapshot is ViewportSnapshot =>
  snapshot !== null &&
  snapshot.containerWidth > 0 &&
  snapshot.containerHeight > 0 &&
  snapshot.renderSize.width > 0 &&
  snapshot.renderSize.height > 0;

const clampTransformToSnapshot = (transform: ViewportTransform, snapshot: ViewportSnapshot): ViewportTransform => {
  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : FIT_TRANSFORM.scale;
  const bounds = getImageTransformBounds({
    containerHeight: snapshot.containerHeight,
    containerWidth: snapshot.containerWidth,
    renderSize: snapshot.renderSize,
    scale,
  });
  const safeX = Number.isFinite(transform.positionX) ? transform.positionX : FIT_TRANSFORM.positionX;
  const safeY = Number.isFinite(transform.positionY) ? transform.positionY : FIT_TRANSFORM.positionY;

  return {
    scale,
    positionX: Math.min(Math.max(safeX, bounds.minX), bounds.maxX),
    positionY: Math.min(Math.max(safeY, bounds.minY), bounds.maxY),
  };
};

const safeTransformScale = (scale: number): number =>
  Number.isFinite(scale) && scale > 0 ? scale : FIT_TRANSFORM.scale;

export const getImageSpacePointAtViewportPoint = ({
  snapshot,
  transform,
  viewportPoint,
}: {
  snapshot: ViewportSnapshot;
  transform: ViewportTransform;
  viewportPoint: ViewportPoint;
}): ViewportPoint => {
  const scale = safeTransformScale(transform.scale);
  if (!isValidSnapshot(snapshot)) return { x: 0.5, y: 0.5 };

  return {
    x:
      (viewportPoint.x - transform.positionX - snapshot.renderSize.offsetX * scale) /
      (snapshot.renderSize.width * scale),
    y:
      (viewportPoint.y - transform.positionY - snapshot.renderSize.offsetY * scale) /
      (snapshot.renderSize.height * scale),
  };
};

export const getTransformForImageSpacePoint = ({
  focalPoint,
  scale,
  snapshot,
  viewportPoint,
}: {
  focalPoint: ViewportPoint;
  scale: number;
  snapshot: ViewportSnapshot;
  viewportPoint: ViewportPoint;
}): ViewportTransform => {
  const safeScale = safeTransformScale(scale);
  return {
    positionX:
      viewportPoint.x - snapshot.renderSize.offsetX * safeScale - focalPoint.x * snapshot.renderSize.width * safeScale,
    positionY:
      viewportPoint.y - snapshot.renderSize.offsetY * safeScale - focalPoint.y * snapshot.renderSize.height * safeScale,
    scale: safeScale,
  };
};

export const reconcileViewportTransform = ({
  contextChanged,
  current,
  focalPoint,
  mode,
  previous,
  targetScale,
  transform,
  viewportAnchor,
}: ReconcileViewportTransformInput): ViewportTransform => {
  if (!isValidSnapshot(current)) return FIT_TRANSFORM;
  if (mode?.kind === 'fit') return FIT_TRANSFORM;

  const scale = safeTransformScale(targetScale ?? transform.scale);
  if (contextChanged || !isValidSnapshot(previous)) {
    if (!mode) return FIT_TRANSFORM;
    return clampTransformToSnapshot(
      getTransformForImageSpacePoint({
        focalPoint: { x: 0.5, y: 0.5 },
        scale,
        snapshot: current,
        viewportPoint: centerOfSnapshot(current),
      }),
      current,
    );
  }

  if (Math.abs(scale - FIT_TRANSFORM.scale) <= 0.01) return FIT_TRANSFORM;

  const previousAnchor = focalPoint ? (viewportAnchor ?? centerOfSnapshot(previous)) : centerOfSnapshot(previous);
  const imageSpacePoint =
    focalPoint ??
    getImageSpacePointAtViewportPoint({
      snapshot: previous,
      transform,
      viewportPoint: previousAnchor,
    });
  const nextTransform = getTransformForImageSpacePoint({
    focalPoint: imageSpacePoint,
    scale,
    snapshot: current,
    viewportPoint: viewportAnchor ?? centerOfSnapshot(current),
  });

  return clampTransformToSnapshot(nextTransform, current);
};
