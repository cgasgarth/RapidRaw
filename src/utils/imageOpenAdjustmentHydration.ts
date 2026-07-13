import { isNullAdjustmentSnapshot, parseLoadedMetadata } from '../schemas/imageLoaderSchemas';
import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from './adjustments';
import { hydrateLayerStackMasksFromMetadata } from './layers/layerStackSidecarAdjustments';

export const hydrateImageOpenAdjustments = (metadata: unknown, imagePath: string): Adjustments => {
  const loadedMetadata = parseLoadedMetadata(metadata);
  const adjustments =
    loadedMetadata.adjustments && !isNullAdjustmentSnapshot(loadedMetadata.adjustments)
      ? normalizeLoadedAdjustments(loadedMetadata.adjustments)
      : { ...INITIAL_ADJUSTMENTS };
  return hydrateLayerStackMasksFromMetadata(adjustments, loadedMetadata, imagePath);
};
