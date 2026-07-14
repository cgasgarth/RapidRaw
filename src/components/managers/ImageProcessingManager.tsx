import type { RefObject } from 'react';
import { useImageProcessing } from '../../hooks/editor/useImageProcessing';
import type { Adjustments } from '../../utils/adjustments';

interface Props {
  transformWrapperRef: RefObject<TransformController | null>;
  prevAdjustmentsRef: RefObject<PreviousAdjustments | null>;
  currentResRef: RefObject<number>;
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

interface PreviousAdjustments {
  adjustments: Adjustments;
  path: string;
}

export default function ImageProcessingManager(props: Props) {
  useImageProcessing(props.transformWrapperRef, props.prevAdjustmentsRef, {
    currentResRef: props.currentResRef,
  });

  return null;
}
