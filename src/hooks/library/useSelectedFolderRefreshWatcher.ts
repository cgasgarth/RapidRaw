import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LibraryViewMode } from '../../components/ui/AppProperties';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Invokes } from '../../tauri/commands';
import { type FolderRefreshSnapshot, hasFolderRefreshSnapshotChanged } from './folderRefreshSnapshot';

interface UseSelectedFolderRefreshWatcherProps {
  libraryViewMode: LibraryViewMode;
  refreshAllFolderTrees: () => Promise<void> | void;
  refreshImageList: () => Promise<void> | void;
}

const FOLDER_REFRESH_POLL_INTERVAL_MS = 1500;

export function useSelectedFolderRefreshWatcher({
  libraryViewMode,
  refreshAllFolderTrees,
  refreshImageList,
}: UseSelectedFolderRefreshWatcherProps) {
  const { currentFolderPath } = useLibraryStore(
    useShallow((state) => ({
      currentFolderPath: state.currentFolderPath,
    })),
  );

  const refreshRefs = useRef({ refreshAllFolderTrees, refreshImageList });
  const snapshotRef = useRef<FolderRefreshSnapshot | null>(null);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    refreshRefs.current = { refreshAllFolderTrees, refreshImageList };
  }, [refreshAllFolderTrees, refreshImageList]);

  useEffect(() => {
    snapshotRef.current = null;
    isRefreshingRef.current = false;

    if (!currentFolderPath?.trim() || currentFolderPath.startsWith('Album: ')) return;

    let isActive = true;
    const watchedPath = currentFolderPath;
    const watchedRecursive = libraryViewMode === LibraryViewMode.Recursive;

    const refreshIfNeeded = async () => {
      if (!isActive || isRefreshingRef.current) return;

      try {
        const snapshot = await invoke<FolderRefreshSnapshot>(Invokes.GetFolderRefreshSnapshot, {
          path: watchedPath,
          recursive: watchedRecursive,
        });

        if (!isActive) return;
        if (useLibraryStore.getState().currentFolderPath !== watchedPath) return;

        if (snapshotRef.current === null) {
          snapshotRef.current = snapshot;
          return;
        }

        if (!hasFolderRefreshSnapshotChanged(snapshotRef.current, snapshot)) {
          return;
        }

        snapshotRef.current = snapshot;
        isRefreshingRef.current = true;
        try {
          await refreshRefs.current.refreshImageList();
          await refreshRefs.current.refreshAllFolderTrees();
        } finally {
          isRefreshingRef.current = false;
        }
      } catch (err) {
        console.error('Failed to watch selected folder for changes:', err);
      }
    };

    void refreshIfNeeded();
    const intervalId = window.setInterval(() => {
      void refreshIfNeeded();
    }, FOLDER_REFRESH_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [currentFolderPath, libraryViewMode]);
}
