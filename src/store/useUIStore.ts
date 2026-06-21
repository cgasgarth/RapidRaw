import { create } from 'zustand';

import { RIGHT_PANEL_ORDER } from '../components/panel/right/rightPanelRegistry';
import { type ImageFile, Panel, type UiVisibility, type CullingSuggestions } from '../components/ui/AppProperties';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS, type FocusStackUiSettings } from '../schemas/focusStackUiSchemas';
import { DEFAULT_HDR_MERGE_UI_SETTINGS, type HdrMergeUiSettings } from '../schemas/hdrMergeUiSchemas';
import { DEFAULT_PANORAMA_UI_SETTINGS, type PanoramaUiSettings } from '../schemas/panoramaUiSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../schemas/superResolutionUiSchemas';

export interface CollapsibleSectionsState {
  basic: boolean;
  color: boolean;
  curves: boolean;
  details: boolean;
  effects: boolean;
}

export interface ConfirmModalState {
  confirmText?: string;
  confirmVariant?: string;
  isOpen: boolean;
  message?: string;
  onConfirm?(): void;
  title?: string;
}

export interface CollageModalState {
  isOpen: boolean;
  sourceImages: ImageFile[];
}

export interface PanoramaModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  lastDryRunCommand: {
    appServerToolName: string;
    boundaryMode: PanoramaUiSettings['boundaryMode'];
    commandType: 'computationalMerge.createPanorama';
    dryRun: true;
    maxPreviewDimensionPx: number;
    projection: PanoramaUiSettings['projection'];
    sourceCount: number;
  } | null;
  progressMessage: string | null;
  settings: PanoramaUiSettings;
  stitchingSourcePaths: Array<string>;
}

export interface HdrModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  lastDryRunCommand?: {
    toolName: string;
    commandType: 'computationalMerge.createHdr';
    dryRun: true;
    sources: number;
  };
  progressMessage: string | null;
  settings: HdrMergeUiSettings;
  stitchingSourcePaths: Array<string>;
}

export interface SuperResolutionModalState {
  isOpen: boolean;
  lastDryRunCommand?: {
    commandType: 'computationalMerge.createSuperResolution';
    dryRun: true;
    sources: number;
    toolName: string;
  };
  settings: SuperResolutionUiSettings;
  sourcePaths: Array<string>;
}

export interface FocusStackModalState {
  isOpen: boolean;
  lastDryRunCommand?: {
    commandType: 'computationalMerge.createFocusStack';
    dryRun: true;
    sources: number;
    toolName: string;
  };
  settings: FocusStackUiSettings;
  sourcePaths: Array<string>;
}

export interface DenoiseModalState {
  isOpen: boolean;
  isProcessing: boolean;
  previewBase64: string | null;
  originalBase64?: string | null;
  error: string | null;
  targetPaths: string[];
  progressMessage: string | null;
  isRaw: boolean;
}

export interface NegativeConversionModalState {
  isOpen: boolean;
  targetPaths: Array<string>;
}

export interface CullingModalState {
  isOpen: boolean;
  suggestions: CullingSuggestions | null;
  progress: { current: number; total: number; stage: string } | null;
  error: string | null;
  pathsToCull: Array<string>;
}

export const createDefaultPanoramaModalState = (
  settings: PanoramaUiSettings = DEFAULT_PANORAMA_UI_SETTINGS,
): PanoramaModalState => ({
  error: null,
  finalImageBase64: null,
  isOpen: false,
  isProcessing: false,
  lastDryRunCommand: null,
  progressMessage: '',
  settings,
  stitchingSourcePaths: [],
});

export const createDefaultHdrModalState = (
  settings: HdrMergeUiSettings = DEFAULT_HDR_MERGE_UI_SETTINGS,
): HdrModalState => ({
  error: null,
  finalImageBase64: null,
  isOpen: false,
  isProcessing: false,
  progressMessage: '',
  settings,
  stitchingSourcePaths: [],
});

export const createDefaultSuperResolutionModalState = (
  settings: SuperResolutionUiSettings = DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
): SuperResolutionModalState => ({
  isOpen: false,
  settings,
  sourcePaths: [],
});

export const createDefaultFocusStackModalState = (
  settings: FocusStackUiSettings = DEFAULT_FOCUS_STACK_UI_SETTINGS,
): FocusStackModalState => ({
  isOpen: false,
  settings,
  sourcePaths: [],
});

