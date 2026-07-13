interface EditorPreviewSourceInput {
  finalPreviewUrl: string | null;
  isReady: boolean;
  provisionalPreviewUrl?: string | null;
  thumbnailUrl: string;
}

export function resolveEditorPreviewSource({
  finalPreviewUrl,
  isReady,
  provisionalPreviewUrl = null,
  thumbnailUrl,
}: EditorPreviewSourceInput): string {
  if (isReady && finalPreviewUrl) return finalPreviewUrl;
  if (!isReady && provisionalPreviewUrl) return provisionalPreviewUrl;
  return thumbnailUrl;
}
