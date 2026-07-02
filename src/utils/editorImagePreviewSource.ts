interface EditorPreviewSourceInput {
  finalPreviewUrl: string | null;
  isReady: boolean;
  thumbnailUrl: string;
}

export function resolveEditorPreviewSource({
  finalPreviewUrl,
  isReady,
  thumbnailUrl,
}: EditorPreviewSourceInput): string {
  if (isReady && finalPreviewUrl) return finalPreviewUrl;
  return thumbnailUrl;
}
