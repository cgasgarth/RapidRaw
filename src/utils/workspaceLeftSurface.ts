export type WorkspaceLeftSurface = 'editor' | 'library' | null;

interface WorkspaceLeftSurfaceInput {
  hasRoots: boolean;
  hasSelectedImage: boolean;
  isAndroid: boolean;
  isCompactPortrait: boolean;
}

export const getWorkspaceLeftSurface = ({
  hasRoots,
  hasSelectedImage,
  isAndroid,
  isCompactPortrait,
}: WorkspaceLeftSurfaceInput): WorkspaceLeftSurface => {
  if (isAndroid) return null;
  if (hasSelectedImage) return isCompactPortrait ? null : 'editor';
  return hasRoots ? 'library' : null;
};
