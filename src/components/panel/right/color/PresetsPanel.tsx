import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import cx from 'clsx';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CopyPlus,
  Eye,
  FileDown,
  FileUp,
  Folder,
  FolderPlus,
  Grid2X2,
  GripVertical,
  ImageOff,
  List,
  Loader2,
  MoreHorizontal,
  Palette,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  SortAsc,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { PresetListType, type UserPreset, usePresets } from '../../../../hooks/editor/usePresets';
import type { ColorStylePreset } from '../../../../schemas/color/colorStylePresetSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useUIStore } from '../../../../store/useUIStore';
import { Invokes } from '../../../../tauri/commands';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../../utils/adjustments';
import { createBlobFromUint8Array } from '../../../../utils/blobUtils';
import {
  BUILT_IN_COLOR_STYLE_PRESETS,
  COLOR_STYLE_PRESET_CATALOG,
} from '../../../../utils/color/style/colorStylePresetCatalog';
import ConfigurePresetModal from '../../../modals/library/ConfigurePresetModal';
import CreateFolderModal from '../../../modals/library/CreateFolderModal';
import RenameFolderModal from '../../../modals/library/RenameFolderModal';
import {
  OPTION_SEPARATOR,
  type Option,
  Panel,
  type Preset,
  type Folder as PresetFolderBase,
} from '../../../ui/AppProperties';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import InspectorPanelFrame from '../inspector/InspectorPanelFrame';

interface PresetsPanelProps {
  placement?: 'right-panel' | 'sidebar';
  onNavigateToCommunity: () => void;
}

interface ConfigureModalState {
  isOpen: boolean;
  preset: Preset | null;
}

interface FolderModalState {
  folder: PresetFolder | null;
  isOpen: boolean;
}

interface PreviewQueueItem {
  folderId: string | null;
  preset: Preset;
}

type PresetFolder = Omit<PresetFolderBase, 'children' | 'id' | 'name'> & {
  children: Preset[];
  id: string;
  name: string;
};
type PresetEntry = UserPreset & { folder?: undefined; preset: Preset };
type FolderEntry = UserPreset & { folder: PresetFolder; preset?: undefined };
type PresetContextItem = FolderEntry | PresetEntry;
type DiscoveryFilter = 'all' | 'style' | 'tool';
type DiscoverySort = 'library' | 'name';
type DiscoveryDensity = 'list' | 'grid';

const isPresetEntry = (item: UserPreset): item is PresetEntry => item.preset !== undefined;
const isFolderEntry = (item: UserPreset): item is FolderEntry => item.folder !== undefined;
const isPresetValid = (preset: Preset): boolean =>
  preset.id.trim().length > 0 &&
  preset.name.trim().length > 0 &&
  typeof preset.adjustments === 'object' &&
  preset.adjustments !== null;
const dragId = (value: DragStartEvent['active']['id']): string => String(value);
const compareNames = (first: { name: string }, second: { name: string }) =>
  first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' });

function areAdjustmentsEqual(first: Adjustments, second: Adjustments): boolean {
  const firstKeys = Object.keys(first) as Array<keyof Adjustments>;
  const secondKeys = Object.keys(second) as Array<keyof Adjustments>;
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every((key) => JSON.stringify(first[key]) === JSON.stringify(second[key]))
  );
}

function collectPresetNames(items: UserPreset[]): string[] {
  return items.flatMap((item) => {
    if (isPresetEntry(item)) return [item.preset.name];
    if (isFolderEntry(item)) return [item.folder.name, ...item.folder.children.map((preset) => preset.name)];
    return [];
  });
}

function PresetThumbnail({
  preset,
  previewUrl,
  previewState,
}: {
  preset: Preset;
  previewState: 'failed' | 'idle' | 'loading' | 'ready';
  previewUrl?: string | undefined;
}) {
  if (previewUrl) {
    return <img alt={`${preset.name} preview`} className="h-full w-full object-cover" src={previewUrl} />;
  }

  if (previewState === 'failed') {
    return <ImageOff aria-label="Preview unavailable" className="text-editor-danger" size={16} />;
  }

  if (previewState === 'loading') {
    return <Loader2 aria-label="Preview loading" className="animate-spin text-text-secondary" size={16} />;
  }

  return <Palette aria-label="Preview not generated" className="text-text-secondary" size={16} />;
}

interface PresetResultItemProps {
  appliedId: string | null;
  density: DiscoveryDensity;
  editedAfterApply: boolean;
  isSelected: boolean;
  isPreviewed: boolean;
  onApply: (preset: Preset) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, preset: Preset) => void;
  onPreview: (preset: Preset | null) => void;
  onSelect: (preset: Preset) => void;
  preset: Preset;
  presetButtonRef: (node: HTMLButtonElement | null) => void;
  previewState: 'failed' | 'idle' | 'loading' | 'ready';
  previewUrl?: string | undefined;
}