export const createDefaultCullingModalState = (): CullingModalState => ({
  error: null,
  isOpen: false,
  pathsToCull: [],
  progress: null,
  suggestions: null,
});

export const createDefaultCollageModalState = (): CollageModalState => ({
  isOpen: false,
  sourceImages: [],
});

interface UIState {
  // View & Layout
  activeView: string;
  isFullScreen: boolean;
  isWindowFullScreen: boolean;
  isInstantTransition: boolean;
  isLayoutReady: boolean;
  uiVisibility: UiVisibility;
  isLibraryExportPanelVisible: boolean;

  // Dimensions
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  slideDirection: number;
  collapsibleSectionsState: CollapsibleSectionsState;

  // Modals & Dialogs
  isCreateFolderModalOpen: boolean;
  isRenameFolderModalOpen: boolean;
  isRenameFileModalOpen: boolean;
  renameTargetPaths: Array<string>;
  isImportModalOpen: boolean;
  isCopyPasteSettingsModalOpen: boolean;
  isCommandPaletteOpen: boolean;
  isLensCorrectionModalOpen: boolean;
  isTransformModalOpen: boolean;
  importTargetFolder: string | null;
  importSourcePaths: Array<string>;
  folderActionTarget: string | null;

  // Album Modals
  isCreateAlbumModalOpen: boolean;
  isCreateAlbumGroupModalOpen: boolean;
  isRenameAlbumModalOpen: boolean;
  albumActionTarget: string | null;

  // Complex Modal States
  confirmModalState: ConfirmModalState;
  panoramaModalState: PanoramaModalState;
  hdrModalState: HdrModalState;
  superResolutionModalState: SuperResolutionModalState;
  focusStackModalState: FocusStackModalState;
  negativeModalState: NegativeConversionModalState;
  denoiseModalState: DenoiseModalState;
  cullingModalState: CullingModalState;
  collageModalState: CollageModalState;

  // Actions
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeView: 'library',
  isFullScreen: false,
  isWindowFullScreen: false,
  isInstantTransition: false,
  isLayoutReady: false,
  uiVisibility: { folderTree: true, filmstrip: true },
  isLibraryExportPanelVisible: false,

  leftPanelWidth: 256,
  rightPanelWidth: 320,
  bottomPanelHeight: 144,
  compactEditorPanelHeightOverride: null,

  activeRightPanel: Panel.Adjustments,
  renderedRightPanel: Panel.Adjustments,
  slideDirection: 1,
  collapsibleSectionsState: { basic: true, color: false, curves: true, details: false, effects: false },

  isCreateFolderModalOpen: false,
  isRenameFolderModalOpen: false,
  isRenameFileModalOpen: false,
  renameTargetPaths: [],
  isImportModalOpen: false,
  isCopyPasteSettingsModalOpen: false,
  isCommandPaletteOpen: false,
  isLensCorrectionModalOpen: false,
  isTransformModalOpen: false,
  importTargetFolder: null,
  importSourcePaths: [],
  folderActionTarget: null,

  isCreateAlbumModalOpen: false,
  isCreateAlbumGroupModalOpen: false,
  isRenameAlbumModalOpen: false,
  albumActionTarget: null,

  confirmModalState: { isOpen: false },
  panoramaModalState: createDefaultPanoramaModalState(),
  hdrModalState: createDefaultHdrModalState(),
  superResolutionModalState: createDefaultSuperResolutionModalState(),
  focusStackModalState: createDefaultFocusStackModalState(),
  negativeModalState: { isOpen: false, targetPaths: [] },
  denoiseModalState: {
    isOpen: false,
    isProcessing: false,
    previewBase64: null,
    error: null,
    targetPaths: [],
    progressMessage: null,
    isRaw: false,
  },
  cullingModalState: createDefaultCullingModalState(),
  collageModalState: createDefaultCollageModalState(),

  setUI: (updater) => {
    set((state) => (typeof updater === 'function' ? updater(state) : updater));
  },

  setRightPanel: (panelId) => {
    const current = get().activeRightPanel;
    if (panelId === current) {
      set({ activeRightPanel: null });
    } else {
      const currentIndex = current ? RIGHT_PANEL_ORDER.indexOf(current) : -1;
      const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
      set({
        slideDirection: newIndex > currentIndex ? 1 : -1,
        activeRightPanel: panelId,
        renderedRightPanel: panelId,
      });
    }
  },

  customEscapeHandler: null,
  setCustomEscapeHandler: (handler) => {
    set({ customEscapeHandler: handler });
  },
}));
