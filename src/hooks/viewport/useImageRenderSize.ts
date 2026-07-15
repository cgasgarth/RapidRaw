import { useLayoutEffect, useRef, useState } from 'react';

export interface ImageDimensions {
  height: number;
  width: number;
}

export interface BaseRenderSize extends ImageDimensions {
  containerHeight: number;
  containerWidth: number;
  offsetX: number;
  offsetY: number;
}

export interface RenderSize {
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
}

const DEFAULT_SIZE: RenderSize = { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };

const preserveEqualRenderSize = (current: RenderSize, next: RenderSize): RenderSize =>
  current.width === next.width &&
  current.height === next.height &&
  current.scale === next.scale &&
  current.offsetX === next.offsetX &&
  current.offsetY === next.offsetY
    ? current
    : next;

export const resolveImageRenderSize = (
  containerSize: ImageDimensions,
  imageDimensions: ImageDimensions | null,
): RenderSize => {
  if (
    !imageDimensions ||
    containerSize.width <= 0 ||
    containerSize.height <= 0 ||
    imageDimensions.width <= 0 ||
    imageDimensions.height <= 0
  ) {
    return DEFAULT_SIZE;
  }

  const imageAspectRatio = imageDimensions.width / imageDimensions.height;
  const containerAspectRatio = containerSize.width / containerSize.height;
  const width = imageAspectRatio > containerAspectRatio ? containerSize.width : containerSize.height * imageAspectRatio;
  const height =
    imageAspectRatio > containerAspectRatio ? containerSize.width / imageAspectRatio : containerSize.height;

  return {
    width,
    height,
    scale: width / imageDimensions.width,
    offsetX: (containerSize.width - width) / 2,
    offsetY: (containerSize.height - height) / 2,
  };
};

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement | null>,
  imageDimensions: ImageDimensions | null,
) => {
  const [renderSize, setRenderSize] = useState<RenderSize>(DEFAULT_SIZE);
  const renderSizeRef = useRef(renderSize);
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const commitRenderSize = (next: RenderSize) => {
      const resolved = preserveEqualRenderSize(renderSizeRef.current, next);
      if (resolved === renderSizeRef.current) return;
      renderSizeRef.current = resolved;
      setRenderSize(resolved);
    };

    if (!container || !imgWidth || !imgHeight) {
      commitRenderSize(DEFAULT_SIZE);
      return;
    }

    const updateSize = () => {
      commitRenderSize(
        resolveImageRenderSize(
          { height: container.clientHeight, width: container.clientWidth },
          { height: imgHeight, width: imgWidth },
        ),
      );
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, imgWidth, imgHeight]);

  return renderSize;
};
