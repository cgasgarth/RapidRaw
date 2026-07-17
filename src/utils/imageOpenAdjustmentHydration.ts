import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { parseLoadedMetadata } from '../schemas/imageLoaderSchemas';
import { createDefaultEditDocumentV2 } from './editDocumentV2';
import { hydrateLayerStackMasksInEditDocument } from './layers/layerStackSidecarAdjustments';

export const hydrateImageOpenEditDocumentV2 = (metadata: unknown, imagePath?: string): EditDocumentV2 => {
  const loadedMetadata = parseLoadedMetadata(metadata);
  const document = loadedMetadata.editDocumentV2 ?? createDefaultEditDocumentV2();
  return imagePath === undefined ? document : hydrateLayerStackMasksInEditDocument(document, loadedMetadata, imagePath);
};
