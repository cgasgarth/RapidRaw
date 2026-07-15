import { type ComponentProps, memo } from 'react';
import EditorPersistenceManager from '../managers/EditorPersistenceManager';
import ImageLoaderManager from '../managers/ImageLoaderManager';
import ImageProcessingManager from '../managers/ImageProcessingManager';

interface AppServicesProps {
  persistence: ComponentProps<typeof EditorPersistenceManager>;
}

function AppServicesComponent({ persistence }: AppServicesProps) {
  return (
    <>
      <ImageProcessingManager />
      <EditorPersistenceManager {...persistence} />
      <ImageLoaderManager />
    </>
  );
}

export const AppServices = memo(
  AppServicesComponent,
  (previous, next) => previous.persistence.prevAdjustmentsRef === next.persistence.prevAdjustmentsRef,
);
