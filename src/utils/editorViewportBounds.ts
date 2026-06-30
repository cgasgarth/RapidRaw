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
