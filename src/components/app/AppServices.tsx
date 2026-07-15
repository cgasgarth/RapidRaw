import { memo } from 'react';
import EditorPersistenceManager from '../managers/EditorPersistenceManager';
import ImageLoaderManager from '../managers/ImageLoaderManager';
import ImageProcessingManager from '../managers/ImageProcessingManager';

function AppServicesComponent() {
  return (
    <>
      <ImageProcessingManager />
      <EditorPersistenceManager />
      <ImageLoaderManager />
    </>
  );
}

export const AppServices = memo(AppServicesComponent);
