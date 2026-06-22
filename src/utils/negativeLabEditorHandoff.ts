export interface NegativeConversionEditorHandoff {
  openInEditor: boolean;
}

interface HandleNegativeConversionEditorHandoffInput {
  handleImageSelect: (path: string) => void;
  handoff: NegativeConversionEditorHandoff;
  onRefreshError?: (error: unknown) => void;
  refreshImageList: () => Promise<void>;
  savedPaths: string[];
}

export async function handleNegativeConversionEditorHandoff({
  handleImageSelect,
  handoff,
  onRefreshError,
  refreshImageList,
  savedPaths,
}: HandleNegativeConversionEditorHandoffInput): Promise<void> {
  const firstSavedPath = savedPaths[0];

  try {
    await refreshImageList();
  } catch (error) {
    onRefreshError?.(error);
  }

  if (handoff.openInEditor && firstSavedPath) {
    handleImageSelect(firstSavedPath);
  }
}
