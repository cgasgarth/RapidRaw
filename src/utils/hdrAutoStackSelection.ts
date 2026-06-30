import { buildLibraryAutoStacks } from './libraryAutoStacks';

import type { ImageFile } from '../components/ui/AppProperties';

export const findHdrAutoStackPaths = (imageList: ImageFile[], path: string): string[] | null => {
  const findInOrder = (images: ImageFile[]) =>
    buildLibraryAutoStacks(images).find((stack) => stack.kind === 'bracket' && stack.paths.includes(path))?.paths ??
    null;

  return (
    findInOrder(imageList) ?? findInOrder([...imageList].sort((left, right) => left.path.localeCompare(right.path)))
  );
};
