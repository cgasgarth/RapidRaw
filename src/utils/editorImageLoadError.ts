import type { SelectedImage } from '../components/ui/AppProperties';

export function shouldClearSelectedImageAfterLoadError(
  currentSelectedImage: SelectedImage | null,
  failedImagePath: string,
): boolean {
  return currentSelectedImage?.path === failedImagePath && !currentSelectedImage.isReady;
}
