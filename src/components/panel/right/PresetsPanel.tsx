import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CopyPlus,
  Edit,
  FileDown,
  FileUp,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Loader2,
  Plus,
  SortAsc,
  Trash2,
  Users,
  Layers,
  Crop,
  Save,
  Wrench,
  Palette,
  Settings2,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useContextMenu } from '../../../context/ContextMenuContext';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { PresetListType, usePresets, type UserPreset } from '../../../hooks/usePresets';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { Invokes } from '../../../tauri/commands';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { type Adjustments, INITIAL_ADJUSTMENTS, ADJUSTMENT_GROUPS } from '../../../utils/adjustments';
import { createBlobFromUint8Array } from '../../../utils/blobUtils';
import { BUILT_IN_COLOR_STYLE_PRESETS, COLOR_STYLE_PRESET_CATALOG } from '../../../utils/colorStylePresetCatalog';
import ConfigurePresetModal from '../../modals/ConfigurePresetModal';
import CreateFolderModal from '../../modals/CreateFolderModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import { OPTION_SEPARATOR, Panel, type Folder, type Option, type Preset } from '../../ui/AppProperties';
import Button from '../../ui/Button';
import UiText from '../../ui/Text';

import type { ColorStylePreset } from '../../../schemas/colorStylePresetSchemas';

interface DroppableFolderItemProps {
  children: ReactNode;
  folder: PresetFolder;
  isExpanded: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => void;
  onToggle: (id: string) => void;
}

interface DraggablePresetItemProps {
  isGeneratingPreviews: boolean;
  onApply: (preset: Preset) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => void;
  preset: Preset;
  previewUrl: string;
}

interface FolderProps {
  folder: PresetFolder;
}

interface FolderState {
  isOpen: boolean;
  folder: PresetFolder | null;
}

interface ModalState {
  isOpen: boolean;
  preset: Preset | null;
}

interface PresetItemDisplayProps {
  isGeneratingPreviews: boolean;
  preset: Preset;
  previewUrl: string;
}

interface PresetsPanelProps {
  onNavigateToCommunity: () => void;
}

type PresetFolder = Omit<Folder, 'children' | 'id' | 'name'> & {
  children: Array<Preset>;
  id: string;
  name: string;
};

type PresetEntry = UserPreset & { preset: Preset; folder?: undefined };
type FolderEntry = UserPreset & { folder: PresetFolder; preset?: undefined };
type PresetContextItem = PresetEntry | FolderEntry;
type ActivePresetItem =
  | { data: Preset; type: PresetListType.Preset }
  | { data: PresetFolder; type: PresetListType.Folder };
type PreviewQueueItem = { folderId: string | null; preset: Preset };

const isPresetEntry = (item: UserPreset): item is PresetEntry => !!item.preset;
const isFolderEntry = (item: UserPreset): item is FolderEntry => !!item.folder;
const toDragId = (id: DragStartEvent['active']['id']): string => String(id);
const getColorStyleAdjustmentCount = (preset: ColorStylePreset): number => Object.keys(preset.adjustmentPatch).length;
const isPresetListType = (value: unknown): value is PresetListType =>
  value === PresetListType.Folder || value === PresetListType.Preset;
const getPresetDragType = (data: unknown): PresetListType | null => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const type = (data as Record<string, unknown>)['type'];
  return isPresetListType(type) ? type : null;
};

const itemVariants = {
  hidden: { opacity: 0, x: -15 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.25,
      delay: i * 0.05,
    },
  }),
  exit: { opacity: 0, x: -15, transition: { duration: 0.2 } },
};

