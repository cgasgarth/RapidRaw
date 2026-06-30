import type { RenderSize } from '../hooks/viewport/useImageRenderSize';

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

export interface ReconcileViewportTransformInput {
  contextChanged: boolean;
  current: ViewportSnapshot;
  previous: ViewportSnapshot | null;
  transform: ViewportTransform;
}

export interface ViewportTransform {
  positionX: number;
  positionY: number;
  scale: number;
}

export const FIT_TRANSFORM: ViewportTransform = { scale: 1, positionX: 0, positionY: 0 };

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

export const reconcileViewportTransform = ({
  contextChanged,
  current,
  previous,
  transform,
}: ReconcileViewportTransformInput): ViewportTransform => {
  if (!isValidSnapshot(current)) return FIT_TRANSFORM;
  if (contextChanged || !isValidSnapshot(previous)) return FIT_TRANSFORM;

  const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : FIT_TRANSFORM.scale;
  if (Math.abs(scale - FIT_TRANSFORM.scale) <= 0.01) return FIT_TRANSFORM;

  const previousCenterX =
    (previous.containerWidth / 2 - transform.positionX - previous.renderSize.offsetX * scale) /
    (previous.renderSize.width * scale);
  const previousCenterY =
    (previous.containerHeight / 2 - transform.positionY - previous.renderSize.offsetY * scale) /
    (previous.renderSize.height * scale);

  const nextTransform = {
    scale,
    positionX:
      current.containerWidth / 2 -
      current.renderSize.offsetX * scale -
      previousCenterX * current.renderSize.width * scale,
    positionY:
      current.containerHeight / 2 -
      current.renderSize.offsetY * scale -
      previousCenterY * current.renderSize.height * scale,
  };

  return clampTransformToSnapshot(nextTransform, current);
};
