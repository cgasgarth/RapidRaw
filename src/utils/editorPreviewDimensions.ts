import type { SelectedImage } from '../components/ui/AppProperties';
import type { ImageDimensions } from '../hooks/viewport/useImageRenderSize';

const PENDING_THUMBNAIL_FRAME: ImageDimensions = { width: 3, height: 2 };

export const getEditorPreviewDimensions = (
  selectedImage: SelectedImage | null,
  orientationSteps: number,
): ImageDimensions | null => {
  if (!selectedImage) return null;

  const hasLoadedDimensions = selectedImage.width > 0 && selectedImage.height > 0;
  if (!hasLoadedDimensions && !selectedImage.thumbnailUrl) return null;

  const dimensions = hasLoadedDimensions
    ? { width: selectedImage.width, height: selectedImage.height }
    : PENDING_THUMBNAIL_FRAME;

  const isSwapped = orientationSteps === 1 || orientationSteps === 3;
  return isSwapped ? { width: dimensions.height, height: dimensions.width } : dimensions;
};
