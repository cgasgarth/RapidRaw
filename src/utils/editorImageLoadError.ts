import type { SelectedImage } from '../components/ui/AppProperties';

export function isSelectedImageLoadErrorCurrent(
  currentSelectedImage: SelectedImage | null,
  failedImagePath: string,
): boolean {
  return currentSelectedImage?.path === failedImagePath;
}
