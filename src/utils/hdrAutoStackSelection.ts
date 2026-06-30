import type { ImageFile } from '../components/ui/AppProperties';
import type { HdrBracketPreflightSourceMetadata } from './hdrBracketPreflight';
import { buildLibraryAutoStacks } from './libraryAutoStacks';

export const findHdrAutoStackPaths = (imageList: ImageFile[], path: string): string[] | null => {
  const findInOrder = (images: ImageFile[]) =>
    buildLibraryAutoStacks(images).find((stack) => stack.kind === 'bracket' && stack.paths.includes(path))?.paths ??
    null;

  return (
    findInOrder(imageList) ?? findInOrder([...imageList].sort((left, right) => left.path.localeCompare(right.path)))
  );
};

export const resolveHdrLaunchSourcePaths = (imageList: ImageFile[], selectedPaths: string[]): string[] => {
  if (selectedPaths.length !== 1) return selectedPaths;

  const selectedPath = selectedPaths[0];
  if (selectedPath === undefined) return selectedPaths;

  return findHdrAutoStackPaths(imageList, selectedPath) ?? selectedPaths;
};

export const buildHdrLaunchSourceMetadata = (
  imageList: ImageFile[],
  selectedPaths: string[],
): HdrBracketPreflightSourceMetadata[] => {
  const imagesByPath = new Map(imageList.map((image) => [image.path, image]));

  return resolveHdrLaunchSourcePaths(imageList, selectedPaths).map((path) => ({
    exif: imagesByPath.get(path)?.exif ?? null,
    path,
  }));
};
