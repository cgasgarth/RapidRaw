import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { parseLoadedMetadata } from '../schemas/imageLoaderSchemas';
import { createDefaultEditDocumentV2 } from './editDocumentV2';

export const hydrateImageOpenEditDocumentV2 = (metadata: unknown): EditDocumentV2 =>
  parseLoadedMetadata(metadata).editDocumentV2 ?? createDefaultEditDocumentV2();
