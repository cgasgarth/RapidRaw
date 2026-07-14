import { type ComponentProps, memo } from 'react';
import ImageLoaderManager from '../managers/ImageLoaderManager';
import ImageProcessingManager from '../managers/ImageProcessingManager';

interface AppServicesProps {
  imageProcessing: ComponentProps<typeof ImageProcessingManager>;
}

function AppServicesComponent({ imageProcessing }: AppServicesProps) {
  return (
    <>
      <ImageProcessingManager {...imageProcessing} />
      <ImageLoaderManager />
    </>
  );
}

export const AppServices = memo(
  AppServicesComponent,
  (previous, next) =>
    previous.imageProcessing.transformWrapperRef === next.imageProcessing.transformWrapperRef &&
    previous.imageProcessing.prevAdjustmentsRef === next.imageProcessing.prevAdjustmentsRef &&
    previous.imageProcessing.currentResRef === next.imageProcessing.currentResRef,
);
