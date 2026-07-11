export function resolveResetTargetPaths(
  explicitPaths: string[] | undefined,
  activeEditorPath: string | undefined,
  multiSelectedPaths: string[],
  libraryActivePath: string | undefined,
): string[] {
  if (explicitPaths?.length) return explicitPaths;
  if (activeEditorPath) return [activeEditorPath];
  if (multiSelectedPaths.length) return multiSelectedPaths;
  return libraryActivePath ? [libraryActivePath] : [];
}
