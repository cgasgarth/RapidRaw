import type { RefObject } from 'react';
import { useImageProcessing } from '../../hooks/editor/useImageProcessing';

interface Props {
  transformWrapperRef: RefObject<TransformController | null>;
}

interface TransformController {
  instance?: {
    transformState?: {
      positionX: number;
      positionY: number;
      scale: number;
    } | null;
  };
  resetTransform(time?: number): void;
  setTransform(x: number, y: number, scale: number, time?: number): void;
  zoomIn(factor: number, time?: number): void;
  zoomOut(factor: number, time?: number): void;
}

export default function ImageProcessingManager(props: Props) {
  useImageProcessing(props.transformWrapperRef);

  return null;
}
