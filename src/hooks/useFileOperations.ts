import { open } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { toast } from 'react-toastify';

import { Status } from '../components/ui/ExportImportProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { formatUnknownError } from '../utils/errorFormatting';
import {
  copyFilesWithSchema,
  createFolderWithSchema,
  deleteFilesFromDiskWithSchema,
  deleteFilesWithAssociatedWithSchema,
  importFilesWithSchema,
  moveFilesWithSchema,
  renameFilesWithSchema,
  renameFolderWithSchema,
  resolveAndroidContentUriNameWithSchema,
} from '../utils/fileOperationInvokes';

import type { AppSettings, ImageFile } from '../components/ui/AppProperties';

interface ImportSettings {
  dateFolderFormat: string;
  deleteAfterImport: boolean;
  filenameTemplate: string;
  organizeByDate: boolean;
}

export function useFileOperations(
  refreshImageList: () => Promise<void>,
  refreshAllFolderTrees: () => Promise<void>,
  handleImageSelect: (path: string) => void,
  handleBackToLibrary: () => void,
  sortedImageList: ImageFile[],
) {
  const getParentDir = (filePath: string): string => {
    const separator = filePath.includes('/') ? '/' : '\\';
    const lastSeparatorIndex = filePath.lastIndexOf(separator);
    if (lastSeparatorIndex === -1) return '';
    return filePath.substring(0, lastSeparatorIndex);
  };

  const executeDelete = useCallback(
    async (pathsToDelete: Array<string>, options = { includeAssociated: false }) => {
      if (pathsToDelete.length === 0) return;

      const { libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage } = useEditorStore.getState();

      const activePath = selectedImage ? selectedImage.path : libraryActivePath;
      let nextImagePath: string | null = null;

      if (activePath) {
        const physicalPath = activePath.split('?vc=')[0];
        const isActiveImageDeleted = pathsToDelete.some((p) => p === activePath || p === physicalPath);

        if (isActiveImageDeleted) {
          const currentIndex = sortedImageList.findIndex((img) => img.path === activePath);
          if (currentIndex !== -1) {
            const nextCandidate = sortedImageList
              .slice(currentIndex + 1)
              .find((img) => !pathsToDelete.includes(img.path));

            if (nextCandidate) {
              nextImagePath = nextCandidate.path;
            } else {
              const prevCandidate = sortedImageList
                .slice(0, currentIndex)
                .reverse()
                .find((img) => !pathsToDelete.includes(img.path));

              if (prevCandidate) {
                nextImagePath = prevCandidate.path;
              }
            }
          }
        } else {
          nextImagePath = activePath;
        }
      }

      try {
        const deleteFiles = options.includeAssociated
          ? deleteFilesWithAssociatedWithSchema
          : deleteFilesFromDiskWithSchema;
        await deleteFiles({ paths: pathsToDelete });
        await refreshImageList();

        if (selectedImage) {
          const physicalPath = selectedImage.path.split('?vc=')[0];
          const isFileBeingEditedDeleted = pathsToDelete.some((p) => p === selectedImage.path || p === physicalPath);

          if (isFileBeingEditedDeleted) {
            if (nextImagePath) {
              handleImageSelect(nextImagePath);
            } else {
              handleBackToLibrary();
            }
          }
        } else {
          if (nextImagePath) {
            setLibrary({ multiSelectedPaths: [nextImagePath], libraryActivePath: nextImagePath });
          } else {
            setLibrary({ multiSelectedPaths: [], libraryActivePath: null });
          }
        }
      } catch (err) {
        console.error('Failed to delete files:', err);
        toast.error(`Failed to delete files: ${formatUnknownError(err)}`);
      }
    },
    [refreshImageList, handleBackToLibrary, sortedImageList, handleImageSelect],
  );

  const handleDeleteSelected = useCallback(() => {
    const { multiSelectedPaths, imageList } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    const pathsToDelete = multiSelectedPaths;
    if (pathsToDelete.length === 0) {
      return;
    }

    const isSingle = pathsToDelete.length === 1;

    const firstPathToDelete = pathsToDelete[0];
    const selectionHasVirtualCopies =
      isSingle &&
      firstPathToDelete !== undefined &&
      !firstPathToDelete.includes('?vc=') &&
      imageList.some((image) => image.path.startsWith(`${firstPathToDelete}?vc=`));

    let modalTitle = 'Confirm Delete';
    let modalMessage: string;
    let confirmText: string;

    if (selectionHasVirtualCopies) {
      modalTitle = 'Delete Image and All Virtual Copies?';
      modalMessage = `Are you sure you want to permanently delete this image and all of its virtual copies? This action cannot be undone.`;
      confirmText = 'Delete All';
    } else if (isSingle) {
      modalMessage = `Are you sure you want to permanently delete this image? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    } else {
      modalMessage = `Are you sure you want to permanently delete these ${String(pathsToDelete.length)} images? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    }

    setUI({
      confirmModalState: {
        confirmText,
        confirmVariant: 'destructive',
        isOpen: true,
        message: modalMessage,
        onConfirm: () => {
          void executeDelete(pathsToDelete, { includeAssociated: false });
        },
        title: modalTitle,
      },
    });
  }, [executeDelete]);

  const handleCreateFolder = useCallback(
    async (folderName: string) => {
      const { folderActionTarget } = useUIStore.getState();

      if (folderName && folderName.trim() !== '' && folderActionTarget) {
        try {
          await createFolderWithSchema({ path: `${folderActionTarget}/${folderName.trim()}` });
          await refreshAllFolderTrees();
        } catch (err) {
          toast.error(`Failed to create folder: ${formatUnknownError(err)}`);
        }
      }
    },
    [refreshAllFolderTrees],
  );

  const handleRenameFolder = useCallback(
    async (newName: string) => {
      const { folderActionTarget } = useUIStore.getState();
      const { rootPaths, currentFolderPath, setLibrary } = useLibraryStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();

      if (newName && newName.trim() !== '' && folderActionTarget) {
        try {
          const oldPath = folderActionTarget;
          const trimmedNewName = newName.trim();

          await renameFolderWithSchema({ path: oldPath, newName: trimmedNewName });

          const parentDir = getParentDir(oldPath);
          const separator = oldPath.includes('/') ? '/' : '\\';
          const newPath = parentDir ? `${parentDir}${separator}${trimmedNewName}` : trimmedNewName;

          const newAppSettings = { ...appSettings } as AppSettings;
          let settingsChanged = false;

          if (rootPaths.includes(oldPath)) {
            const newRoots = rootPaths.map((r) => (r === oldPath ? newPath : r));
            setLibrary({ rootPaths: newRoots });
            newAppSettings.rootFolders = newRoots;
            settingsChanged = true;
          }
          if (currentFolderPath?.startsWith(oldPath)) {
            const newCurrentPath = currentFolderPath.replace(oldPath, newPath);
            setLibrary({ currentFolderPath: newCurrentPath });
          }

          const currentPins = appSettings?.pinnedFolders || [];
          if (currentPins.includes(oldPath)) {
            const newPins = currentPins
              .map((p: string) => (p === oldPath ? newPath : p))
              .sort((a: string, b: string) => a.localeCompare(b));
            newAppSettings.pinnedFolders = newPins;
            settingsChanged = true;
          }

          if (settingsChanged) {
            await handleSettingsChange(newAppSettings);
          }

          await refreshAllFolderTrees();
        } catch (err) {
          toast.error(`Failed to rename folder: ${formatUnknownError(err)}`);
        }
      }
    },
    [refreshAllFolderTrees],
  );

  const handleSaveRename = useCallback(
    async (nameTemplate: string) => {
      const { renameTargetPaths, setUI } = useUIStore.getState();
      const { selectedImage } = useEditorStore.getState();
      const { libraryActivePath, setLibrary } = useLibraryStore.getState();

      if (renameTargetPaths.length > 0 && nameTemplate) {
        try {
          const newPaths = await renameFilesWithSchema({
            nameTemplate,
            paths: renameTargetPaths,
          });

          await refreshImageList();

          if (selectedImage && renameTargetPaths.includes(selectedImage.path)) {
            const oldPathIndex = renameTargetPaths.indexOf(selectedImage.path);
            if (newPaths[oldPathIndex]) {
              handleImageSelect(newPaths[oldPathIndex]);
            } else {
              handleBackToLibrary();
            }
          }

          if (libraryActivePath && renameTargetPaths.includes(libraryActivePath)) {
            const oldPathIndex = renameTargetPaths.indexOf(libraryActivePath);
            if (newPaths[oldPathIndex]) {
              setLibrary({ libraryActivePath: newPaths[oldPathIndex] });
            } else {
              setLibrary({ libraryActivePath: null });
            }
          }

          setLibrary({ multiSelectedPaths: newPaths });
        } catch (err) {
          toast.error(`Failed to rename files: ${formatUnknownError(err)}`);
        }
      }
      setUI({ renameTargetPaths: [] });
    },
    [refreshImageList, handleImageSelect, handleBackToLibrary],
  );

  const handleRenameFiles = useCallback((paths: Array<string>) => {
    if (paths.length > 0) {
      useUIStore.getState().setUI({ renameTargetPaths: paths, isRenameFileModalOpen: true });
    }
  }, []);

  const startImportFiles = useCallback(
    async (sourcePaths: string[], destinationFolder: string, settings: ImportSettings) => {
      if (sourcePaths.length === 0 || !destinationFolder) return;

      try {
        await importFilesWithSchema({ destinationFolder, settings, sourcePaths });
      } catch (err) {
        console.error('Failed to start import:', err);
        useProcessStore
          .getState()
          .setImportState({ status: Status.Error, errorMessage: `Failed to start import: ${formatUnknownError(err)}` });
      }
    },
    [],
  );

  const handleStartImport = useCallback(
    async (settings: ImportSettings) => {
      const { importTargetFolder, importSourcePaths } = useUIStore.getState();
      if (!importTargetFolder) return;
      await startImportFiles(importSourcePaths, importTargetFolder, settings);
    },
    [startImportFiles],
  );

  const handleImportClick = useCallback(
    async (targetPath: string) => {
      const { supportedTypes, osPlatform } = useSettingsStore.getState();
      const { setUI } = useUIStore.getState();
      const isAndroid = osPlatform === 'android';

      try {
        const nonRaw = supportedTypes?.nonRaw || [];
        const raw = supportedTypes?.raw || [];

        const expandExtensions = (exts: string[]) => {
          return Array.from(new Set(exts.flatMap((ext) => [ext.toLowerCase(), ext.toUpperCase()])));
        };

        const processedNonRaw = expandExtensions(nonRaw);
        const processedRaw = expandExtensions(raw);
        const allImageExtensions = [...processedNonRaw, ...processedRaw];

        const typeFilters = isAndroid
          ? []
          : [
              { name: 'All Supported Images', extensions: allImageExtensions },
              { name: 'RAW Images', extensions: processedRaw },
              { name: 'Standard Images (JPEG, PNG, etc.)', extensions: processedNonRaw },
              { name: 'All Files', extensions: ['*'] },
            ];

        const selected = await open({
          filters: typeFilters,
          multiple: true,
          title: 'Select files to import',
        });

        if (Array.isArray(selected) && selected.length > 0) {
          const invalidExtensions = new Set<string>();
          const allowedExtensions = new Set(allImageExtensions.map((e) => e.toLowerCase()));

          const resolvedFiles = await Promise.all(
            selected.map(async (path) => {
              if (isAndroid) {
                try {
                  return await resolveAndroidContentUriNameWithSchema({ uriStr: path });
                } catch (e) {
                  console.error('Failed to resolve URI:', e);
                  return path;
                }
              }
              return path;
            }),
          );

          const validFiles = selected.filter((originalPath, index) => {
            const resolvedName = resolvedFiles[index];
            if (!resolvedName) return false;
            const ext = resolvedName.split('.').pop()?.toLowerCase() || 'unknown';

            if (!allowedExtensions.has(ext)) {
              invalidExtensions.add(`.${ext}`);
              return false;
            }
            return true;
          });

          if (invalidExtensions.size > 0) {
            const extList = Array.from(invalidExtensions).join(', ');
            toast.error(`Unsupported file format(s) detected: ${extList}`);
            return;
          }

          if (isAndroid) {
            const DEFAULT_IMPORT_SETTINGS = {
              filenameTemplate: '{original_filename}',
              organizeByDate: false,
              dateFolderFormat: 'YYYY/MM-DD',
              deleteAfterImport: false,
            };
            await startImportFiles(validFiles, targetPath, DEFAULT_IMPORT_SETTINGS);
            return;
          }

          setUI({ importSourcePaths: validFiles, importTargetFolder: targetPath, isImportModalOpen: true });
        }
      } catch (err) {
        console.error('Failed to open file dialog for import:', err);
      }
    },
    [startImportFiles],
  );

  const handlePasteFiles = useCallback(
    async (mode = 'copy') => {
      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { currentFolderPath, setLibrary } = useLibraryStore.getState();

      if (copiedFilePaths.length === 0 || !currentFolderPath) return;

      try {
        if (mode === 'copy') {
          await copyFilesWithSchema({ sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
        } else {
          await moveFilesWithSchema({ sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
          setProcess({ copiedFilePaths: [] });
          setLibrary({ multiSelectedPaths: [] });
          await refreshAllFolderTrees();
        }
        await refreshImageList();
      } catch (err) {
        toast.error(`Failed to ${mode} files: ${formatUnknownError(err)}`);
      }
    },
    [refreshImageList, refreshAllFolderTrees],
  );

  return {
    executeDelete,
    handleDeleteSelected,
    handleCreateFolder,
    handleRenameFolder,
    handleSaveRename,
    handleRenameFiles,
    handleStartImport,
    startImportFiles,
    handleImportClick,
    handlePasteFiles,
  };
}
