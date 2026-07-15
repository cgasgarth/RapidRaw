import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import { isNullAdjustmentSnapshot, parseLoadedMetadata } from '../schemas/imageLoaderSchemas';
import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from './adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from './editDocumentV2';
import { hydrateLayerStackMasksFromMetadata } from './layers/layerStackSidecarAdjustments';

export const hydrateImageOpenAdjustments = (metadata: unknown, imagePath: string): Adjustments => {
  const loadedMetadata = parseLoadedMetadata(metadata);
  const adjustments =
    loadedMetadata.adjustments && !isNullAdjustmentSnapshot(loadedMetadata.adjustments)
      ? normalizeLoadedAdjustments(loadedMetadata.adjustments)
      : { ...INITIAL_ADJUSTMENTS };
  return hydrateLayerStackMasksFromMetadata(adjustments, loadedMetadata, imagePath);
};

export const hydrateImageOpenEditDocumentV2 = (metadata: unknown, adjustments: Adjustments): EditDocumentV2 =>
  parseLoadedMetadata(metadata).editDocumentV2 ?? legacyAdjustmentsToEditDocumentV2(adjustments);
