import type { RefObject } from 'react';
import { useImageProcessing } from '../../hooks/useImageProcessing';
import type { TransformWrapperHandle } from '../panel/Editor';
import type { Adjustments } from '../../utils/adjustments';

export interface PrevAdjustmentsState {
  path: string;
  adjustments: Adjustments;
}

interface Props {
  transformWrapperRef: RefObject<TransformWrapperHandle | null>;
  prevAdjustmentsRef: RefObject<PrevAdjustmentsState | null>;
  previewJobIdRef: React.RefObject<number>;
  latestRenderedJobIdRef: React.RefObject<number>;
  currentResRef: React.RefObject<number>;
}

export default function ImageProcessingManager(props: Props) {
  useImageProcessing(props.transformWrapperRef, props.prevAdjustmentsRef, {
    previewJobIdRef: props.previewJobIdRef,
    latestRenderedJobIdRef: props.latestRenderedJobIdRef,
    currentResRef: props.currentResRef,
  });

  return null;
}
