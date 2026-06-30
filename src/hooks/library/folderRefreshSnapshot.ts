export interface FolderRefreshSnapshot {
  fingerprint: string;
  itemCount: number;
  path: string;
  recursive: boolean;
}

export const hasFolderRefreshSnapshotChanged = (
  previousSnapshot: FolderRefreshSnapshot | null,
  nextSnapshot: FolderRefreshSnapshot,
) => {
  if (previousSnapshot === null) return true;

  return (
    previousSnapshot.fingerprint !== nextSnapshot.fingerprint ||
    previousSnapshot.itemCount !== nextSnapshot.itemCount ||
    previousSnapshot.path !== nextSnapshot.path ||
    previousSnapshot.recursive !== nextSnapshot.recursive
  );
};
