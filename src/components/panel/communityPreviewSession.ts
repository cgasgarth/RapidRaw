import type { ImageFile } from '../ui/AppProperties';

export interface CommunityPreviewSessionDefinition {
  id: string;
  localPaths: string[];
}

const hash = (value: string): number => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

export const chooseCommunityPreviewPaths = (paths: readonly string[], sessionId: string): string[] => {
  const count = paths.length === 1 ? 1 : paths.length <= 3 ? Math.min(paths.length, 2) : 4;
  return [...paths]
    .sort((left, right) => {
      const scoreDifference = hash(`${sessionId}\0${left}`) - hash(`${sessionId}\0${right}`);
      return scoreDifference === 0 ? left.localeCompare(right) : scoreDifference;
    })
    .slice(0, count);
};

export const createCommunityPreviewSession = (
  currentFolderPath: string | null,
  imageList: readonly ImageFile[],
): CommunityPreviewSessionDefinition => {
  const identities = imageList.map(({ path }) => path).sort((left, right) => left.localeCompare(right));
  const id = JSON.stringify([currentFolderPath, identities]);
  return {
    id,
    localPaths: currentFolderPath ? chooseCommunityPreviewPaths(identities, id) : [],
  };
};

export const revokeCommunityPreviewUrls = (previews: Readonly<Record<string, string | null>>): void => {
  for (const url of Object.values(previews)) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }
};
