import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Aperture,
  Check,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Edit,
  FileEdit,
  FileInput,
  Folder,
  FolderInput,
  FolderPlus,
  Images,
  LayoutTemplate,
  Redo,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Star,
  SquaresUnite,
  Palette,
  Trash2,
  Undo,
  Pin,
  PinOff,
  Users,
  Gauge,
  Grip,
  Film,
  Home,
  Plane,
  Mountain,
  Sun,
  Camera,
  Map,
  Heart,
  Car,
  Briefcase,
  User,
  Album as AlbumIcon,
} from 'lucide-react';
import { useCallback, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import {
  buildColorLabelMenu,
  buildDestructiveConfirmSubmenu,
  buildRatingMenu,
  buildTaggingMenu,
  type CommonTag,
} from './contextMenuOptionBuilders';
import { useEditorActions } from './useEditorActions';
import { useLibraryActions } from './useLibraryActions';
import {
  Invokes,
  type Option,
  OPTION_SEPARATOR,
  Panel,
  type AlbumItem,
  type Album,
  type ImageFile,
  type AppSettings,
} from '../components/ui/AppProperties';
import { useContextMenu } from '../context/ContextMenuContext';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../schemas/focusStackUiSchemas';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../schemas/hdrMergeUiSchemas';
import { libraryRelinkIdentitySchema } from '../schemas/libraryRelinkSchemas';
import { DEFAULT_PANORAMA_UI_SETTINGS } from '../schemas/panoramaUiSchemas';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../schemas/superResolutionUiSchemas';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import { globalImageCache } from '../utils/ImageLRUCache';
import {
  applyLibraryRelinkToRuntimeState,
  planLibraryFolderRelink,
  planLibraryRelink,
  rewriteLibraryRelinkPath,
} from '../utils/libraryRelinkIdentity';
import { createSuperResolutionSourcePreflightMetadata } from '../utils/superResolutionSourcePreflight';
import { invokeWithSchema } from '../utils/tauriSchemaInvoke';

export interface UseAppContextMenusProps {
  handleImageSelect: (path: string) => void;
  handleBackToLibrary: () => void;
  handleRenameFiles: (paths: string[]) => void;
  handleImportClick: (path: string) => void;
  handleLibraryRefresh: () => Promise<void>;
  refreshAllFolderTrees: () => Promise<void>;
  refreshImageList: () => Promise<void>;
  executeDelete: (paths: string[], options: DeleteOptions) => Promise<void>;
  handleTogglePinFolder: (path: string) => Promise<void>;
}

interface DeleteOptions {
  includeAssociated: boolean;
}

interface LoadedMetadata {
  adjustments?: Adjustments | null;
}

interface FolderTreeRoot {
  path?: string;
}

type ContextMenuEvent = MouseEvent<HTMLElement>;

const normalizeRelinkPath = (path: string): string => path.trim().replace(/[\\/]+$/u, '');

const isRelinkPathInside = (path: string, parentPath: string): boolean => {
  const normalizedPath = normalizeRelinkPath(path);
  const normalizedParent = normalizeRelinkPath(parentPath);
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`) ||
    normalizedPath.startsWith(`${normalizedParent}\\`)
  );
};

const collectFolderRelinkSourcePaths = (imageList: ImageFile[], folderPath: string): string[] =>
  Array.from(
    new Set(
      imageList
        .map((image) => image.path.split('?vc=')[0] ?? image.path)
        .filter((imagePath) => isRelinkPathInside(imagePath, folderPath)),
    ),
  ).sort((left, right) => left.localeCompare(right));

const findAlbumById = (items: AlbumItem[], albumId: string): Album | null => {
  for (const item of items) {
    if (item.type === 'album' && item.id === albumId) {
      return item;
    }

    if (item.type === 'group') {
      const found = findAlbumById(item.children, albumId);
      if (found) return found;
    }
  }

  return null;
};

export function useAppContextMenus(props: UseAppContextMenusProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();

  const { handleAutoAdjustments, handleResetAdjustments, handleCopyAdjustments, handlePasteAdjustments } =
    useEditorActions();
  const { handleRate, handleSetColorLabel, handleTagsChanged } = useLibraryActions();

  const albumIcons = useMemo(
    () => [
      { label: t('contextMenus.albumIcons.default'), value: undefined, icon: Folder },
      { label: t('contextMenus.albumIcons.travel'), value: 'plane', icon: Plane },
      { label: t('contextMenus.albumIcons.nature'), value: 'mountain', icon: Mountain },
      { label: t('contextMenus.albumIcons.summer'), value: 'sun', icon: Sun },
      { label: t('contextMenus.albumIcons.photography'), value: 'camera', icon: Camera },
      { label: t('contextMenus.albumIcons.locations'), value: 'map', icon: Map },
      { label: t('contextMenus.albumIcons.favorites'), value: 'heart', icon: Heart },
      { label: t('contextMenus.albumIcons.featured'), value: 'star', icon: Star },
      { label: t('contextMenus.albumIcons.people'), value: 'users', icon: Users },
      { label: t('contextMenus.albumIcons.person'), value: 'user', icon: User },
      { label: t('contextMenus.albumIcons.automotive'), value: 'car', icon: Car },
      { label: t('contextMenus.albumIcons.portfolio'), value: 'briefcase', icon: Briefcase },
    ],
    [t],
  );

  const getCommonTags = useCallback((paths: string[]): CommonTag[] => {
    const { imageList } = useLibraryStore.getState();
    if (paths.length === 0) return [];
    const imageFiles = imageList.filter((img) => paths.includes(img.path));
    if (imageFiles.length === 0) return [];

    const allTagsSets = imageFiles.map((img) => {
      const tagsWithPrefix = (img.tags || []).filter((t: string) => !t.startsWith('color:'));
      return new Set(tagsWithPrefix);
    });

    if (allTagsSets.length === 0) return [];

    const commonTagsWithPrefix = allTagsSets.reduce((intersection, currentSet) => {
      return new Set([...intersection].filter((tag) => currentSet.has(tag)));
    });

    return Array.from(commonTagsWithPrefix)
      .map((tag: string) => ({
        tag: tag.startsWith('user:') ? tag.substring(5) : tag,
        isUser: tag.startsWith('user:'),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, []);

  const buildAddToAlbumMenu = useCallback(
    function buildAddToAlbumMenu(items: AlbumItem[], pathsToAdd: string[]): Option[] {
      return items.map((item) => {
        const customIconDef = item.icon ? albumIcons.find((i) => i.value === item.icon) : null;
        const ResolvedIcon = customIconDef?.icon || (item.type === 'group' ? Folder : AlbumIcon);

        if (item.type === 'group') {
          return {
            label: item.name,
            icon: ResolvedIcon,
            submenu:
              item.children.length > 0
                ? buildAddToAlbumMenu(item.children, pathsToAdd)
                : [{ label: t('contextMenus.album.emptyGroup'), disabled: true }],
          };
        } else {
          return {
            label: item.name,
            icon: ResolvedIcon,
            onClick: () => {
              invoke(Invokes.AddToAlbum, { albumId: item.id, paths: pathsToAdd })
                .then(() => {
                  console.log(`Added image(s) to ${item.name}`);
                  void invoke<AlbumItem[]>(Invokes.GetAlbums)
                    .then((res) => {
                      useLibraryStore.getState().setLibrary({ albumTree: res });
                    })
                    .catch((err: unknown) => toast.error(t('contextMenus.toasts.failedAddToAlbum', { err })));
                })
                .catch((err: unknown) => toast.error(t('contextMenus.toasts.failedAddToAlbum', { err })));
            },
          };
        }
      });
    },
    [albumIcons, t],
  );

  const handleEditorContextMenu = useCallback(
    (event: ContextMenuEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const { selectedImage, history, historyIndex, undo, redo, resetHistory, copiedAdjustments, setEditor } =
        useEditorStore.getState();
      const { imageList } = useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setRightPanel, setUI } = useUIStore.getState();

      if (!selectedImage) return;

      const selectedImageFile: ImageFile = imageList.find((image) => image.path === selectedImage.path) ?? {
        exif: selectedImage.exif ?? null,
        is_edited: false,
        is_virtual_copy: false,
        modified: 0,
        path: selectedImage.path,
        rating: 0,
        tags: null,
      };

      const canUndo = historyIndex > 0;
      const canRedo = historyIndex < history.length - 1;
      const commonTags = getCommonTags([selectedImage.path]);

      const options: Array<Option> = [
        {
          label: t('contextMenus.editor.exportImage'),
          icon: FileInput,
          onClick: () => {
            setRightPanel(Panel.Export);
          },
        },
        { type: OPTION_SEPARATOR },
        { label: t('contextMenus.editor.undo'), icon: Undo, onClick: undo, disabled: !canUndo },
        { label: t('contextMenus.editor.redo'), icon: Redo, onClick: redo, disabled: !canRedo },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.copyAdjustments'),
          icon: Copy,
          onClick: () => {
            void handleCopyAdjustments();
          },
        },
        {
          label: t('contextMenus.editor.pasteAdjustments'),
          icon: ClipboardPaste,
          onClick: () => {
            handlePasteAdjustments();
          },
          disabled: copiedAdjustments === null,
        },
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            {
              label: t('contextMenus.editor.autoAdjust'),
              icon: Aperture,
              onClick: () => {
                void handleAutoAdjustments();
              },
              disabled: !selectedImage.isReady,
            },
            {
              label: t('contextMenus.editor.denoise'),
              icon: Grip,
              onClick: () => {
                setUI({
                  denoiseModalState: {
                    isOpen: true,
                    isProcessing: false,
                    previewBase64: null,
                    error: null,
                    targetPaths: [selectedImage.path],
                    progressMessage: null,
                    isRaw: selectedImage.isRaw,
                  },
                });
              },
            },
            {
              label: t('contextMenus.editor.convertNegative'),
              icon: Film,
              onClick: () => {
                setUI({ negativeModalState: { isOpen: true, targetPaths: [selectedImage.path] } });
              },
            },
            {
              disabled: true,
              icon: ScanSearch,
              label: t('contextMenus.editor.superResolution'),
            },
            {
              disabled: true,
              icon: Aperture,
              label: t('contextMenus.editor.focusStack'),
            },
            { disabled: true, icon: SquaresUnite, label: t('contextMenus.editor.stitchPanorama') },
            { disabled: true, icon: Images, label: t('contextMenus.editor.mergeHdr') },
            {
              icon: LayoutTemplate,
              label: t('contextMenus.editor.frameImage'),
              onClick: () => {
                setUI({ collageModalState: { isOpen: true, sourceImages: [selectedImageFile] } });
              },
            },
            { label: t('contextMenus.editor.cullImage'), icon: Users, disabled: true },
          ],
        },
        { type: OPTION_SEPARATOR },
        buildRatingMenu({ onRate: handleRate, t }),
        buildColorLabelMenu({ onSetColorLabel: handleSetColorLabel, t }),
        buildTaggingMenu({ appSettings, commonTags, onTagsChanged: handleTagsChanged, paths: [selectedImage.path], t }),
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.resetAdjustments'),
          icon: RotateCcw,
          submenu: buildDestructiveConfirmSubmenu({
            cancelLabel: t('contextMenus.editor.cancel'),
            actions: [
              {
                label: t('contextMenus.editor.confirmReset'),
                onClick: () => {
                  const originalAspectRatio =
                    selectedImage.width && selectedImage.height ? selectedImage.width / selectedImage.height : null;
                  resetHistory({
                    ...INITIAL_ADJUSTMENTS,
                    aspectRatio: originalAspectRatio,
                    aiPatches: [],
                  });
                  setEditor({
                    adjustments: { ...INITIAL_ADJUSTMENTS, aspectRatio: originalAspectRatio, aiPatches: [] },
                  });
                },
              },
            ],
          }),
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      getCommonTags,
      handleCopyAdjustments,
      handlePasteAdjustments,
      handleAutoAdjustments,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      showContextMenu,
      t,
    ],
  );

  const handleThumbnailContextMenu = useCallback(
    (event: ContextMenuEvent, path: string) => {
      event.preventDefault();
      event.stopPropagation();

      const { selectedImage, copiedAdjustments, setEditor } = useEditorStore.getState();
      const { multiSelectedPaths, imageList, libraryActivePath, albumTree, activeAlbumId, setLibrary } =
        useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setUI, setRightPanel } = useUIStore.getState();
      const { setProcess } = useProcessStore.getState();

      const isTargetInSelection = multiSelectedPaths.includes(path);
      let finalSelection: string[];

      if (!isTargetInSelection) {
        finalSelection = [path];
        setLibrary({ multiSelectedPaths: [path] });
        if (!selectedImage) {
          setLibrary({ libraryActivePath: path });
        }
      } else {
        finalSelection = multiSelectedPaths;
      }

      const commonTags = getCommonTags(finalSelection);

      const selectionCount = finalSelection.length;
      const isSingleSelection = selectionCount === 1;
      const isEditingThisImage = selectedImage?.path === path;
      const deleteLabel = t('contextMenus.thumbnail.deleteImage', { count: selectionCount });
      const exportLabel = t('contextMenus.thumbnail.exportImage', { count: selectionCount });

      const firstSelectedPath = finalSelection[0];
      const selectionHasVirtualCopies =
        isSingleSelection &&
        firstSelectedPath !== undefined &&
        !firstSelectedPath.includes('?vc=') &&
        imageList.some((image) => image.path.startsWith(`${firstSelectedPath}?vc=`));

      const hasAssociatedFiles = finalSelection.some((selectedPath) => {
        const lastDotIndex = selectedPath.lastIndexOf('.');
        if (lastDotIndex === -1) return false;
        const basePath = selectedPath.substring(0, lastDotIndex);
        return imageList.some((image) => image.path.startsWith(basePath + '.') && image.path !== selectedPath);
      });

      let deleteSubmenu;
      if (selectionHasVirtualCopies) {
        deleteSubmenu = buildDestructiveConfirmSubmenu({
          cancelLabel: t('contextMenus.editor.cancel'),
          actions: [
            {
              label: t('contextMenus.thumbnail.confirmDeleteVc'),
              onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
            },
          ],
        });
      } else if (hasAssociatedFiles) {
        deleteSubmenu = buildDestructiveConfirmSubmenu({
          cancelLabel: t('contextMenus.editor.cancel'),
          actions: [
            {
              label: t('contextMenus.thumbnail.deleteSelected'),
              onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
            },
            {
              label: t('contextMenus.thumbnail.deleteAssociated'),
              onClick: () => props.executeDelete(finalSelection, { includeAssociated: true }),
            },
          ],
        });
      } else {
        deleteSubmenu = buildDestructiveConfirmSubmenu({
          cancelLabel: t('contextMenus.editor.cancel'),
          actions: [
            {
              label: t('contextMenus.thumbnail.confirmDelete'),
              onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
            },
          ],
        });
      }

      const pasteLabel = t('contextMenus.thumbnail.pasteAdjustments', { count: selectionCount });
      const resetLabel = t('contextMenus.thumbnail.resetAdjustments', { count: selectionCount });
      const copyLabel = t('contextMenus.thumbnail.copyImage', { count: selectionCount });
      const autoAdjustLabel = t('contextMenus.thumbnail.autoAdjust', { count: selectionCount });
      const relinkLabel = t('contextMenus.thumbnail.relinkOriginal');
      const renameLabel = t('contextMenus.thumbnail.renameImage', { count: selectionCount });
      const cullLabel = t('contextMenus.thumbnail.cullImage', { count: selectionCount });
      const collageLabel = t('contextMenus.thumbnail.collage', { count: selectionCount });
      const stitchLabel = t('contextMenus.editor.stitchPanorama');
      const superResolutionLabel = t('contextMenus.editor.superResolution');
      const focusStackLabel = t('contextMenus.editor.focusStack');
      const conversionLabel = t('contextMenus.thumbnail.convertNegative', { count: selectionCount });
      const denoiseLabel = t('contextMenus.thumbnail.denoise', { count: selectionCount });
      const mergeLabel = t('contextMenus.editor.mergeHdr');

      const handleCreateVirtualCopy = async (sourcePath: string) => {
        try {
          await invoke(Invokes.CreateVirtualCopy, {
            sourceVirtualPath: sourcePath,
            targetAlbumId: activeAlbumId || null,
          });

          if (activeAlbumId) {
            const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
            setLibrary({ albumTree: sortedTree });
          }
          await props.refreshImageList();
        } catch (err) {
          toast.error(t('contextMenus.toasts.failedCreateVirtualCopy', { err }));
        }
      };

      const handleApplyAutoAdjustmentsToSelection = () => {
        if (finalSelection.length === 0) return;
        finalSelection.forEach((p) => {
          globalImageCache.delete(p);
        });

        invoke(Invokes.ApplyAutoAdjustmentsToPaths, { paths: finalSelection })
          .then(async () => {
            if (selectedImage && finalSelection.includes(selectedImage.path)) {
              const metadata = await invoke<LoadedMetadata>(Invokes.LoadMetadata, { path: selectedImage.path });
              if (metadata.adjustments && !metadata.adjustments['is_null']) {
                const normalized = normalizeLoadedAdjustments(metadata.adjustments);
                setEditor({ adjustments: normalized });
                useEditorStore.getState().resetHistory(normalized);
              }
            }
            if (libraryActivePath && finalSelection.includes(libraryActivePath)) {
              const metadata = await invoke<LoadedMetadata>(Invokes.LoadMetadata, { path: libraryActivePath });
              if (metadata.adjustments && !metadata.adjustments['is_null']) {
                const normalized = normalizeLoadedAdjustments(metadata.adjustments);
                setLibrary({ libraryActiveAdjustments: normalized });
              }
            }
          })
          .catch((err: unknown) => {
            console.error('Failed to apply auto adjustments to paths:', err);
            toast.error(t('contextMenus.toasts.failedApplyAuto', { err }));
          });
      };

      const onExportClick = () => {
        if (selectedImage) {
          if (selectedImage.path !== path) {
            props.handleImageSelect(path);
          }
          setLibrary({ multiSelectedPaths: finalSelection });
          setRightPanel(Panel.Export);
        } else {
          setLibrary({ multiSelectedPaths: finalSelection });
          setUI({ isLibraryExportPanelVisible: true });
        }
      };

      const handleRemoveFromAlbum = async () => {
        if (!activeAlbumId) return;
        const newTree: AlbumItem[] = structuredClone(albumTree);

        const removeImages = (nodes: AlbumItem[]): boolean => {
          for (const n of nodes) {
            if (n.id === activeAlbumId && n.type === 'album') {
              n.images = n.images.filter((p) => !finalSelection.includes(p));
              return true;
            } else if (n.type === 'group') {
              if (removeImages(n.children)) return true;
            }
          }
          return false;
        };

        if (removeImages(newTree)) {
          try {
            await invoke(Invokes.SaveAlbums, { tree: newTree });
            const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
            setLibrary({ albumTree: sortedTree });

            const albumObj = findAlbumById(sortedTree, activeAlbumId);

            if (albumObj) {
              setLibrary({ imageList: imageList.filter((i) => albumObj.images.includes(i.path)) });
            }
          } catch (e) {
            toast.error(t('contextMenus.toasts.failedRemoveImages', { err: e }));
          }
        }
      };

      const options = [
        ...(!isEditingThisImage
          ? [
              {
                disabled: !isSingleSelection,
                icon: Edit,
                label: t('contextMenus.editor.editImage'),
                onClick: () => {
                  const selectedPath = finalSelection[0];
                  if (selectedPath) props.handleImageSelect(selectedPath);
                },
              },
              { icon: FileInput, label: exportLabel, onClick: onExportClick },
              { type: OPTION_SEPARATOR },
            ]
          : [{ icon: FileInput, label: exportLabel, onClick: onExportClick }, { type: OPTION_SEPARATOR }]),
        {
          disabled: !isSingleSelection,
          icon: Copy,
          label: t('contextMenus.editor.copyAdjustments'),
          onClick: () => handleCopyAdjustments(),
        },
        {
          disabled: copiedAdjustments === null,
          icon: ClipboardPaste,
          label: pasteLabel,
          onClick: () => {
            handlePasteAdjustments(finalSelection);
          },
        },
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            { label: autoAdjustLabel, icon: Aperture, onClick: handleApplyAutoAdjustmentsToSelection },
            {
              label: denoiseLabel,
              icon: Grip,
              disabled: finalSelection.length === 0,
              onClick: () => {
                setUI({
                  denoiseModalState: {
                    isOpen: true,
                    isProcessing: false,
                    previewBase64: null,
                    error: null,
                    targetPaths: finalSelection,
                    progressMessage: null,
                    isRaw: selectedImage?.isRaw || false,
                  },
                });
              },
            },
            {
              label: conversionLabel,
              icon: Film,
              disabled: selectionCount === 0,
              onClick: () => {
                setUI({ negativeModalState: { isOpen: true, targetPaths: finalSelection } });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 16,
              icon: ScanSearch,
              label: superResolutionLabel,
              onClick: () => {
                setUI({
                  superResolutionModalState: {
                    isOpen: true,
                    outputReview: null,
                    settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
                    sourcePreflightMetadata: createSuperResolutionSourcePreflightMetadata(finalSelection, imageList),
                    sourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 16,
              icon: Aperture,
              label: focusStackLabel,
              onClick: () => {
                setUI({
                  focusStackModalState: {
                    isOpen: true,
                    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
                    sourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 30,
              icon: SquaresUnite,
              label: stitchLabel,
              onClick: () => {
                setUI({
                  panoramaModalState: {
                    error: null,
                    finalImageBase64: null,
                    isOpen: true,
                    isProcessing: false,
                    lastDryRunCommand: null,
                    progressMessage: null,
                    renderedReview: null,
                    runtimePlan: null,
                    settings: DEFAULT_PANORAMA_UI_SETTINGS,
                    stitchingSourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 9,
              icon: Images,
              label: mergeLabel,
              onClick: () => {
                const hdrSourceMetadata = finalSelection.map((path) => ({
                  exif: imageList.find((image) => image.path === path)?.exif ?? null,
                  path,
                }));
                setUI({
                  hdrModalState: {
                    error: null,
                    finalImageBase64: null,
                    isOpen: true,
                    isProcessing: false,
                    progressMessage: null,
                    settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
                    sourceMetadata: hdrSourceMetadata,
                    stitchingSourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              icon: LayoutTemplate,
              label: collageLabel,
              onClick: () => {
                const imagesForCollage = imageList.filter((img) => finalSelection.includes(img.path));
                setUI({ collageModalState: { isOpen: true, sourceImages: imagesForCollage } });
              },
              disabled: selectionCount === 0 || selectionCount > 9,
            },
            {
              label: cullLabel,
              icon: Users,
              onClick: () => {
                setUI({
                  cullingModalState: {
                    isOpen: true,
                    progress: null,
                    suggestions: null,
                    error: null,
                    pathsToCull: finalSelection,
                  },
                });
              },
              disabled: selectionCount < 2,
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: copyLabel,
          icon: Copy,
          onClick: () => {
            setProcess({ copiedFilePaths: finalSelection, isCopied: true });
          },
        },
        {
          icon: CopyPlus,
          label: t('contextMenus.thumbnail.duplicateImage'),
          disabled: !isSingleSelection,
          submenu: [
            {
              label: t('contextMenus.thumbnail.physicalCopy'),
              icon: Copy,
              onClick: async () => {
                try {
                  await invoke(Invokes.DuplicateFile, {
                    path: finalSelection[0],
                    targetAlbumId: activeAlbumId || null,
                  });
                  if (activeAlbumId) {
                    const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
                    setLibrary({ albumTree: sortedTree });
                  }
                  await props.refreshImageList();
                } catch (err) {
                  console.error('Failed to duplicate file:', err);
                  toast.error(t('contextMenus.toasts.failedDuplicate', { err }));
                }
              },
            },
            {
              label: t('contextMenus.thumbnail.virtualCopy'),
              icon: CopyPlus,
              onClick: () => {
                const selectedPath = finalSelection[0];
                if (selectedPath) void handleCreateVirtualCopy(selectedPath);
              },
            },
          ],
        },
        {
          icon: FileEdit,
          label: renameLabel,
          onClick: () => {
            props.handleRenameFiles(finalSelection);
          },
        },
        {
          disabled: !isSingleSelection || firstSelectedPath === undefined || firstSelectedPath.includes('?vc='),
          icon: FileInput,
          label: relinkLabel,
          onClick: async () => {
            const fromPath = finalSelection[0];
            if (!fromPath) return;

            const selected = await open({
              directory: false,
              multiple: false,
              title: relinkLabel,
            });
            if (typeof selected !== 'string') return;

            try {
              const [missingIdentity, candidateIdentity] = await Promise.all([
                invokeWithSchema(
                  Invokes.ReadLibraryRelinkIdentity,
                  { path: fromPath },
                  libraryRelinkIdentitySchema,
                  Invokes.ReadLibraryRelinkIdentity,
                ),
                invokeWithSchema(
                  Invokes.ReadLibraryRelinkIdentity,
                  { path: selected },
                  libraryRelinkIdentitySchema,
                  Invokes.ReadLibraryRelinkIdentity,
                ),
              ]);
              const plan = planLibraryRelink({ candidateIdentities: [candidateIdentity], missingIdentity });

              if (plan.status !== 'matched') {
                toast.error(t('contextMenus.toasts.failedRelinkOriginal'));
                return;
              }

              setLibrary((state) =>
                applyLibraryRelinkToRuntimeState(
                  {
                    currentFolderPath: state.currentFolderPath,
                    imageList: state.imageList,
                    imageRatings: state.imageRatings,
                    libraryActivePath: state.libraryActivePath,
                    multiSelectedPaths: state.multiSelectedPaths,
                    rootPaths: state.rootPaths,
                    selectionAnchorPath: state.selectionAnchorPath,
                  },
                  fromPath,
                  plan,
                ),
              );
              setEditor((state) =>
                state.selectedImage?.path === fromPath && plan.selectedCandidatePath !== null
                  ? { selectedImage: { ...state.selectedImage, path: plan.selectedCandidatePath } }
                  : {},
              );
              toast.success(t('contextMenus.toasts.relinkedOriginal'));
            } catch (err) {
              toast.error(t('contextMenus.toasts.failedRelinkOriginalWithError', { err }));
            }
          },
        },
        { type: OPTION_SEPARATOR },
        buildRatingMenu({
          onRate: (rating) => {
            handleRate(rating, finalSelection);
          },
          t,
        }),
        buildColorLabelMenu({
          onSetColorLabel: (color) => {
            void handleSetColorLabel(color, finalSelection);
          },
          t,
        }),
        buildTaggingMenu({ appSettings, commonTags, onTagsChanged: handleTagsChanged, paths: finalSelection, t }),
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.thumbnail.addToAlbum'),
          icon: FolderPlus,
          submenu:
            albumTree.length > 0
              ? buildAddToAlbumMenu(albumTree, finalSelection)
              : [{ label: t('contextMenus.thumbnail.noAlbums'), disabled: true }],
        },
        ...(activeAlbumId
          ? [
              {
                label: t('contextMenus.thumbnail.removeFromAlbum', { count: selectionCount }),
                icon: Trash2,
                isDestructive: true,
                onClick: handleRemoveFromAlbum,
              },
            ]
          : []),
        { type: OPTION_SEPARATOR },
        {
          disabled: !isSingleSelection,
          icon: Folder,
          label: t('contextMenus.thumbnail.showExplorer'),
          onClick: () => {
            invoke(Invokes.ShowInFinder, { path: finalSelection[0] }).catch((err: unknown) =>
              toast.error(t('contextMenus.toasts.couldNotShowExplorer', { err })),
            );
          },
        },
        {
          label: resetLabel,
          icon: RotateCcw,
          submenu: buildDestructiveConfirmSubmenu({
            cancelLabel: t('contextMenus.editor.cancel'),
            actions: [
              {
                label: t('contextMenus.editor.confirmReset'),
                onClick: () => {
                  handleResetAdjustments(finalSelection);
                },
              },
            ],
          }),
        },
        {
          label: deleteLabel,
          icon: Trash2,
          isDestructive: true,
          submenu: deleteSubmenu,
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      getCommonTags,
      buildAddToAlbumMenu,
      handleCopyAdjustments,
      handlePasteAdjustments,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      handleResetAdjustments,
      showContextMenu,
      props,
      t,
    ],
  );

  const handleFolderTreeContextMenu = useCallback(
    (event: ContextMenuEvent, path: string | null, isCurrentlyPinned?: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      if (!path) {
        showContextMenu(event.clientX, event.clientY, [
          {
            icon: RefreshCw,
            label: t('contextMenus.folders.refresh'),
            onClick: () => {
              void props.refreshAllFolderTrees();
            },
          },
        ]);
        return;
      }

      const { rootPaths, currentFolderPath, folderTrees, setLibrary } = useLibraryStore.getState();
      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { setUI } = useUIStore.getState();
      const targetPath = path;
      const isRoot = rootPaths.includes(targetPath);
      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });
      const relinkFolderLabel = t('contextMenus.folders.relinkFolder');

      const handleRelinkFolder = async () => {
        const selected = await open({
          directory: true,
          multiple: false,
          title: relinkFolderLabel,
        });
        if (typeof selected !== 'string') return;

        const { imageList, setLibrary } = useLibraryStore.getState();
        const sourcePaths = collectFolderRelinkSourcePaths(imageList, targetPath);
        if (sourcePaths.length === 0) {
          toast.error(t('contextMenus.toasts.failedRelinkFolderNoImages'));
          return;
        }

        const candidatePaths = sourcePaths.map((sourcePath) =>
          rewriteLibraryRelinkPath(sourcePath, targetPath, selected),
        );

        try {
          const [missingIdentities, candidateIdentities] = await Promise.all([
            Promise.all(
              sourcePaths.map((sourcePath) =>
                invokeWithSchema(
                  Invokes.ReadLibraryRelinkIdentity,
                  { path: sourcePath },
                  libraryRelinkIdentitySchema,
                  Invokes.ReadLibraryRelinkIdentity,
                ),
              ),
            ),
            Promise.all(
              candidatePaths.map((candidatePath) =>
                invokeWithSchema(
                  Invokes.ReadLibraryRelinkIdentity,
                  { path: candidatePath },
                  libraryRelinkIdentitySchema,
                  Invokes.ReadLibraryRelinkIdentity,
                ),
              ),
            ),
          ]);

          const folderPlan = planLibraryFolderRelink({
            candidateIdentities,
            fromRootPath: targetPath,
            missingIdentities,
            toRootPath: selected,
          });

          if (folderPlan.status !== 'matched' || folderPlan.relinkPlan === null) {
            toast.error(
              t('contextMenus.toasts.failedRelinkFolderReview', {
                matched: folderPlan.matchedCount,
                rejected: folderPlan.rejectedCount + folderPlan.ambiguousCount,
                total: folderPlan.totalCount,
              }),
            );
            return;
          }
          const relinkPlan = folderPlan.relinkPlan;

          setLibrary((state) =>
            applyLibraryRelinkToRuntimeState(
              {
                currentFolderPath: state.currentFolderPath,
                imageList: state.imageList,
                imageRatings: state.imageRatings,
                libraryActivePath: state.libraryActivePath,
                multiSelectedPaths: state.multiSelectedPaths,
                rootPaths: state.rootPaths,
                selectionAnchorPath: state.selectionAnchorPath,
              },
              targetPath,
              relinkPlan,
            ),
          );

          const { selectedImage, setEditor } = useEditorStore.getState();
          if (selectedImage && isRelinkPathInside(selectedImage.path, targetPath)) {
            setEditor({
              selectedImage: {
                ...selectedImage,
                path: rewriteLibraryRelinkPath(selectedImage.path, targetPath, selected),
              },
            });
          }

          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (appSettings) {
            await handleSettingsChange({
              ...appSettings,
              lastRootPath:
                appSettings.lastRootPath && isRelinkPathInside(appSettings.lastRootPath, targetPath)
                  ? rewriteLibraryRelinkPath(appSettings.lastRootPath, targetPath, selected)
                  : appSettings.lastRootPath,
              rootFolders: (appSettings.rootFolders ?? []).map((rootPath) =>
                isRelinkPathInside(rootPath, targetPath)
                  ? rewriteLibraryRelinkPath(rootPath, targetPath, selected)
                  : rootPath,
              ),
            });
          }

          await props.refreshAllFolderTrees();
          await props.refreshImageList();
          toast.success(t('contextMenus.toasts.relinkedFolder', { count: folderPlan.matchedCount }));
        } catch (err) {
          toast.error(t('contextMenus.toasts.failedRelinkFolderWithError', { err }));
        }
      };

      const pinOption = isCurrentlyPinned
        ? {
            icon: PinOff,
            label: t('contextMenus.folders.unpin'),
            onClick: () => props.handleTogglePinFolder(targetPath),
          }
        : { icon: Pin, label: t('contextMenus.folders.pin'), onClick: () => props.handleTogglePinFolder(targetPath) };

      const options = [
        ...(isRoot
          ? [
              {
                icon: Trash2,
                label: t('contextMenus.folders.removeRoot'),
                isDestructive: true,
                onClick: () => {
                  const newRoots = rootPaths.filter((r: string) => r !== targetPath);
                  const newFolderTrees = folderTrees.filter((tree: FolderTreeRoot) => tree.path !== targetPath);

                  const isCurrentInTarget =
                    currentFolderPath === targetPath ||
                    currentFolderPath?.startsWith(targetPath + '/') ||
                    currentFolderPath?.startsWith(targetPath + '\\');

                  const updates = isCurrentInTarget
                    ? {
                        rootPaths: newRoots,
                        folderTrees: newFolderTrees,
                        currentFolderPath: null,
                        imageList: [],
                        libraryActivePath: null,
                        multiSelectedPaths: [],
                        selectionAnchorPath: null,
                      }
                    : {
                        rootPaths: newRoots,
                        folderTrees: newFolderTrees,
                      };

                  if (isCurrentInTarget) props.handleBackToLibrary();

                  setLibrary(updates);

                  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                  if (appSettings) {
                    const newSettings: AppSettings = { ...appSettings, rootFolders: newRoots };
                    if (newRoots.length === 0) {
                      newSettings.lastRootPath = null;
                      newSettings.lastFolderState = null;
                    } else if (newSettings.lastRootPath === targetPath) {
                      newSettings.lastRootPath = newRoots[0] ?? null;
                    }

                    if (isCurrentInTarget) {
                      newSettings.lastFolderState = null;
                    }

                    void handleSettingsChange(newSettings);
                  }
                },
              },
              { type: OPTION_SEPARATOR },
            ]
          : []),
        pinOption,
        { type: OPTION_SEPARATOR },
        {
          icon: FolderPlus,
          label: t('contextMenus.folders.newFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isCreateFolderModalOpen: true });
          },
        },
        {
          disabled: isRoot,
          icon: FileEdit,
          label: t('contextMenus.folders.renameFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isRenameFolderModalOpen: true });
          },
        },
        {
          label: t('contextMenus.folders.changeIcon'),
          icon: Palette,
          submenu: albumIcons.map((iconDef) => ({
            label: iconDef.label,
            icon: iconDef.icon,
            onClick: () => {
              if (appSettings) {
                const currentIcons = appSettings.folderIcons || {};

                if (iconDef.value) {
                  void handleSettingsChange({
                    ...appSettings,
                    folderIcons: { ...currentIcons, [targetPath]: iconDef.value },
                  });
                } else {
                  const { [targetPath]: _removedIcon, ...newIcons } = currentIcons;
                  void handleSettingsChange({ ...appSettings, folderIcons: newIcons });
                }
              }
            },
          })),
        },
        { type: OPTION_SEPARATOR },
        {
          disabled: copiedFilePaths.length === 0,
          icon: ClipboardPaste,
          label: t('contextMenus.folders.paste'),
          submenu: [
            {
              label: copyPastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  if (targetPath === currentFolderPath) await props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedCopy', { err }));
                }
              },
            },
            {
              label: movePastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  setProcess({ copiedFilePaths: [] });
                  setLibrary({ multiSelectedPaths: [] });
                  await props.refreshAllFolderTrees();
                  await props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedMove', { err }));
                }
              },
            },
          ],
        },
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => {
            props.handleImportClick(targetPath);
          },
        },
        {
          icon: ScanSearch,
          label: relinkFolderLabel,
          onClick: () => {
            void handleRelinkFolder();
          },
        },
        { type: OPTION_SEPARATOR },
        {
          icon: Folder,
          label: t('contextMenus.folders.showExplorer'),
          onClick: () =>
            invoke(Invokes.ShowInFinder, { path: targetPath }).catch((err: unknown) =>
              toast.error(t('contextMenus.toasts.couldNotShowFolder', { err })),
            ),
        },
        {
          icon: RefreshCw,
          label: t('contextMenus.folders.refresh'),
          onClick: () => props.refreshAllFolderTrees(),
        },
        {
          disabled: isRoot,
          icon: Trash2,
          isDestructive: true,
          label: t('contextMenus.folders.deleteFolder'),
          submenu: buildDestructiveConfirmSubmenu({
            cancelLabel: t('contextMenus.editor.cancel'),
            actions: [
              {
                label: t('contextMenus.folders.confirm'),
                onClick: async () => {
                  try {
                    await invoke(Invokes.DeleteFolder, { path: targetPath });

                    const isCurrentInTarget =
                      currentFolderPath === targetPath ||
                      currentFolderPath?.startsWith(targetPath + '/') ||
                      currentFolderPath?.startsWith(targetPath + '\\');

                    if (isCurrentInTarget) {
                      props.handleBackToLibrary();
                      setLibrary({
                        currentFolderPath: null,
                        imageList: [],
                        libraryActivePath: null,
                        multiSelectedPaths: [],
                        selectionAnchorPath: null,
                      });

                      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                      if (appSettings) {
                        await handleSettingsChange({ ...appSettings, lastFolderState: null });
                      }
                    }

                    await props.refreshAllFolderTrees();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedDeleteFolder', { err }));
                  }
                },
              },
            ],
          }),
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [props, showContextMenu, albumIcons, t],
  );

  const handleAlbumTreeContextMenu = useCallback(
    (event: ContextMenuEvent, item: AlbumItem | null) => {
      event.preventDefault();
      event.stopPropagation();

      const { setUI } = useUIStore.getState();
      const { albumTree, setLibrary } = useLibraryStore.getState();

      const findParentId = (
        nodes: AlbumItem[],
        childId: string,
        parentId: string | null = null,
      ): string | null | undefined => {
        for (const n of nodes) {
          if (n.id === childId) return parentId;
          if (n.type === 'group') {
            const found = findParentId(n.children, childId, n.id);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };

      const currentParentId = item ? findParentId(albumTree, item.id) : undefined;

      const handleMove = (targetId: string | null) => {
        if (!item) return;
        const newTree = structuredClone(albumTree);
        let extractedItem: AlbumItem | null = null;

        const removeAndGet = (nodes: AlbumItem[], id: string): AlbumItem | null => {
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node) continue;
            if (node.id === id) return nodes.splice(i, 1)[0] ?? null;
            if (node.type === 'group') {
              const res = removeAndGet(node.children, id);
              if (res) return res;
            }
          }
          return null;
        };

        extractedItem = removeAndGet(newTree, item.id);
        if (!extractedItem) return;

        if (!targetId) {
          newTree.push(extractedItem);
        } else {
          const insert = (nodes: AlbumItem[]): boolean => {
            for (const n of nodes) {
              if (n.id === targetId && n.type === 'group') {
                n.children.push(extractedItem);
                return true;
              } else if (n.type === 'group') {
                if (insert(n.children)) return true;
              }
            }
            return false;
          };

          if (!insert(newTree)) {
            toast.error(t('contextMenus.toasts.failedMoveInvalid'));
            return;
          }
        }

        invoke(Invokes.SaveAlbums, { tree: newTree })
          .then(() => invoke<AlbumItem[]>(Invokes.GetAlbums))
          .then((sortedTree) => {
            setLibrary({ albumTree: sortedTree });
          })
          .catch((err: unknown) => toast.error(t('contextMenus.toasts.failedMoveError', { err })));
      };

      const buildMoveSubmenu = (nodes: AlbumItem[]): Option[] => {
        const opts: Option[] = [];
        nodes.forEach((n) => {
          if (n.type === 'group' && n.id !== item?.id) {
            const isCurrentParent = n.id === currentParentId;
            const subOpts = buildMoveSubmenu(n.children);

            const customIconDef = n.icon ? albumIcons.find((i) => i.value === n.icon) : null;
            const ResolvedIcon = customIconDef?.icon || Folder;

            if (subOpts.length > 0) {
              opts.push({
                label: n.name,
                icon: ResolvedIcon,
                submenu: [
                  {
                    label: isCurrentParent ? t('contextMenus.albums.alreadyHere') : t('contextMenus.albums.moveHere'),
                    icon: Check,
                    disabled: isCurrentParent,
                    onClick: isCurrentParent
                      ? undefined
                      : () => {
                          handleMove(n.id);
                        },
                  },
                  { type: OPTION_SEPARATOR },
                  ...subOpts,
                ],
              });
            } else {
              opts.push({
                label: isCurrentParent ? `${n.name} (Current)` : n.name,
                icon: ResolvedIcon,
                disabled: isCurrentParent,
                onClick: isCurrentParent
                  ? undefined
                  : () => {
                      handleMove(n.id);
                    },
              });
            }
          }
        });
        return opts;
      };

      const moveOptions = buildMoveSubmenu(albumTree);
      const isAtRoot = currentParentId === null;
      const isMoveDisabled = moveOptions.length === 0 && isAtRoot;

      const options: Option[] = [
        {
          label: t('contextMenus.albums.newAlbum'),
          icon: Images,
          onClick: () => {
            setUI({ albumActionTarget: item?.id || null, isCreateAlbumModalOpen: true });
          },
        },
        {
          label: t('contextMenus.albums.newGroup'),
          icon: FolderPlus,
          onClick: () => {
            setUI({ albumActionTarget: item?.id || null, isCreateAlbumGroupModalOpen: true });
          },
        },
        ...(item
          ? [
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.renameGroup') : t('contextMenus.albums.renameAlbum'),
                icon: FileEdit,
                onClick: () => {
                  setUI({ albumActionTarget: item.id, isRenameAlbumModalOpen: true });
                },
              },
              {
                label: t('contextMenus.folders.changeIcon'),
                icon: Palette,
                submenu: albumIcons.map((iconDef) => ({
                  label: iconDef.label,
                  icon: iconDef.icon,
                  onClick: () => {
                    const newTree = structuredClone(albumTree);
                    const updateIcon = (nodes: AlbumItem[]) => {
                      for (const n of nodes) {
                        if (n.id === item.id) {
                          if (iconDef.value) {
                            n.icon = iconDef.value;
                          } else {
                            delete n.icon;
                          }
                          return true;
                        }
                        if (n.type === 'group' && updateIcon(n.children)) return true;
                      }
                      return false;
                    };

                    if (updateIcon(newTree)) {
                      invoke(Invokes.SaveAlbums, { tree: newTree })
                        .then(() => invoke<AlbumItem[]>(Invokes.GetAlbums))
                        .then((sorted) => {
                          setLibrary({ albumTree: sorted });
                        })
                        .catch((err: unknown) => toast.error(t('contextMenus.toasts.failedChangeIcon', { err })));
                    }
                  },
                })),
              },
              {
                label: t('contextMenus.albums.moveTo'),
                icon: FolderInput,
                disabled: isMoveDisabled,
                submenu: isMoveDisabled
                  ? []
                  : [
                      {
                        label: isAtRoot ? t('contextMenus.albums.alreadyAtRoot') : t('contextMenus.albums.rootDir'),
                        icon: Home,
                        disabled: isAtRoot,
                        onClick: isAtRoot
                          ? undefined
                          : () => {
                              handleMove(null);
                            },
                      },
                      ...(moveOptions.length > 0 ? [{ type: OPTION_SEPARATOR }, ...moveOptions] : []),
                    ],
              },
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.deleteGroup') : t('contextMenus.albums.deleteAlbum'),
                icon: Trash2,
                isDestructive: true,
                submenu: buildDestructiveConfirmSubmenu({
                  cancelLabel: t('contextMenus.editor.cancel'),
                  actions: [
                    {
                      label:
                        item.type === 'album'
                          ? t('contextMenus.albums.confirmDeleteAlbum')
                          : item.children.length > 0
                            ? t('contextMenus.albums.confirmDeleteGroupNested')
                            : t('contextMenus.albums.confirmDeleteGroupEmpty'),
                      onClick: () => {
                        const newTree = structuredClone(albumTree);
                        const del = (nodes: AlbumItem[]) => {
                          const idx = nodes.findIndex((n) => n.id === item.id);
                          if (idx !== -1) nodes.splice(idx, 1);
                          else
                            nodes.forEach((n) => {
                              if (n.type === 'group') del(n.children);
                            });
                        };
                        del(newTree);
                        invoke(Invokes.SaveAlbums, { tree: newTree })
                          .then(() => invoke<AlbumItem[]>(Invokes.GetAlbums))
                          .then((sorted) => {
                            setLibrary({ albumTree: sorted });
                          })
                          .catch((err: unknown) => toast.error(t('contextMenus.toasts.failedDelete', { err })));
                      },
                    },
                  ],
                }),
              },
            ]
          : []),
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [showContextMenu, albumIcons, t],
  );

  const handleMainLibraryContextMenu = useCallback(
    (event: ContextMenuEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { currentFolderPath, activeAlbumId, setLibrary } = useLibraryStore.getState();

      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });
      const addCopiedToAlbumLabel = t('contextMenus.library.addCopiedToAlbum', { count: numCopied });

      const isAlbumView = !!activeAlbumId;

      const pasteOption = isAlbumView
        ? {
            label: addCopiedToAlbumLabel,
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0,
            onClick: async () => {
              try {
                await invoke(Invokes.AddToAlbum, { albumId: activeAlbumId, paths: copiedFilePaths });
                console.log(`Added ${String(numCopied)} image(s) to album`);
                const updatedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
                setLibrary({ albumTree: updatedTree });
                await props.refreshImageList();
              } catch (err) {
                toast.error(t('contextMenus.toasts.failedAddToAlbum', { err }));
              }
            },
          }
        : {
            label: t('contextMenus.folders.paste'),
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0,
            submenu: [
              {
                label: copyPastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.CopyFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    await props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedCopy', { err }));
                  }
                },
              },
              {
                label: movePastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.MoveFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    setProcess({ copiedFilePaths: [] });
                    setLibrary({ multiSelectedPaths: [] });
                    await props.refreshAllFolderTrees();
                    await props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedMove', { err }));
                  }
                },
              },
            ],
          };

      const options = [
        { label: t('contextMenus.library.refreshView'), icon: RefreshCw, onClick: props.handleLibraryRefresh },
        { type: OPTION_SEPARATOR },
        pasteOption,
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => {
            props.handleImportClick(currentFolderPath as string);
          },
          disabled: !currentFolderPath || isAlbumView,
        },
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [props, showContextMenu, t],
  );

  return {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleAlbumTreeContextMenu,
    handleMainLibraryContextMenu,
  };
}
