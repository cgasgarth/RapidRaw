import { useLayoutEffect, useRef, useState } from 'react';
import {
  hasMaterialRenderSizeChange,
  RENDER_SIZE_SETTLE_MS,
  type RenderSize,
  RenderSizePublicationQueue,
} from '../../utils/renderSizePublication';

export type { RenderSize } from '../../utils/renderSizePublication';

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
  const publicationQueueRef = useRef<RenderSizePublicationQueue | null>(null);
  const publicationQueue = publicationQueueRef.current ?? new RenderSizePublicationQueue(DEFAULT_SIZE);
  publicationQueueRef.current = publicationQueue;
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;

  useLayoutEffect(() => {
    const container = containerRef.current;
    let publicationFrame: number | null = null;
    let publicationTimer: number | null = null;
    const flushPublication = () => {
      publicationFrame = null;
      publicationTimer = null;
      const next = publicationQueue.flush();
      if (next !== null) setRenderSize(next);
    };
    const schedulePublication = (next: RenderSize) => {
      publicationQueue.observe(next);
      if (hasMaterialRenderSizeChange(publicationQueue.snapshot(), next)) {
        if (publicationTimer !== null) window.clearTimeout(publicationTimer);
        publicationTimer = null;
        publicationFrame ??= window.requestAnimationFrame(flushPublication);
        return;
      }
      if (publicationFrame !== null) window.cancelAnimationFrame(publicationFrame);
      publicationFrame = null;
      if (publicationTimer !== null) window.clearTimeout(publicationTimer);
      publicationTimer = window.setTimeout(flushPublication, RENDER_SIZE_SETTLE_MS);
    };

    if (!container || !imgWidth || !imgHeight) {
      schedulePublication(DEFAULT_SIZE);
      return () => {
        if (publicationFrame !== null) window.cancelAnimationFrame(publicationFrame);
        if (publicationTimer !== null) window.clearTimeout(publicationTimer);
      };
    }

    const updateSize = () => {
      schedulePublication(
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
      if (publicationFrame !== null) window.cancelAnimationFrame(publicationFrame);
      if (publicationTimer !== null) window.clearTimeout(publicationTimer);
    };
  }, [containerRef, imgWidth, imgHeight, publicationQueue]);

  return renderSize;
};
