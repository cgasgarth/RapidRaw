import type { ImageFile } from '../../components/ui/AppProperties';

export interface SelectedFolderRefreshState {
  libraryActivePath: string | null;
  multiSelectedPaths: string[];
  selectionAnchorPath: string | null;
}

export interface SelectedFolderRefreshReconciliation {
  addedPaths: string[];
  changedPaths: string[];
  nextLibraryActivePath: string | null;
  nextMultiSelectedPaths: string[];
  nextSelectionAnchorPath: string | null;
  removedPaths: string[];
}

const getImageRevision = (image: ImageFile): string =>
  JSON.stringify({
    isEdited: image.is_edited,
    isVirtualCopy: image.is_virtual_copy,
    modified: image.modified,
    path: image.path,
    rating: image.rating,
    tags: image.tags ?? [],
  });

export const reconcileSelectedFolderRefresh = (
  previousImages: ReadonlyArray<ImageFile>,
  nextImages: ReadonlyArray<ImageFile>,
  state: SelectedFolderRefreshState,
): SelectedFolderRefreshReconciliation => {
  const previousByPath = new Map(previousImages.map((image) => [image.path, image]));
  const nextByPath = new Map(nextImages.map((image) => [image.path, image]));
  const nextPathSet = new Set(nextByPath.keys());

  const addedPaths = nextImages.filter((image) => !previousByPath.has(image.path)).map((image) => image.path);
  const removedPaths = previousImages.filter((image) => !nextByPath.has(image.path)).map((image) => image.path);
  const changedPaths = nextImages
    .filter((image) => {
      const previous = previousByPath.get(image.path);
      return previous !== undefined && getImageRevision(previous) !== getImageRevision(image);
    })
    .map((image) => image.path);

  const nextMultiSelectedPaths = state.multiSelectedPaths.filter((path) => nextPathSet.has(path));
  const nextLibraryActivePath =
    state.libraryActivePath !== null && nextPathSet.has(state.libraryActivePath) ? state.libraryActivePath : null;
  const nextSelectionAnchorPath =
    state.selectionAnchorPath !== null && nextPathSet.has(state.selectionAnchorPath) ? state.selectionAnchorPath : null;

  return {
    addedPaths,
    changedPaths,
    nextLibraryActivePath,
    nextMultiSelectedPaths,
    nextSelectionAnchorPath,
    removedPaths,
  };
};