function PresetResultItem({
  appliedId,
  density,
  editedAfterApply,
  isSelected,
  isPreviewed,
  onApply,
  onContextMenu,
  onKeyDown,
  onPreview,
  onSelect,
  preset,
  presetButtonRef,
  previewState,
  previewUrl,
}: PresetResultItemProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: preset.id,
    data: { type: PresetListType.Preset },
  });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: preset.id,
    data: { type: PresetListType.Preset },
  });
  const valid = isPresetValid(preset);
  const isApplied = appliedId === preset.id;
  const isTool = preset.presetType === 'tool';
  const setCombinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );

  return (
    <div
      className={cx(
        'group relative min-w-0 border border-editor-border bg-editor-panel transition-colors',
        density === 'grid' ? 'rounded p-1' : 'rounded-sm',
        isSelected && 'border-editor-focus-ring',
        isPreviewed && 'outline outline-1 outline-offset-[-1px] outline-editor-primary-active',
        isOver && 'bg-editor-selected-quiet',
        isDragging && 'opacity-40',
      )}
      data-applied={isApplied ? 'true' : 'false'}
      data-edited-after-apply={isApplied && editedAfterApply ? 'true' : 'false'}
      data-preview-state={previewState}
      data-selected={isSelected ? 'true' : 'false'}
      data-testid={`preset-result-${preset.id}`}
      onContextMenu={(event) => onContextMenu(event, { preset })}
      ref={setCombinedRef}
    >
      <button
        aria-describedby={`preset-state-${preset.id}`}
        aria-label={t('editor.presets.discovery.selectLabel', { name: preset.name })}
        className={cx(
          'flex min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
          density === 'grid' ? 'w-full flex-col gap-1.5 rounded p-1.5' : 'w-full items-center gap-2 px-2 py-1.5',
        )}
        onBlur={() => onPreview(null)}
        onClick={() => onSelect(preset)}
        onFocus={() => onPreview(preset)}
        onKeyDown={(event) => onKeyDown(event, preset)}
        onMouseEnter={() => onPreview(preset)}
        onMouseLeave={() => onPreview(null)}
        ref={presetButtonRef}
        type="button"
      >
        <span
          className={cx(
            'flex shrink-0 items-center justify-center overflow-hidden border border-editor-border bg-editor-panel-well',
            density === 'grid' ? 'aspect-[4/3] w-full rounded-sm' : 'h-11 w-14 rounded-sm',
          )}
        >
          <PresetThumbnail preset={preset} previewState={previewState} previewUrl={previewUrl} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {isTool ? <Wrench aria-hidden="true" size={12} /> : <Palette aria-hidden="true" size={12} />}
            <span className="truncate text-[12px] font-medium leading-4 text-text-primary" title={preset.name}>
              {preset.name}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-text-secondary">
            {isTool ? t('editor.presets.types.tool') : t('editor.presets.types.style')}
            {previewState === 'failed' ? <span>{t('editor.presets.states.previewFailed')}</span> : null}
            {!valid ? <span>{t('editor.presets.states.invalid')}</span> : null}
          </span>
        </span>
      </button>
      <span className="sr-only" id={`preset-state-${preset.id}`}>
        {isApplied
          ? editedAfterApply
            ? t('editor.presets.states.appliedEdited')
            : t('editor.presets.states.applied')
          : isPreviewed
            ? t('editor.presets.states.previewing')
            : isSelected
              ? t('editor.presets.states.selected')
              : t('editor.presets.states.available')}
      </span>
      <div
        className={cx(
          'absolute flex items-center gap-0.5',
          density === 'grid' ? 'right-1 top-1' : 'right-1 top-1/2 -translate-y-1/2',
        )}
      >
        {isApplied ? (
          <span
            aria-label={
              editedAfterApply ? t('editor.presets.states.appliedEdited') : t('editor.presets.states.applied')
            }
            className="flex h-5 w-5 items-center justify-center text-text-primary"
            title={editedAfterApply ? t('editor.presets.states.appliedEdited') : t('editor.presets.states.applied')}
          >
            {editedAfterApply ? <PencilLine size={13} /> : <CheckCircle2 size={13} />}
          </span>
        ) : null}
        <button
          aria-label={t('editor.presets.applyPresetLabel', { name: preset.name })}
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary opacity-0 transition-opacity hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-45"
          data-tooltip={t('editor.presets.applyPresetLabel', { name: preset.name })}
          disabled={!valid}
          onClick={(event) => {
            event.stopPropagation();
            onApply(preset);
          }}
          type="button"
        >
          <Check size={13} />
        </button>
        <button
          aria-label={t('editor.presets.discovery.moveLabel', { name: preset.name })}
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-text-tertiary hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring active:cursor-grabbing"
          data-tooltip={t('editor.presets.discovery.moveLabel', { name: preset.name })}
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={13} />
        </button>
      </div>
    </div>
  );
}

function FolderResult({
  children,
  folder,
  forceExpanded,
  isExpanded,
  onContextMenu,
  onToggle,
}: {
  children: ReactNode;
  folder: PresetFolder;
  forceExpanded: boolean;
  isExpanded: boolean;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: folder.id,
    data: { type: PresetListType.Folder },
  });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: folder.id,
    data: { type: PresetListType.Folder },
  });
  const shown = forceExpanded || isExpanded;

  return (
    <section
      aria-label={folder.name}
      className={cx(
        'border-b border-editor-border py-1',
        isOver && 'bg-editor-selected-quiet',
        isDragging && 'opacity-40',
      )}
      onContextMenu={(event) => onContextMenu(event, { folder })}
      ref={setDroppableNodeRef}
    >
      <div className="flex min-w-0 items-center gap-1 px-1">
        <button
          aria-expanded={shown}
          aria-label={t('editor.presets.discovery.toggleFolder', { name: folder.name })}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[11px] font-semibold leading-4 text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
          data-tooltip={t('editor.presets.discovery.toggleFolder', { name: folder.name })}
          onClick={() => onToggle(folder.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' && !shown) onToggle(folder.id);
            if (event.key === 'ArrowLeft' && shown && !forceExpanded) onToggle(folder.id);
          }}
          type="button"
        >
          {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} />
          <span className="truncate" title={folder.name}>
            {folder.name}
          </span>
          <span className="ml-auto text-[10px] font-normal text-text-secondary">{folder.children.length}</span>
        </button>
        <button
          aria-label={t('editor.presets.discovery.moveFolderLabel', { name: folder.name })}
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-text-tertiary hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring active:cursor-grabbing"
          data-tooltip={t('editor.presets.discovery.moveFolderLabel', { name: folder.name })}
          ref={setDraggableNodeRef}
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={13} />
        </button>
      </div>
      {shown ? <div className="ml-3 grid gap-1 border-l border-editor-border px-1.5 py-1">{children}</div> : null}
    </section>
  );
}

