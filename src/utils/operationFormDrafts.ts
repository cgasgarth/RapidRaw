export const getLocalPathLeaf = (path: string): string => path.split(/[\\/]/u).at(-1) ?? '';

export const buildCreateFolderDraft = (): string => '';

export const buildRenameFolderDraft = (currentName: string): string => currentName;

export const buildRenameFileDraft = (paths: readonly string[]): string => {
  if (paths.length !== 1) return '{original_filename}';
  const fileName = getLocalPathLeaf(paths[0] ?? '');
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName || '{original_filename}';
};

export const buildPathSetIdentity = (paths: readonly string[]): string => JSON.stringify(paths);

export const buildOperationFormIdentity = (sourceIdentity: string, openEpoch: number): string =>
  `${String(openEpoch)}:${sourceIdentity}`;
