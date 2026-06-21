export function getDisplayFileName(filePath: string): string {
  const trimmedPath = filePath.trim();
  const segments = trimmedPath.split(/[\\/]+/).filter(Boolean);

  return segments.at(-1) ?? trimmedPath;
}
