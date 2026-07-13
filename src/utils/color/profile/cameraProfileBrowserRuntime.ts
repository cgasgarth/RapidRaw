import type { CameraProfileBrowserEntry } from '../../../schemas/color/cameraProfileBrowserSchemas';
import type { CameraProfileId } from '../../../schemas/color/profileToneSchemas';

export interface CameraProfileBrowserQuery {
  compatibleOnly: boolean;
  search: string;
}

const normalized = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^a-z0-9]/gi, '')
    .toLocaleLowerCase();

export const queryCameraProfiles = (
  entries: ReadonlyArray<CameraProfileBrowserEntry>,
  query: CameraProfileBrowserQuery,
) => {
  const search = normalized(query.search);
  return entries
    .filter((entry) => !query.compatibleOnly || entry.compatible)
    .filter(
      (entry) =>
        search.length === 0 ||
        normalized(entry.displayName).includes(search) ||
        (entry.cameraModel !== null && normalized(entry.cameraModel).includes(search)),
    )
    .toSorted((left, right) => {
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      const recent = (right.lastUsedEpochMs ?? -1) - (left.lastUsedEpochMs ?? -1);
      return recent || left.displayName.localeCompare(right.displayName);
    });
};

export const groupCameraProfiles = (entries: ReadonlyArray<CameraProfileBrowserEntry>) => {
  const groups = new Map<CameraProfileBrowserEntry['source'], Array<CameraProfileBrowserEntry>>();
  for (const entry of entries) groups.set(entry.source, [...(groups.get(entry.source) ?? []), entry]);
  return groups;
};

export const applyCameraProfileIdentity = <T extends { cameraProfile: CameraProfileId }>(
  adjustments: T,
  cameraProfile: CameraProfileId,
): T => ({ ...adjustments, cameraProfile });
