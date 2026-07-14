import { type ComponentProps, memo } from 'react';
import EditorPersistenceManager from '../managers/EditorPersistenceManager';
import ImageLoaderManager from '../managers/ImageLoaderManager';
import ImageProcessingManager from '../managers/ImageProcessingManager';

interface AppServicesProps {
  persistence: ComponentProps<typeof EditorPersistenceManager>;
  imageProcessing: ComponentProps<typeof ImageProcessingManager>;
}

function AppServicesComponent({ imageProcessing, persistence }: AppServicesProps) {
  return (
    <>
      <ImageProcessingManager {...imageProcessing} />
      <EditorPersistenceManager {...persistence} />
      <ImageLoaderManager />
    </>
  );
}

export const AppServices = memo(
  AppServicesComponent,
  (previous, next) =>
    previous.imageProcessing.transformWrapperRef === next.imageProcessing.transformWrapperRef &&
    previous.persistence.prevAdjustmentsRef === next.persistence.prevAdjustmentsRef,
);