function PresetItemDisplay({ preset, previewUrl, isGeneratingPreviews }: PresetItemDisplayProps) {
  const { t } = useTranslation();
  const geometryKeys = (ADJUSTMENT_GROUPS['geometry'] ?? []).flatMap((g) => g.keys);
  const presetMasks = preset.adjustments['masks'];

  const supportsMasks = preset.includeMasks ?? (Array.isArray(presetMasks) && presetMasks.length > 0);
  const supportsGeometry =
    preset.includeCropTransform ?? geometryKeys.some((key) => preset.adjustments[key] !== undefined);
  const isTool = preset.presetType === 'tool';
  const tooltipContent = useMemo(() => {
    const features = [];
    if (supportsMasks) features.push(t('editor.presets.supports.masks'));
    if (supportsGeometry) features.push(t('editor.presets.supports.cropTransform'));

    if (features.length === 0) return undefined;
    return t('editor.presets.supports.label', { features: features.join(' + ') });
  }, [supportsMasks, supportsGeometry, t]);

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-surface cursor-grabbing">
      <div
        className="w-20 h-14 bg-bg-tertiary rounded-md flex items-center justify-center shrink-0 relative overflow-hidden"
        data-tooltip={tooltipContent}
      >
        {isGeneratingPreviews && !previewUrl ? (
          <Loader2 size={20} className="animate-spin text-text-secondary" />
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={`${preset.name} preview`}
            className="w-full h-full object-cover rounded-md pointer-events-none"
          />
        ) : (
          <Loader2 size={20} className="animate-spin text-text-secondary" />
        )}

        {(supportsMasks || supportsGeometry) && (
          <>
            <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-linear-to-bl from-black/30 via-black/0 to-transparent pointer-events-none z-0" />

            <div className="absolute top-1 right-1 bg-primary rounded-full px-1.5 py-0.5 flex items-center gap-1.5 backdrop-blur-xs shadow-xs z-10 pointer-events-none">
              {supportsMasks && <Layers size={11} className="text-white" />}
              {supportsGeometry && <Crop size={11} className="text-white" />}
            </div>
          </>
        )}
      </div>

      <div className="grow min-w-0 flex flex-col justify-center">
        <UiText color={TextColors.primary} weight={TextWeights.medium} className="truncate">
          {preset.name}
        </UiText>
        <div className="flex items-center gap-1.5 mt-0.5">
          {isTool ? (
            <Wrench size={12} className="text-text-secondary" />
          ) : (
            <Palette size={12} className="text-text-secondary" />
          )}
          <UiText
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="text-[10px] uppercase tracking-wider"
          >
            {isTool ? t('editor.presets.types.tool') : t('editor.presets.types.style')}
          </UiText>
        </div>
      </div>
    </div>
  );
}

function FolderItemDisplay({ folder }: FolderProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-surface cursor-grabbing w-full">
      <div className="p-1">
        <FolderIcon size={18} />
      </div>
      <UiText color={TextColors.primary} weight={TextWeights.medium} className="grow truncate select-none">
        {folder.name}
      </UiText>
      <UiText as="span" weight={TextWeights.medium} className="ml-auto pr-1">
        {folder.children.length}
      </UiText>
    </div>
  );
}

function DraggablePresetItem({
  preset,
  onApply,
  onContextMenu,
  previewUrl,
  isGeneratingPreviews,
}: DraggablePresetItemProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: preset.id,
    data: { type: PresetListType.Preset, preset },
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    data: { type: PresetListType.Preset, preset },
    id: preset.id,
  });

  const setCombinedRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );

  const style = {
    borderRadius: '10px',
    opacity: isDragging ? 0.4 : 1,
    outline: isOver ? '2px solid var(--color-primary)' : '2px solid transparent',
    outlineOffset: '-2px',
    touchAction: 'none',
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onApply(preset);
  };

  return (
    <div
      onClick={() => {
        onApply(preset);
      }}
      onContextMenu={(e) => {
        onContextMenu(e, { preset });
      }}
      ref={setCombinedRef}
      role="button"
      tabIndex={0}
      aria-label={t('editor.presets.applyPresetLabel', { name: preset.name })}
      onKeyDown={handleKeyDown}
      style={style}
    >
      <motion.div
        {...listeners}
        {...attributes}
        className="cursor-grab"
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      >
        <PresetItemDisplay preset={preset} previewUrl={previewUrl} isGeneratingPreviews={isGeneratingPreviews} />
      </motion.div>
    </div>
  );
}

