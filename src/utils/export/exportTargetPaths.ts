export function resolveExportTargetPaths({
  isLibraryContext,
  multiSelectedPaths,
  selectedImagePath,
}: {
  isLibraryContext: boolean;
  multiSelectedPaths: string[];
  selectedImagePath: string | null | undefined;
}): string[] {
  if (isLibraryContext) return multiSelectedPaths;

  return selectedImagePath ? [selectedImagePath] : [];
}
