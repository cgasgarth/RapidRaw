interface EditorPreviewSourceInput {
  finalPreviewUrl: string | null;
  isReady: boolean;
  provisionalPreviewUrl?: string | null;
  thumbnailUrl: string;
}

export interface RetainedEditorPreviewSource {
  sourceIdentity: string;
  url: string;
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

/** Keeps the last same-image CPU source during a transient render invalidation. */
export function retainEditorPreviewSource({
  currentSource,
  retainedSource,
  sourceIdentity,
}: {
  currentSource: string | null;
  retainedSource: RetainedEditorPreviewSource | null;
  sourceIdentity: string;
}): RetainedEditorPreviewSource | null {
  if (currentSource !== null && currentSource.length > 0) return { sourceIdentity, url: currentSource };
  return retainedSource?.sourceIdentity === sourceIdentity ? retainedSource : null;
}
