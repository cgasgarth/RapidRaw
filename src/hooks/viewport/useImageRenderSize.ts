import { useLayoutEffect, useState } from 'react';

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
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderSize(DEFAULT_SIZE);
      return;
    }

    const updateSize = () => {
      setRenderSize(
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