export function PresetsPanel({ onNavigateToCommunity, placement = 'right-panel' }: PresetsPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const appliedPreset = useEditorStore((state) => state.presetApplication);
  const setAppliedPreset = useEditorStore((state) => state.setPresetApplication);
  const activePanel = useUIStore((state) => state.activeRightPanel);
  const { setAdjustments } = useEditorActions();
  const {
    addFolder,
    addPreset,
    configurePreset,
    deleteItem,
    duplicatePreset,
    exportPresetsToFile,
    importLegacyPresetsFromFile,
    importPresetsFromFile,
    isLoading,
    loadError,
    movePreset,
    overwritePreset,
    presets,
    refreshPresets,
    renameItem,
    reorderItems,
    sortAllPresetsAlphabetically,
    storageError,
  } = usePresets(adjustments);
  const { showContextMenu } = useContextMenu();
  const density = professionalInspectorDensityTokens;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DiscoveryFilter>('all');
  const [sort, setSort] = useState<DiscoverySort>('library');
  const [resultDensity, setResultDensity] = useState<DiscoveryDensity>('list');
  const [expandedFolders, setExpandedFolders] = useState(new Set<string>());
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [previewStates, setPreviewStates] = useState<Record<string, 'failed' | 'idle' | 'loading' | 'ready'>>({});
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [previewedPresetId, setPreviewedPresetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [importConflictCount, setImportConflictCount] = useState(0);
  const [configureModalState, setConfigureModalState] = useState<ConfigureModalState>({ isOpen: false, preset: null });
  const [isAddFolderModalOpen, setIsAddFolderModalOpen] = useState(false);
  const [renameFolderState, setRenameFolderState] = useState<FolderModalState>({ folder: null, isOpen: false });
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const presetButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewsRef = useRef(previews);
  const previewQueue = useRef<PreviewQueueItem[]>([]);
  const isProcessingQueue = useRef(false);
  const currentImagePathRef = useRef<string | null>(selectedImage?.path ?? null);

  useLayoutEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const { setNodeRef: setRootDropRef, isOver: isRootOver } = useDroppable({ id: 'preset-root' });

  const folders = useMemo(() => presets.filter(isFolderEntry), [presets]);
  const rootPresets = useMemo(() => presets.filter(isPresetEntry), [presets]);
  const allPresetMap = useMemo(() => {
    const entries = new Map<string, Preset>();
    rootPresets.forEach((entry) => entries.set(entry.preset.id, entry.preset));
    folders.forEach((entry) => entry.folder.children.forEach((preset) => entries.set(preset.id, preset)));
    return entries;
  }, [folders, rootPresets]);
  const parentByPresetId = useMemo(() => {
    const parents = new Map<string, string | null>();
    rootPresets.forEach((entry) => parents.set(entry.preset.id, null));
    folders.forEach((entry) => {
      parents.set(entry.folder.id, null);
      entry.folder.children.forEach((preset) => parents.set(preset.id, entry.folder.id));
    });
    return parents;
  }, [folders, rootPresets]);
  const queryText = query.trim().toLocaleLowerCase();
  const matchesPreset = useCallback(
    (preset: Preset) =>
      (filter === 'all' || (preset.presetType ?? 'style') === filter) &&
      (queryText.length === 0 || preset.name.toLocaleLowerCase().includes(queryText)),
    [filter, queryText],
  );
  const displayFolders = useMemo(() => {
    const matching = folders.flatMap((entry) => {
      const folderMatches = queryText.length > 0 && entry.folder.name.toLocaleLowerCase().includes(queryText);
      const children = entry.folder.children.filter((preset) => matchesPreset(preset) || folderMatches);
      return children.length > 0 || folderMatches ? [{ ...entry, folder: { ...entry.folder, children } }] : [];
    });
    return sort === 'name'
      ? [...matching].sort((first, second) => compareNames(first.folder, second.folder))
      : matching;
  }, [folders, matchesPreset, queryText, sort]);
  const displayRootPresets = useMemo(() => {
    const matching = rootPresets.filter((entry) => matchesPreset(entry.preset));
    return sort === 'name'
      ? [...matching].sort((first, second) => compareNames(first.preset, second.preset))
      : matching;
  }, [matchesPreset, rootPresets, sort]);
  const displayBuiltInStyles = useMemo(
    () =>
      BUILT_IN_COLOR_STYLE_PRESETS.filter(
        (preset) =>
          filter !== 'tool' &&
          (queryText.length === 0 ||
            `${preset.name} ${preset.category} ${preset.description}`.toLocaleLowerCase().includes(queryText)),
      ),
    [filter, queryText],
  );
  const visiblePresetIds = useMemo(
    () => [
      ...displayFolders.flatMap((entry) => entry.folder.children.map((preset) => preset.id)),
      ...displayRootPresets.map((entry) => entry.preset.id),
    ],
    [displayFolders, displayRootPresets],
  );
  const isEditedAfterApply = useMemo(
    () =>
      appliedPreset !== null &&
      appliedPreset.imagePath === (selectedImage?.path ?? null) &&
      !areAdjustmentsEqual(adjustments, appliedPreset.expected),
    [adjustments, appliedPreset, selectedImage?.path],
  );
  const previewedPreset = previewedPresetId ? (allPresetMap.get(previewedPresetId) ?? null) : null;
  const hasUserPresets = rootPresets.length > 0 || folders.some((entry) => entry.folder.children.length > 0);
  const hasDiscoveryResults =
    displayBuiltInStyles.length > 0 || displayFolders.length > 0 || displayRootPresets.length > 0;

  const clearPreviews = useCallback(() => {
    Object.values(previewsRef.current).forEach((url) => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    previewsRef.current = {};
    previewQueue.current = [];
    setPreviews({});
    setPreviewStates({});
  }, []);

  const processPreviewQueue = useCallback(async () => {
    if (isProcessingQueue.current || previewQueue.current.length === 0) return;
    isProcessingQueue.current = true;
    setIsGeneratingPreviews(true);
    const imagePathAtStart = currentImagePathRef.current;

    while (previewQueue.current.length > 0) {
      if (imagePathAtStart !== currentImagePathRef.current) break;
      const item = previewQueue.current.shift();
      if (!item || previewsRef.current[item.preset.id] !== undefined) continue;

      try {
        const imageData = await invoke<Uint8Array>(Invokes.GeneratePresetPreview, {
          jsAdjustments: { ...INITIAL_ADJUSTMENTS, ...item.preset.adjustments },
        });
        if (imagePathAtStart !== currentImagePathRef.current) break;
        const previewUrl = URL.createObjectURL(createBlobFromUint8Array(imageData, 'image/jpeg'));
        setPreviews((current) => {
          const previous = current[item.preset.id];
          if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
          return { ...current, [item.preset.id]: previewUrl };
        });
        setPreviewStates((current) => ({ ...current, [item.preset.id]: 'ready' }));
      } catch (error) {
        console.error(`Failed to generate preview for preset ${item.preset.name}:`, error);
        if (imagePathAtStart === currentImagePathRef.current) {
          setPreviews((current) => ({ ...current, [item.preset.id]: null }));
          setPreviewStates((current) => ({ ...current, [item.preset.id]: 'failed' }));
        }
      }
    }

    isProcessingQueue.current = false;
    setIsGeneratingPreviews(false);
  }, []);

  const enqueuePreviews = useCallback(
    (items: PreviewQueueItem[]) => {
      const newItems = items.filter((item) => previewsRef.current[item.preset.id] === undefined);
      if (newItems.length === 0) return;
      previewQueue.current.push(...newItems);
      setPreviewStates((current) => ({
        ...current,
        ...Object.fromEntries(newItems.map((item) => [item.preset.id, 'loading' as const])),
      }));
      void processPreviewQueue();
    },
    [processPreviewQueue],
  );

  useEffect(() => {
    const hasChangedImage = selectedImage?.path !== currentImagePathRef.current;
    if (hasChangedImage) {
      currentImagePathRef.current = selectedImage?.path ?? null;
      clearPreviews();
    }
    const isSurfaceActive = placement === 'sidebar' || activePanel === Panel.Presets;
    if (!isSurfaceActive || !selectedImage?.isReady) return;
    enqueuePreviews(rootPresets.map((entry) => ({ folderId: null, preset: entry.preset })));
    folders
      .filter((entry) => expandedFolders.has(entry.folder.id) || queryText.length > 0)
      .forEach((entry) =>
        enqueuePreviews(entry.folder.children.map((preset) => ({ folderId: entry.folder.id, preset }))),
      );
  }, [
    activePanel,
    clearPreviews,
    enqueuePreviews,
    expandedFolders,
    folders,
    placement,
    queryText,
    rootPresets,
    selectedImage?.isReady,
    selectedImage?.path,
  ]);

  useEffect(
    () => () => {
      clearPreviews();
      isProcessingQueue.current = false;
    },
    [clearPreviews],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (preset: Preset) => {
      if (!isPresetValid(preset)) {
        setActionError(t('editor.presets.errors.invalidPreset'));
        return;
      }
      try {
        const before = structuredClone(adjustments);
        const expected = { ...adjustments, ...preset.adjustments };
        setAdjustments(() => expected);
        setActionError(null);
        setSelectedPresetId(preset.id);
        setAppliedPreset({
          before,
          expected,
          id: preset.id,
          imagePath: selectedImage?.path ?? null,
          name: preset.name,
        });
      } catch (error) {
        console.error(`Failed to apply preset ${preset.name}:`, error);
        setActionError(t('editor.presets.errors.applyFailed'));
      }
    },
    [adjustments, selectedImage?.path, setAdjustments, setAppliedPreset, t],
  );

  const applyColorStyle = useCallback(
    (preset: ColorStylePreset) => {
      try {
        const before = structuredClone(adjustments);
        const expected = { ...adjustments, ...preset.adjustmentPatch };
        setAdjustments(() => expected);
        setActionError(null);
        setAppliedPreset({
          before,
          expected,
          id: preset.id,
          imagePath: selectedImage?.path ?? null,
          name: preset.name,
        });
      } catch (error) {
        console.error(`Failed to apply color style ${preset.name}:`, error);
        setActionError(t('editor.presets.errors.applyFailed'));
      }
    },
    [adjustments, selectedImage?.path, setAdjustments, setAppliedPreset, t],
  );

  const revertAppliedPreset = useCallback(() => {
    if (!appliedPreset) return;
    setAdjustments(() => structuredClone(appliedPreset.before));
    setAppliedPreset(null);
    setActionError(null);
  }, [appliedPreset, setAdjustments]);

  const handlePresetKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, preset: Preset) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyPreset(preset);
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        setSelectedPresetId(preset.id);
        setPreviewedPresetId(preset.id);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const index = visiblePresetIds.indexOf(preset.id);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextId = visiblePresetIds[index + direction];
      if (nextId) presetButtonRefs.current.get(nextId)?.focus();
    },
    [applyPreset, visiblePresetIds],
  );

  const handleSaveConfiguredPreset = useCallback(
    async (name: string, includeMasks: boolean, includeCropTransform: boolean, presetType: 'style' | 'tool') => {
      try {
        const preset = configureModalState.preset
          ? configurePreset(configureModalState.preset.id, name, includeMasks, includeCropTransform, presetType)
          : addPreset(name, null, includeMasks, includeCropTransform, presetType);
        if (preset && selectedImage?.isReady) enqueuePreviews([{ folderId: null, preset }]);
        setConfigureModalState({ isOpen: false, preset: null });
      } catch (error) {
        console.error('Failed to save preset:', error);
        setActionError(t('editor.presets.errors.saveFailed'));
      }
    },
    [addPreset, configureModalState.preset, configurePreset, enqueuePreviews, selectedImage?.isReady, t],
  );

  const handleImportPresets = useCallback(async () => {
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
      if (typeof selectedPath !== 'string') return;

      const previousNames = new Set(collectPresetNames(presets));
      const imported =
        selectedPath.toLocaleLowerCase().endsWith('.xmp') || selectedPath.toLocaleLowerCase().endsWith('.lrtemplate')
          ? await importLegacyPresetsFromFile(selectedPath)
          : await importPresetsFromFile(selectedPath);
      const conflicts = collectPresetNames(imported ?? []).filter((name) => {
        const suffix = name.match(/^(.*) \((\d+)\)$/u);
        return suffix?.[1] !== undefined && previousNames.has(suffix[1]);
      });
      setImportConflictCount(conflicts.length);
      setActionError(null);
      clearPreviews();
    } catch (error) {
      console.error('Failed to import presets:', error);
      setActionError(t('editor.presets.errors.importFailed'));
    }
  }, [clearPreviews, importLegacyPresetsFromFile, importPresetsFromFile, presets, t]);

  const handleExport = useCallback(
    async (item: UserPreset) => {
      const isFolder = isFolderEntry(item);
      const name = isFolder ? item.folder.name : (item.preset?.name ?? 'preset');
      try {
        const filePath = await saveDialog({
          defaultPath: `${name}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_'),
          filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
          title: t('editor.presets.dialog.exportTitle', {
            type: isFolder ? t('editor.presets.types.folder') : t('editor.presets.types.preset'),
          }),
        });
        if (filePath) await exportPresetsToFile([item], filePath);
      } catch (error) {
        console.error('Failed to export preset:', error);
        setActionError(t('editor.presets.errors.exportFailed'));
      }
    },
    [exportPresetsToFile, t],
  );

  const handleExportAll = useCallback(async () => {
    if (presets.length === 0) return;
    try {
      const filePath = await saveDialog({
        defaultPath: 'all_presets.rrpreset',
        filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
        title: t('editor.presets.dialog.exportAllTitle'),
      });
      if (filePath) await exportPresetsToFile(presets, filePath);
    } catch (error) {
      console.error('Failed to export presets:', error);
      setActionError(t('editor.presets.errors.exportFailed'));
    }
  }, [exportPresetsToFile, presets, t]);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, item: PresetContextItem) => {
      event.preventDefault();
      const options: Option[] = isFolderEntry(item)
        ? [
            {
              icon: Settings2,
              label: t('editor.presets.menu.renameFolder'),
              onClick: () => setRenameFolderState({ folder: item.folder, isOpen: true }),
            },
            { icon: FileDown, label: t('editor.presets.menu.exportFolder'), onClick: () => void handleExport(item) },
            { type: OPTION_SEPARATOR },
            {
              icon: Trash2,
              isDestructive: true,
              label: t('editor.presets.menu.deleteFolder'),
              onClick: () => deleteItem(item.folder.id),
            },
          ]
        : [
            { icon: Save, label: t('editor.presets.menu.overwrite'), onClick: () => overwritePreset(item.preset.id) },
            {
              icon: Settings2,
              label: t('editor.presets.menu.configurePreset'),
              onClick: () => setConfigureModalState({ isOpen: true, preset: item.preset }),
            },
            {
              icon: CopyPlus,
              label: t('editor.presets.menu.duplicatePreset'),
              onClick: () => duplicatePreset(item.preset.id),
            },
            { icon: FileDown, label: t('editor.presets.menu.exportPreset'), onClick: () => void handleExport(item) },
            { type: OPTION_SEPARATOR },
            {
              icon: Trash2,
              isDestructive: true,
              label: t('editor.presets.menu.deletePreset'),
              onClick: () => deleteItem(item.preset.id),
            },
          ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [deleteItem, duplicatePreset, handleExport, overwritePreset, showContextMenu, t],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const activeId = dragId(event.active.id);
      const overId = event.over ? dragId(event.over.id) : null;
      if (!overId || activeId === overId) return;
      const activeParent = parentByPresetId.get(activeId);
      const overParent = parentByPresetId.get(overId);
      const activeIsFolder = folders.some((entry) => entry.folder.id === activeId);
      const targetFolder = folders.some((entry) => entry.folder.id === overId) ? overId : overParent;
      if (!activeIsFolder && targetFolder && activeParent !== targetFolder) {
        movePreset(activeId, targetFolder);
        setExpandedFolders((current) => new Set(current).add(targetFolder));
      } else if (!activeIsFolder && activeParent === targetFolder) {
        reorderItems(activeId, overId);
      } else if (!activeIsFolder && activeParent !== null && targetFolder === null) {
        movePreset(activeId, null, overId);
      } else if (activeParent === null && targetFolder === null) {
        reorderItems(activeId, overId);
      }
    },
    [folders, movePreset, parentByPresetId, reorderItems],
  );

  const selectedPreset = selectedPresetId ? (allPresetMap.get(selectedPresetId) ?? null) : null;
  const notice = loadError
    ? { kind: 'error' as const, label: t('editor.presets.errors.loadFailed') }
    : storageError
      ? { kind: 'error' as const, label: t('editor.presets.errors.storageFailed') }
      : isLoading
        ? { kind: 'loading' as const, label: t('editor.presets.status.loading') }
        : undefined;
  const status =
    actionError || loadError || storageError
      ? { label: t('editor.presets.states.error'), tone: 'danger' as const }
      : appliedPreset
        ? {
            label: isEditedAfterApply ? t('editor.presets.states.appliedEdited') : t('editor.presets.states.applied'),
            tone: isEditedAfterApply ? ('warning' as const) : ('success' as const),
          }
        : previewedPreset
          ? { label: t('editor.presets.states.previewing'), tone: 'info' as const }
          : { label: t('editor.presets.states.ready'), tone: 'neutral' as const };

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      onDragStart={(event) => setActiveDragId(dragId(event.active.id))}
    >
      <InspectorPanelFrame
        actions={
          <>
            <button
              aria-label={t('editor.presets.tooltips.explore')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.tooltips.explore')}
              onClick={onNavigateToCommunity}
              type="button"
            >
              <Users size={14} />
            </button>
            <button
              aria-label={t('editor.presets.tooltips.import')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.tooltips.import')}
              disabled={isLoading}
              onClick={() => void handleImportPresets()}
              type="button"
            >
              <FileUp size={14} />
            </button>
            <button
              aria-label={t('editor.presets.tooltips.export')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.tooltips.export')}
              disabled={presets.length === 0 || isLoading}
              onClick={() => void handleExportAll()}
              type="button"
            >
              <FileDown size={14} />
            </button>
            <button
              aria-label={t('editor.presets.tooltips.saveNew')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.tooltips.saveNew')}
              disabled={isLoading}
              onClick={() => setConfigureModalState({ isOpen: true, preset: null })}
              type="button"
            >
              <Plus size={14} />
            </button>
          </>
        }
        icon={SlidersHorizontal}
        label={t('editor.presets.title')}
        notice={notice}
        status={status}
        testId="presets-panel"
        variant={placement === 'sidebar' ? 'section' : 'panel'}
      >
        <div
          className="border-b border-editor-border px-2.5 py-2"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
              event.preventDefault();
              searchInputRef.current?.focus();
            }
            if (event.key === 'Escape' && previewedPresetId) setPreviewedPresetId(null);
          }}
        >
          <label className="relative block">
            <span className="sr-only">{t('editor.presets.discovery.searchLabel')}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
              size={13}
            />
            <input
              className="h-7 w-full rounded-sm border border-editor-border bg-editor-panel-well pl-7 pr-2 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary focus:ring-1 focus:ring-editor-focus-ring"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('editor.presets.discovery.searchPlaceholder')}
              ref={searchInputRef}
              type="search"
              value={query}
            />
          </label>
          <div className="mt-1.5 flex min-w-0 items-center gap-1">
            <select
              aria-label={t('editor.presets.discovery.filterLabel')}
              className="h-6 min-w-0 flex-1 rounded-sm border border-editor-border bg-editor-panel px-1 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-editor-focus-ring"
              onChange={(event) => setFilter(event.target.value as DiscoveryFilter)}
              value={filter}
            >
              <option value="all">{t('editor.presets.discovery.filters.all')}</option>
              <option value="style">{t('editor.presets.discovery.filters.styles')}</option>
              <option value="tool">{t('editor.presets.discovery.filters.tools')}</option>
            </select>
            <select
              aria-label={t('editor.presets.discovery.sortLabel')}
              className="h-6 min-w-0 flex-1 rounded-sm border border-editor-border bg-editor-panel px-1 text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-editor-focus-ring"
              onChange={(event) => setSort(event.target.value as DiscoverySort)}
              value={sort}
            >
              <option value="library">{t('editor.presets.discovery.sort.library')}</option>
              <option value="name">{t('editor.presets.discovery.sort.name')}</option>
            </select>
            <button
              aria-label={t('editor.presets.discovery.listView')}
              aria-pressed={resultDensity === 'list'}
              className={cx(density.frame.actionButton, resultDensity === 'list' && density.frame.actionButtonActive)}
              data-tooltip={t('editor.presets.discovery.listView')}
              onClick={() => setResultDensity('list')}
              type="button"
            >
              <List size={13} />
            </button>
            <button
              aria-label={t('editor.presets.discovery.gridView')}
              aria-pressed={resultDensity === 'grid'}
              className={cx(density.frame.actionButton, resultDensity === 'grid' && density.frame.actionButtonActive)}
              data-tooltip={t('editor.presets.discovery.gridView')}
              onClick={() => setResultDensity('grid')}
              type="button"
            >
              <Grid2X2 size={13} />
            </button>
            <button
              aria-label={t('editor.presets.menu.sortAll')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.menu.sortAll')}
              disabled={!hasUserPresets}
              onClick={sortAllPresetsAlphabetically}
              type="button"
            >
              <SortAsc size={13} />
            </button>
            <button
              aria-label={t('editor.presets.menu.newFolder')}
              className={density.frame.actionButton}
              data-tooltip={t('editor.presets.menu.newFolder')}
              onClick={() => setIsAddFolderModalOpen(true)}
              type="button"
            >
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        {importConflictCount > 0 ? (
          <div
            aria-live="polite"
            className="flex items-center gap-1.5 border-b border-editor-border bg-editor-panel-well px-2.5 py-1 text-[10px] leading-4 text-text-secondary"
          >
            <CircleAlert size={12} />
            {t('editor.presets.states.importConflict', { count: importConflictCount })}
          </div>
        ) : null}
        {actionError ? (
          <div
            aria-live="assertive"
            className="flex items-center justify-between gap-2 border-b border-editor-border px-2.5 py-1 text-[10px] leading-4 text-editor-danger"
          >
            <span>{actionError}</span>
            <button
              aria-label={t('editor.presets.discovery.dismissError')}
              className="rounded px-1 hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
              onClick={() => setActionError(null)}
              type="button"
            >
              {t('editor.presets.discovery.dismiss')}
            </button>
          </div>
        ) : null}

        <div
          className={cx(
            'min-h-0 flex-1',
            placement === 'right-panel' && 'overflow-y-auto',
            isRootOver && 'bg-editor-selected-quiet',
          )}
          data-right-panel-scroll-root="true"
          onContextMenu={(event) => {
            event.preventDefault();
            showContextMenu(event.clientX, event.clientY, [
              {
                icon: Plus,
                label: t('editor.presets.menu.newPreset'),
                onClick: () => setConfigureModalState({ isOpen: true, preset: null }),
              },
              {
                icon: FolderPlus,
                label: t('editor.presets.menu.newFolder'),
                onClick: () => setIsAddFolderModalOpen(true),
              },
            ]);
          }}
          ref={setRootDropRef}
        >
          {isLoading && !hasUserPresets ? (
            <EmptyState
              icon={<Loader2 className="animate-spin" size={18} />}
              label={t('editor.presets.status.loading')}
            />
          ) : null}
          {!isLoading && loadError ? (
            <EmptyState
              actionLabel={t('editor.presets.discovery.retry')}
              icon={<CircleAlert size={18} />}
              label={t('editor.presets.errors.loadFailed')}
              onAction={() => void refreshPresets()}
            />
          ) : null}
          {!isLoading && !loadError && !hasUserPresets && BUILT_IN_COLOR_STYLE_PRESETS.length === 0 ? (
            <EmptyState
              actionLabel={t('editor.presets.status.getCommunity')}
              icon={<Folder size={18} />}
              label={t('editor.presets.status.empty')}
              onAction={onNavigateToCommunity}
            />
          ) : null}
          {!isLoading &&
          !loadError &&
          (hasUserPresets || BUILT_IN_COLOR_STYLE_PRESETS.length > 0) &&
          !hasDiscoveryResults ? (
            <EmptyState icon={<Search size={18} />} label={t('editor.presets.status.emptySearch')} />
          ) : null}
          {!isLoading && !loadError && hasDiscoveryResults ? (
            <div className="pb-2">
              {displayBuiltInStyles.length > 0 ? (
                <section
                  aria-label={t('editor.presets.colorStyles.title')}
                  className="border-b border-editor-border px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase leading-4 text-text-secondary">
                      {t('editor.presets.colorStyles.title')}
                    </span>
                    <span className="text-[10px] text-text-tertiary">{displayBuiltInStyles.length}</span>
                  </div>
                  <div className={cx('gap-1', resultDensity === 'grid' ? 'grid grid-cols-2' : 'grid')}>
                    {displayBuiltInStyles.map((preset) => {
                      const isApplied = appliedPreset?.id === preset.id;
                      return (
                        <button
                          aria-pressed={isApplied}
                          className={cx(
                            'min-w-0 rounded-sm border border-editor-border bg-editor-panel px-2 py-1.5 text-left hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                            isApplied && 'border-editor-focus-ring',
                          )}
                          data-tooltip={preset.description}
                          key={preset.id}
                          onClick={() => applyColorStyle(preset)}
                          type="button"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Palette size={12} />
                            <span className="truncate text-[11px] font-medium text-text-primary">{preset.name}</span>
                            {preset.id === COLOR_STYLE_PRESET_CATALOG.defaultPresetId ? (
                              <span className="text-[10px] text-text-secondary">
                                {t('editor.presets.colorStyles.defaultBadge')}
                              </span>
                            ) : null}
                            {isApplied ? (
                              <CheckCircle2
                                aria-label={t('editor.presets.states.applied')}
                                className="ml-auto shrink-0"
                                size={12}
                              />
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] leading-3 text-text-secondary">
                            {preset.previewTags.join(' / ')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <section aria-label={t('editor.presets.discovery.libraryLabel')} className="px-2.5 py-1">
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="text-[10px] font-semibold uppercase leading-4 text-text-secondary">
                    {t('editor.presets.discovery.libraryLabel')}
                  </span>
                  <span className="text-[10px] text-text-tertiary">{visiblePresetIds.length}</span>
                </div>
                {displayFolders.map((entry) => (
                  <FolderResult
                    forceExpanded={queryText.length > 0}
                    folder={entry.folder}
                    isExpanded={expandedFolders.has(entry.folder.id)}
                    key={entry.folder.id}
                    onContextMenu={handleContextMenu}
                    onToggle={toggleFolder}
                  >
                    <div className={cx('gap-1', resultDensity === 'grid' ? 'grid grid-cols-2' : 'grid')}>
                      {entry.folder.children.map((preset) => (
                        <PresetResultItem
                          appliedId={appliedPreset?.id ?? null}
                          density={resultDensity}
                          editedAfterApply={isEditedAfterApply}
                          isPreviewed={previewedPresetId === preset.id}
                          isSelected={selectedPresetId === preset.id}
                          key={preset.id}
                          onApply={applyPreset}
                          onContextMenu={handleContextMenu}
                          onKeyDown={handlePresetKeyDown}
                          onPreview={(nextPreset) => setPreviewedPresetId(nextPreset?.id ?? null)}
                          onSelect={(nextPreset) => setSelectedPresetId(nextPreset.id)}
                          preset={preset}
                          presetButtonRef={(node) => {
                            if (node) presetButtonRefs.current.set(preset.id, node);
                            else presetButtonRefs.current.delete(preset.id);
                          }}
                          previewState={previewStates[preset.id] ?? (selectedImage?.isReady ? 'idle' : 'failed')}
                          previewUrl={previews[preset.id] ?? undefined}
                        />
                      ))}
                    </div>
                  </FolderResult>
                ))}
                {displayRootPresets.length > 0 ? (
                  <div className={cx('gap-1 pt-1', resultDensity === 'grid' ? 'grid grid-cols-2' : 'grid')}>
                    {displayRootPresets.map((entry) => (
                      <PresetResultItem
                        appliedId={appliedPreset?.id ?? null}
                        density={resultDensity}
                        editedAfterApply={isEditedAfterApply}
                        isPreviewed={previewedPresetId === entry.preset.id}
                        isSelected={selectedPresetId === entry.preset.id}
                        key={entry.preset.id}
                        onApply={applyPreset}
                        onContextMenu={handleContextMenu}
                        onKeyDown={handlePresetKeyDown}
                        onPreview={(nextPreset) => setPreviewedPresetId(nextPreset?.id ?? null)}
                        onSelect={(nextPreset) => setSelectedPresetId(nextPreset.id)}
                        preset={entry.preset}
                        presetButtonRef={(node) => {
                          if (node) presetButtonRefs.current.set(entry.preset.id, node);
                          else presetButtonRefs.current.delete(entry.preset.id);
                        }}
                        previewState={previewStates[entry.preset.id] ?? (selectedImage?.isReady ? 'idle' : 'failed')}
                        previewUrl={previews[entry.preset.id] ?? undefined}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>

        <footer aria-live="polite" className="border-t border-editor-border bg-editor-panel-well px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] leading-4 text-text-secondary">
            {appliedPreset ? (
              isEditedAfterApply ? (
                <PencilLine size={12} />
              ) : (
                <CheckCircle2 size={12} />
              )
            ) : previewedPreset ? (
              <Eye size={12} />
            ) : selectedPreset ? (
              <CircleDot size={12} />
            ) : (
              <MoreHorizontal size={12} />
            )}
            <span className="min-w-0 flex-1 truncate">
              {appliedPreset
                ? isEditedAfterApply
                  ? t('editor.presets.footer.appliedEdited', { name: appliedPreset.name })
                  : t('editor.presets.footer.applied', { name: appliedPreset.name })
                : previewedPreset
                  ? t('editor.presets.footer.previewing', { name: previewedPreset.name })
                  : selectedPreset
                    ? t('editor.presets.footer.selected', { name: selectedPreset.name })
                    : t('editor.presets.footer.ready')}
            </span>
            {appliedPreset ? (
              <button
                aria-label={t('editor.presets.footer.revert')}
                className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[10px] font-medium text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                data-tooltip={t('editor.presets.footer.revert')}
                onClick={revertAppliedPreset}
                type="button"
              >
                <RotateCcw size={12} />
                {t('editor.presets.footer.revert')}
              </button>
            ) : null}
          </div>
          {isGeneratingPreviews ? (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-3 text-text-tertiary">
              <Loader2 className="animate-spin" size={10} />
              {t('editor.presets.states.previewsLoading')}
            </div>
          ) : null}
          {!selectedImage?.isReady && hasUserPresets ? (
            <div className="mt-0.5 text-[10px] leading-3 text-text-tertiary">
              {t('editor.presets.states.previewUnavailable')}
            </div>
          ) : null}
        </footer>
      </InspectorPanelFrame>

      <ConfigurePresetModal
        isOpen={configureModalState.isOpen}
        initialPreset={configureModalState.preset}
        onClose={() => setConfigureModalState({ isOpen: false, preset: null })}
        onSave={(name, includeMasks, includeCropTransform, presetType) =>
          void handleSaveConfiguredPreset(name, includeMasks, includeCropTransform, presetType)
        }
      />
      <CreateFolderModal
        isOpen={isAddFolderModalOpen}
        onClose={() => setIsAddFolderModalOpen(false)}
        onSave={(name) => {
          addFolder(name);
          setIsAddFolderModalOpen(false);
        }}
      />
      <RenameFolderModal
        currentName={renameFolderState.folder?.name ?? ''}
        isOpen={renameFolderState.isOpen}
        onClose={() => setRenameFolderState({ folder: null, isOpen: false })}
        onSave={(name) => {
          if (renameFolderState.folder) renameItem(renameFolderState.folder.id, name);
          setRenameFolderState({ folder: null, isOpen: false });
        }}
      />
      {activeDragId ? <span className="sr-only">{t('editor.presets.discovery.moving')}</span> : null}
    </DndContext>
  );
}

function EmptyState({
  actionLabel,
  icon,
  label,
  onAction,
}: {
  actionLabel?: string;
  icon: ReactNode;
  label: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center text-text-secondary">
      <span aria-hidden="true">{icon}</span>
      <span className="max-w-xs text-[11px] leading-4">{label}</span>
      {actionLabel && onAction ? (
        <button
          className="h-7 rounded-sm border border-editor-border px-2 text-[11px] font-medium text-text-primary hover:bg-editor-selected-quiet focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default PresetsPanel;