function DroppableFolderItem({ folder, onContextMenu, children, onToggle, isExpanded }: DroppableFolderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    data: { type: PresetListType.Folder, folder },
    id: folder.id,
  });

  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    data: { type: PresetListType.Folder, folder },
    id: folder.id,
  });

  const style = {
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'none',
  };

  const hasChildren = folder.children.length > 0;

  return (
    <div
      className={`rounded-lg transition-colors ${isOver ? 'bg-surface-hover' : ''}`}
      ref={setDroppableNodeRef}
      style={style}
    >
      <div
        className="flex items-center gap-2 p-2 rounded-lg bg-surface cursor-pointer"
        onContextMenu={(e) => {
          onContextMenu(e, { folder });
        }}
      >
        <div className="p-1 cursor-grab" ref={setDraggableNodeRef} {...listeners} {...attributes}>
          {isExpanded ? (
            <FolderOpen
              className="text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(folder.id);
              }}
              size={18}
            />
          ) : (
            <FolderIcon
              className="text-text-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(folder.id);
              }}
              size={18}
            />
          )}
        </div>
        <UiText
          color={TextColors.primary}
          weight={TextWeights.medium}
          className="grow truncate select-none"
          onClick={() => {
            onToggle(folder.id);
          }}
        >
          {folder.name}
        </UiText>
        <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="ml-auto pr-1">
          {folder.children.length}
        </UiText>
      </div>
      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="ml-5 pl-4 border-l-[1.5px] border-border-color/50 space-y-2 overflow-hidden pt-2"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PresetsPanel({ onNavigateToCommunity }: PresetsPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const activePanel = useUIStore((s) => s.activeRightPanel);
  const { setAdjustments } = useEditorActions();

  const {
    addFolder,
    addPreset,
    configurePreset,
    deleteItem,
    duplicatePreset,
    exportPresetsToFile,
    importPresetsFromFile,
    importLegacyPresetsFromFile,
    isLoading,
    movePreset,
    overwritePreset,
    presets,
    renameItem,
    reorderItems,
    sortAllPresetsAlphabetically,
  } = usePresets(adjustments);
  const { showContextMenu } = useContextMenu();
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState(false);
  const [configureModalState, setConfigureModalState] = useState<ModalState>({ isOpen: false, preset: null });
  const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false);
  const [renameFolderState, setRenameFolderState] = useState<FolderState>({ isOpen: false, folder: null });
  const [expandedFolders, setExpandedFolders] = useState(new Set<string>());
  const [activeItem, setActiveItem] = useState<ActivePresetItem | null>(null);
  const [folderPreviewsGenerated, setFolderPreviewsGenerated] = useState<Set<string>>(new Set());
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const previewsRef = useRef(previews);
  const expandedFoldersRef = useRef(expandedFolders);
  useLayoutEffect(() => {
    previewsRef.current = previews;
    expandedFoldersRef.current = expandedFolders;
  }, [expandedFolders, previews]);
  const previewQueue = useRef<Array<PreviewQueueItem>>([]);
  const isProcessingQueue = useRef(false);
  const currentImagePathRef = useRef<string | null>(selectedImage?.path || null);

  useEffect(() => {
    const allPresetIds = new Set<string>();
    presets.forEach((item: UserPreset) => {
      if (isPresetEntry(item)) {
        allPresetIds.add(item.preset.id);
      } else if (isFolderEntry(item)) {
        item.folder.children.forEach((p: Preset) => allPresetIds.add(p.id));
      }
    });

    const currentPreviews = previewsRef.current;
    const previewsToDelete = Object.keys(currentPreviews).filter((id) => !allPresetIds.has(id));

    if (previewsToDelete.length > 0) {
      setPreviews((prev) => {
        const deletedPreviewIds = new Set(previewsToDelete);

        return Object.fromEntries(
          Object.entries(prev).filter(([id, url]) => {
            if (!deletedPreviewIds.has(id)) return true;

            if (url && url.startsWith('blob:')) {
              URL.revokeObjectURL(url);
            }
            return false;
          }),
        );
      });
    }
  }, [presets]);

  useEffect(() => {
    return () => {
      Object.values(previewsRef.current).forEach((url) => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
      previewQueue.current = [];
      isProcessingQueue.current = false;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
  );

  const { setNodeRef: setRootNodeRef, isOver: isRootOver } = useDroppable({ id: 'root' });

  const allItemsMap = useMemo(() => {
    const map = new Map<string, ActivePresetItem>();
    presets.forEach((item: UserPreset) => {
      if (isPresetEntry(item)) {
        map.set(item.preset.id, { type: PresetListType.Preset, data: item.preset });
      } else if (isFolderEntry(item)) {
        map.set(item.folder.id, { type: PresetListType.Folder, data: item.folder });
        item.folder.children.forEach((preset: Preset) =>
          map.set(preset.id, { type: PresetListType.Preset, data: preset }),
        );
      }
    });
    return map;
  }, [presets]);

  const itemParentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    presets.forEach((item: UserPreset) => {
      if (isPresetEntry(item)) {
        map.set(item.preset.id, null);
      } else if (isFolderEntry(item)) {
        map.set(item.folder.id, null);
        item.folder.children.forEach((preset: Preset) => {
          map.set(preset.id, item.folder.id);
        });
      }
    });
    return map;
  }, [presets]);

  const processPreviewQueue = useCallback(async () => {
    if (isProcessingQueue.current || previewQueue.current.length === 0) {
      return;
    }

    isProcessingQueue.current = true;
    setIsGeneratingPreviews(true);

    const pathAtStart = currentImagePathRef.current;

    while (previewQueue.current.length > 0) {
      if (pathAtStart !== currentImagePathRef.current) {
        previewQueue.current = [];
        break;
      }

      const item = previewQueue.current.shift();
      if (!item) break;
      const { preset, folderId } = item;

      if (folderId && !expandedFoldersRef.current.has(folderId)) {
        continue;
      }

      if (previewsRef.current[preset.id]) {
        continue;
      }

      try {
        const fullPresetAdjustments = { ...INITIAL_ADJUSTMENTS, ...preset.adjustments };
        const imageData: Uint8Array = await invoke(Invokes.GeneratePresetPreview, {
          jsAdjustments: fullPresetAdjustments,
        });

        if (pathAtStart !== currentImagePathRef.current) {
          previewQueue.current = [];
          break;
        }

        const blob = createBlobFromUint8Array(imageData, 'image/jpeg');
        const url = URL.createObjectURL(blob);
        setPreviews((prev: Record<string, string | null>) => {
          const oldUrl = prev[preset.id];
          if (oldUrl && oldUrl.startsWith('blob:')) {
            URL.revokeObjectURL(oldUrl);
          }
          return { ...prev, [preset.id]: url };
        });
      } catch (error) {
        console.error(`Failed to generate preview for preset ${preset.name}:`, error);
        if (pathAtStart === currentImagePathRef.current) {
          setPreviews((prev: Record<string, string | null>) => ({ ...prev, [preset.id]: null }));
        }
      }
    }

    isProcessingQueue.current = false;
    setIsGeneratingPreviews(false);
  }, []);

  const enqueuePreviews = useCallback(
    (presetsToGenerate: Array<Preset>, folderId: string | null = null) => {
      const newItems = presetsToGenerate
        .filter((preset) => !previewsRef.current[preset.id])
        .map((preset) => ({ preset, folderId }));
      if (newItems.length > 0) {
        previewQueue.current.push(...newItems);
        void processPreviewQueue();
      }
    },
    [processPreviewQueue],
  );

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
        if (!folderPreviewsGenerated.has(folderId)) {
          generateFolderPreviews(folderId);
        }
      }
      return newSet;
    });
  };

  const generateSinglePreview = useCallback(
    async (preset: Preset) => {
      if (!selectedImage?.isReady) {
        return;
      }

      setIsGeneratingPreviews(true);
      const pathAtStart = currentImagePathRef.current;

      try {
        const fullPresetAdjustments: Adjustments = { ...INITIAL_ADJUSTMENTS, ...preset.adjustments };
        const imageData: Uint8Array = await invoke(Invokes.GeneratePresetPreview, {
          jsAdjustments: fullPresetAdjustments,
        });

        if (pathAtStart !== currentImagePathRef.current) return;

        const blob = createBlobFromUint8Array(imageData, 'image/jpeg');
        const url = URL.createObjectURL(blob);

        setPreviews((prev: Record<string, string | null>) => {
          const oldUrl = prev[preset.id];
          if (oldUrl && oldUrl.startsWith('blob:')) {
            URL.revokeObjectURL(oldUrl);
          }
          return { ...prev, [preset.id]: url };
        });
      } catch (error) {
        console.error(`Failed to generate preview for preset ${preset.name}:`, error);
        if (pathAtStart === currentImagePathRef.current) {
          setPreviews((prev: Record<string, string | null>) => ({ ...prev, [preset.id]: null }));
        }
      } finally {
        if (pathAtStart === currentImagePathRef.current) {
          setIsGeneratingPreviews(false);
        }
      }
    },
    [selectedImage?.isReady],
  );

  const generateFolderPreviews = useCallback(
    (folderId: string) => {
      if (!selectedImage?.isReady) {
        return;
      }

      const folder = presets.find(
        (item: UserPreset): item is FolderEntry => isFolderEntry(item) && item.folder.id === folderId,
      );
      if (folder === undefined || folder.folder.children.length === 0) {
        return;
      }

      const presetsToGenerate = folder.folder.children.filter((preset: Preset) => !previewsRef.current[preset.id]);
      if (presetsToGenerate.length > 0) {
        enqueuePreviews(presetsToGenerate, folderId);
      }
      setFolderPreviewsGenerated((prev: Set<string>) => new Set(prev).add(folderId));
    },
    [selectedImage?.isReady, presets, enqueuePreviews],
  );

  const generateRootPreviews = useCallback(() => {
    if (!selectedImage?.isReady) {
      return;
    }

    const rootPresets = presets.filter(isPresetEntry).map((item) => item.preset);
    const presetsToGenerate = rootPresets.filter((preset) => !previewsRef.current[preset.id]);

    if (presetsToGenerate.length > 0) {
      enqueuePreviews(presetsToGenerate);
    }
  }, [selectedImage?.isReady, presets, enqueuePreviews]);

  useEffect(() => {
    const isPathChanged = selectedImage?.path !== currentImagePathRef.current;

    if (isPathChanged || !selectedImage.isReady) {
      Object.values(previewsRef.current).forEach((url) => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });

      previewsRef.current = {};
      previewQueue.current = [];

      setPreviews({});
      setFolderPreviewsGenerated(new Set<string>());

      if (isPathChanged && selectedImage?.path) {
        currentImagePathRef.current = selectedImage.path;
      }
    }

    if (activePanel === Panel.Presets && selectedImage?.isReady && presets.length > 0) {
      generateRootPreviews();
      expandedFolders.forEach((folderId: string) => {
        generateFolderPreviews(folderId);
      });
    }
  }, [
    activePanel,
    selectedImage?.isReady,
    selectedImage?.path,
    presets.length,
    generateRootPreviews,
    generateFolderPreviews,
    expandedFolders,
  ]);

  const handleApplyPreset = (preset: Preset) => {
    setAdjustments((prevAdjustments: Adjustments) => ({
      ...prevAdjustments,
      ...preset.adjustments,
    }));
  };

  const handleApplyColorStylePreset = (preset: ColorStylePreset) => {
    setAdjustments((prevAdjustments: Adjustments) => ({
      ...prevAdjustments,
      ...preset.adjustmentPatch,
    }));
  };

  const handleSaveConfiguredPreset = async (
    name: string,
    includeMasks: boolean,
    includeCropTransform: boolean,
    presetType: 'tool' | 'style',
  ) => {
    if (configureModalState.preset) {
      const updated = configurePreset(
        configureModalState.preset.id,
        name,
        includeMasks,
        includeCropTransform,
        presetType,
      );
      if (updated) {
        await generateSinglePreview(updated);
      }
    } else {
      const newPreset = addPreset(name, null, includeMasks, includeCropTransform, presetType);
      await generateSinglePreview(newPreset);
    }
    setConfigureModalState({ isOpen: false, preset: null });
  };

  const handleAddFolder = (name: string) => {
    addFolder(name);
    setIsAddFolderModalOpen(false);
  };

  const handleRenameFolderSave = (newName: string) => {
    if (renameFolderState.folder) {
      renameItem(renameFolderState.folder.id, newName);
    }
    setRenameFolderState({ isOpen: false, folder: null });
  };

  const handleDeleteItem = (id: string | null, isFolder = false) => {
    setDeletingItemId(id);
    if (!id) {
      return;
    }

    setTimeout(() => {
      deleteItem(id);
      if (isFolder) {
        setExpandedFolders((prev: Set<string>) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
        setFolderPreviewsGenerated((prev: Set<string>) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }
    }, 300);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItem(allItemsMap.get(toDragId(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    const activeId = toDragId(active.id);
    const activeParentId = itemParentMap.get(activeId);
    const activeType = getPresetDragType(active.data.current);

    if (!over) {
      if (activeParentId !== null) {
        movePreset(activeId, null, null);
      }
      return;
    }

    if (active.id === over.id) {
      return;
    }

    const overId = toDragId(over.id);
    const overParentId = itemParentMap.get(overId);
    const overType = getPresetDragType(over.data.current);

    const targetFolderId = overType === PresetListType.Folder ? overId : overParentId;

    if (activeType === PresetListType.Preset && targetFolderId) {
      if (activeParentId !== targetFolderId) {
        movePreset(activeId, targetFolderId);
        setExpandedFolders((prev: Set<string>) => new Set(prev).add(targetFolderId));
        if (!folderPreviewsGenerated.has(targetFolderId)) {
          generateFolderPreviews(targetFolderId);
        }
      } else {
        reorderItems(activeId, overId);
      }
      return;
    }

    if (activeParentId !== null && !targetFolderId) {
      movePreset(activeId, null, overId);
      return;
    }

    if (activeParentId === null && !targetFolderId) {
      reorderItems(activeId, overId);
      return;
    }
  };

  const handleImportPresets = async () => {
    try {
      const selectedPath = await openDialog({
        filters: [
          { name: t('editor.presets.dialog.allPresetFiles'), extensions: ['rrpreset', 'xmp', 'lrtemplate'] },
          { name: t('editor.presets.dialog.rapidRawPreset'), extensions: ['rrpreset'] },
          { name: t('editor.presets.dialog.legacyPreset'), extensions: ['xmp', 'lrtemplate'] },
        ],
        multiple: false,
        title: t('editor.presets.dialog.importPresetsTitle'),
      });

      if (typeof selectedPath === 'string') {
        const isLegacy =
          selectedPath.toLowerCase().endsWith('.xmp') || selectedPath.toLowerCase().endsWith('.lrtemplate');

        if (isLegacy) {
          await importLegacyPresetsFromFile(selectedPath);
        } else {
          await importPresetsFromFile(selectedPath);
        }

        setFolderPreviewsGenerated(new Set<string>());
        setPreviews({});
      }
    } catch (error) {
      console.error('Failed to import presets:', error);
    }
  };

  const handleExport = async (item: UserPreset) => {
    const isFolder = !!item.folder;
    const name = (isFolder ? item.folder?.name : item.preset?.name) ?? 'preset';
    const itemsToExport = [item];

    try {
      const filePath = await saveDialog({
        defaultPath: `${name}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_'),
        filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
        title: t('editor.presets.dialog.exportTitle', {
          type: isFolder ? t('editor.presets.types.folder') : t('editor.presets.types.preset'),
        }),
      });

      if (filePath) {
        await exportPresetsToFile(itemsToExport, filePath);
      }
    } catch (error) {
      console.error(`Failed to export ${isFolder ? PresetListType.Folder : PresetListType.Preset}:`, error);
    }
  };

  const handleExportAllPresets = async () => {
    if (presets.length === 0) {
      return;
    }
    try {
      const filePath = await saveDialog({
        defaultPath: 'all_presets.rrpreset',
        filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
        title: t('editor.presets.dialog.exportAllTitle'),
      });

      if (filePath) {
        await exportPresetsToFile(presets, filePath);
      }
    } catch (error) {
      console.error('Failed to export all presets:', error);
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => {
    event.preventDefault();
    event.stopPropagation();

    const isFolder = isFolderEntry(item);

    const options: Array<Option> = isFolder
      ? [
          {
            icon: Edit,
            label: t('editor.presets.menu.renameFolder'),
            onClick: () => {
              setRenameFolderState({ isOpen: true, folder: item.folder });
            },
          },
          {
            icon: FileDown,
            label: t('editor.presets.menu.exportFolder'),
            onClick: () => {
              void handleExport(item);
            },
          },
          { type: OPTION_SEPARATOR },
          {
            icon: Trash2,
            isDestructive: true,
            label: t('editor.presets.menu.deleteFolder'),
            onClick: () => {
              handleDeleteItem(item.folder.id, true);
            },
          },
        ]
      : [
          {
            icon: Save,
            label: t('editor.presets.menu.overwrite'),
            onClick: () => {
              const updated = overwritePreset(item.preset.id);
              if (updated) {
                void generateSinglePreview(updated);
              }
            },
          },
          {
            icon: Settings2,
            label: t('editor.presets.menu.configurePreset'),
            onClick: () => {
              setConfigureModalState({ isOpen: true, preset: item.preset });
            },
          },
          { type: OPTION_SEPARATOR },
          {
            icon: CopyPlus,
            label: t('editor.presets.menu.duplicatePreset'),
            onClick: () => {
              const duplicated = duplicatePreset(item.preset.id);
              if (duplicated) {
                void generateSinglePreview(duplicated);
              }
            },
          },
          {
            icon: FileDown,
            label: t('editor.presets.menu.exportPreset'),
            onClick: () => {
              void handleExport(item);
            },
          },
          { type: OPTION_SEPARATOR },
          {
            icon: Trash2,
            isDestructive: true,
            label: t('editor.presets.menu.deletePreset'),
            onClick: () => {
              handleDeleteItem(item.preset.id, false);
            },
          },
        ];

    showContextMenu(event.clientX, event.clientY, options);
  };

  const handleBackgroundContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
      return;
    }
    event.preventDefault();
    const options = [
      {
        icon: Plus,
        label: t('editor.presets.menu.newPreset'),
        onClick: () => {
          setConfigureModalState({ isOpen: true, preset: null });
        },
      },
      {
        icon: FolderPlus,
        label: t('editor.presets.menu.newFolder'),
        onClick: () => {
          setIsAddFolderModalOpen(true);
        },
      },
      { type: OPTION_SEPARATOR },
      {
        disabled: presets.length === 0,
        icon: SortAsc,
        label: t('editor.presets.menu.sortAll'),
        onClick: sortAllPresetsAlphabetically,
      },
    ];
    showContextMenu(event.clientX, event.clientY, options);
  };

  const folders = useMemo<Array<FolderEntry>>(() => presets.filter(isFolderEntry), [presets]);
  const rootPresets = useMemo<Array<PresetEntry>>(() => presets.filter(isPresetEntry), [presets]);
  const hasBuiltInColorStyles = BUILT_IN_COLOR_STYLE_PRESETS.length > 0;
  const userPresetCount = useMemo(
    () => rootPresets.length + folders.reduce((count, item) => count + item.folder.children.length, 0),
    [folders, rootPresets.length],
  );
  const generatedPreviewCount = useMemo(
    () => Object.values(previews).filter((url) => typeof url === 'string' && url.length > 0).length,
    [previews],
  );
  const presetCompositionItems = [
    t('editor.presets.composition.colorStyles', { count: BUILT_IN_COLOR_STYLE_PRESETS.length }),
    t('editor.presets.composition.userPresets', { count: userPresetCount }),
    t('editor.presets.composition.folders', { count: folders.length }),
    isGeneratingPreviews
      ? t('editor.presets.composition.previewsGenerating')
      : t('editor.presets.composition.previewsReady', { count: generatedPreviewCount }),
  ];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
          <UiText variant={TextVariants.title}>{t('editor.presets.title')}</UiText>
          <div className="flex items-center gap-1">
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              onClick={onNavigateToCommunity}
              data-tooltip={t('editor.presets.tooltips.explore')}
            >
              <Users size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              disabled={isLoading}
              onClick={() => {
                void handleImportPresets();
              }}
              data-tooltip={t('editor.presets.tooltips.import')}
            >
              <FileUp size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              disabled={presets.length === 0 || isLoading}
              onClick={() => {
                void handleExportAllPresets();
              }}
              data-tooltip={t('editor.presets.tooltips.export')}
            >
              <FileDown size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              disabled={isLoading}
              onClick={() => {
                setConfigureModalState({ isOpen: true, preset: null });
              }}
              data-tooltip={t('editor.presets.tooltips.saveNew')}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5 border-b border-surface px-4 py-2"
          data-testid="presets-composition-summary"
        >
          {presetCompositionItems.map((item) => (
            <UiText
              as="span"
              className="rounded bg-surface px-2 py-1"
              color={TextColors.secondary}
              data-presets-composition-item={item}
              key={item}
              variant={TextVariants.small}
            >
              {item}
            </UiText>
          ))}
        </div>

        <div
          className={`grow overflow-y-auto p-4 space-y-2 rounded-lg transition-colors ${
            isRootOver ? 'bg-surface-hover' : ''
          }`}
          onContextMenu={handleBackgroundContextMenu}
          ref={setRootNodeRef}
        >
          {isLoading && presets.length === 0 && (
            <UiText
              as="div"
              variant={TextVariants.heading}
              color={TextColors.secondary}
              weight={TextWeights.normal}
              className="text-center mt-4"
            >
              <Loader2 size={14} className="animate-spin inline-block mr-2" /> {t('editor.presets.status.loading')}
            </UiText>
          )}
          {!isLoading && presets.length === 0 && !hasBuiltInColorStyles ? (
            <div className="text-center text-text-secondary flex flex-col items-center gap-4 pt-4">
              <UiText className="max-w-xs">{t('editor.presets.status.empty')}</UiText>
              <Button variant="secondary" onClick={onNavigateToCommunity}>
                <Users size={16} className="mr-2" />
                {t('editor.presets.status.getCommunity')}
              </Button>
            </div>
          ) : (
            <>
              <section className="space-y-2 pb-2" aria-label={t('editor.presets.colorStyles.title')}>
                <div className="flex items-center justify-between gap-2">
                  <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
                    {t('editor.presets.colorStyles.title')}
                  </UiText>
                  <UiText variant={TextVariants.small} className="tabular-nums text-text-secondary">
                    {t('editor.presets.colorStyles.count', { count: BUILT_IN_COLOR_STYLE_PRESETS.length })}
                  </UiText>
                </div>
                <div className="grid gap-2">
                  {BUILT_IN_COLOR_STYLE_PRESETS.map((preset) => {
                    const isDefaultPreset = preset.id === COLOR_STYLE_PRESET_CATALOG.defaultPresetId;

                    return (
                      <button
                        aria-label={t('editor.presets.colorStyles.applyLabel', { name: preset.name })}
                        className="rounded-md border border-surface bg-bg-secondary p-2 text-left transition-colors hover:bg-surface"
                        data-tooltip={preset.description}
                        key={preset.id}
                        onClick={() => {
                          handleApplyColorStylePreset(preset);
                        }}
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <UiText className="truncate" weight={TextWeights.medium}>
                              {preset.name}
                            </UiText>
                            {isDefaultPreset && (
                              <UiText
                                className="shrink-0 rounded border border-accent/40 px-1 text-accent"
                                data-testid="color-style-default-preset-badge"
                                variant={TextVariants.small}
                              >
                                {t('editor.presets.colorStyles.defaultBadge')}
                              </UiText>
                            )}
                          </span>
                          <UiText
                            variant={TextVariants.small}
                            className="uppercase tracking-normal text-text-secondary"
                          >
                            {preset.category.replaceAll('_', ' ')}
                          </UiText>
                        </span>
                        <UiText variant={TextVariants.small} className="mt-1 block text-text-secondary">
                          {preset.previewTags.join(' / ')}
                        </UiText>
                        <UiText
                          as="span"
                          variant={TextVariants.small}
                          className="mt-2 inline-flex rounded border border-border-color px-1.5 py-0.5 text-[10px] text-text-secondary"
                          data-testid={`color-style-adjustment-count-${preset.id}`}
                        >
                          {t('editor.presets.colorStyles.adjustmentCoverage', {
                            count: getColorStyleAdjustmentCount(preset),
                          })}
                        </UiText>
                      </button>
                    );
                  })}
                </div>
              </section>
              <AnimatePresence>
                {folders
                  .filter((item) => item.folder.id !== deletingItemId)
                  .map((item, index: number) => (
                    <motion.div
                      animate="visible"
                      custom={index}
                      exit="exit"
                      initial="hidden"
                      key={item.folder.id}
                      layout="position"
                      variants={itemVariants}
                    >
                      <DroppableFolderItem
                        folder={item.folder}
                        isExpanded={expandedFolders.has(item.folder.id)}
                        onContextMenu={(e) => {
                          handleContextMenu(e, item);
                        }}
                        onToggle={toggleFolder}
                      >
                        <AnimatePresence>
                          {item.folder.children
                            .filter((preset: Preset) => preset.id !== deletingItemId)
                            .map((preset: Preset) => (
                              <motion.div
                                exit={{ opacity: 0, x: -15, transition: { duration: 0.2 } }}
                                key={preset.id}
                                layout="position"
                              >
                                <DraggablePresetItem
                                  isGeneratingPreviews={isGeneratingPreviews}
                                  onApply={handleApplyPreset}
                                  onContextMenu={(e) => {
                                    handleContextMenu(e, { preset });
                                  }}
                                  preset={preset}
                                  previewUrl={previews[preset.id] || ''}
                                />
                              </motion.div>
                            ))}
                        </AnimatePresence>
                      </DroppableFolderItem>
                    </motion.div>
                  ))}
              </AnimatePresence>
              <AnimatePresence>
                {rootPresets
                  .filter((item) => item.preset.id !== deletingItemId)
                  .map((item, index: number) => (
                    <motion.div
                      animate="visible"
                      custom={folders.length + index}
                      exit="exit"
                      initial="hidden"
                      key={item.preset.id}
                      layout="position"
                      variants={itemVariants}
                    >
                      <DraggablePresetItem
                        isGeneratingPreviews={isGeneratingPreviews}
                        onApply={handleApplyPreset}
                        onContextMenu={(e) => {
                          handleContextMenu(e, item);
                        }}
                        preset={item.preset}
                        previewUrl={previews[item.preset.id] || ''}
                      />
                    </motion.div>
                  ))}
              </AnimatePresence>
            </>
          )}
        </div>

        <ConfigurePresetModal
          isOpen={configureModalState.isOpen}
          initialPreset={configureModalState.preset}
          onClose={() => {
            setConfigureModalState({ isOpen: false, preset: null });
          }}
          onSave={(name, description, isFavorite, tags) => {
            void handleSaveConfiguredPreset(name, description, isFavorite, tags);
          }}
        />
        <CreateFolderModal
          isOpen={isAddFolderModalOpen}
          onClose={() => {
            setIsAddFolderModalOpen(false);
          }}
          onSave={handleAddFolder}
        />
        <RenameFolderModal
          currentName={renameFolderState.folder?.name ?? ''}
          isOpen={renameFolderState.isOpen}
          onClose={() => {
            setRenameFolderState({ isOpen: false, folder: null });
          }}
          onSave={handleRenameFolderSave}
        />
      </div>
      <DragOverlay>
        {activeItem ? (
          activeItem.type === PresetListType.Preset ? (
            <PresetItemDisplay
              isGeneratingPreviews={false}
              preset={activeItem.data}
              previewUrl={previews[activeItem.data.id] || ''}
            />
          ) : (
            <FolderItemDisplay folder={activeItem.data} />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default PresetsPanel;
