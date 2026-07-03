import { create } from 'zustand';

import {
  DEFAULT_EDITOR_RIGHT_PANEL,
  isEditingRightPanel,
  isRightPanel,
  RIGHT_PANEL_ORDER,
} from '../components/panel/right/rightPanelRegistry';
import type { CullingSuggestions, ImageFile, Panel, UiVisibility } from '../components/ui/AppProperties';
import type { DerivedOutputReceipt } from '../schemas/computational-merge/derivedOutputReceiptSchemas';
import {
  DEFAULT_HDR_MERGE_UI_SETTINGS,
  type HdrEditableHandoffSummary,
  type HdrMergeUiSettings,
  type HdrRuntimePlan,
} from '../schemas/computational-merge/hdrMergeUiSchemas';
import {
  DEFAULT_PANORAMA_UI_SETTINGS,
  type PanoramaRenderedReview,
  type PanoramaRuntimePlan,
  type PanoramaUiSettings,
} from '../schemas/computational-merge/panoramaUiSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../schemas/computational-merge/superResolutionOutputReviewSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../schemas/computational-merge/superResolutionUiSchemas';
import type { FocusStackOutputReviewWorkflow } from '../schemas/focus-stack/focusStackOutputReviewSchemas';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS, type FocusStackUiSettings } from '../schemas/focus-stack/focusStackUiSchemas';
import type { MaskContainer } from '../utils/adjustments';
import type { FocusStackSourcePreflightMetadata } from '../utils/focusStackSourcePreflight';
import type { HdrBracketPreflightSourceMetadata } from '../utils/hdrBracketPreflight';
import {
  buildLayerMaskProvenanceReceipts,
  buildLayerMaskSourceGraphRevision,
  DEFAULT_LAYER_MASK_SOURCE_GRAPH_REVISION,
  type LayerMaskProvenanceInvalidationReason,
  type LayerMaskProvenanceReceipt,
  markLayerMaskReceiptsStale,
} from '../utils/layers/layerMaskProvenance';
import type { SuperResolutionSourcePreflightMetadata } from '../utils/superResolutionSourcePreflight';

export interface CollapsibleSectionsState {
  basic: boolean;
  color: boolean;
  curves: boolean;
  details: boolean;
  effects: boolean;
  transformLens: boolean;
}

const DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY = 'rapidraw.developPanelPinnedControlIds.v1';
export const LAST_EDITING_RIGHT_PANEL_STORAGE_KEY = 'rapidraw.lastEditingRightPanel.v1';
export const MAX_RECENT_RIGHT_PANELS = 5;

export const readLastEditingRightPanel = (): Panel => {
  if (typeof globalThis.localStorage === 'undefined') return DEFAULT_EDITOR_RIGHT_PANEL;

  try {
    const stored = globalThis.localStorage.getItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY);
    if (stored === null) return DEFAULT_EDITOR_RIGHT_PANEL;
    return isEditingRightPanel(stored) ? stored : DEFAULT_EDITOR_RIGHT_PANEL;
  } catch {
    return DEFAULT_EDITOR_RIGHT_PANEL;
  }
};

const persistLastEditingRightPanel = (panel: Panel) => {
  if (typeof globalThis.localStorage === 'undefined' || !isEditingRightPanel(panel)) return;

  globalThis.localStorage.setItem(LAST_EDITING_RIGHT_PANEL_STORAGE_KEY, panel);
};

const readDevelopPanelPinnedControlIds = (): string[] => {
  if (typeof globalThis.localStorage === 'undefined') return [];

  try {
    const stored = globalThis.localStorage.getItem(DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY);
    if (stored === null) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const persistDevelopPanelPinnedControlIds = (controlIds: string[]) => {
  if (typeof globalThis.localStorage === 'undefined') return;

  globalThis.localStorage.setItem(DEVELOP_PANEL_PINNED_CONTROL_IDS_STORAGE_KEY, JSON.stringify(controlIds));
};

export const createRecentRightPanels = (selectedPanel: Panel, currentPanels: readonly Panel[]): Panel[] =>
  [selectedPanel, ...currentPanels.filter((panel) => panel !== selectedPanel && isRightPanel(panel))].slice(
    0,
    MAX_RECENT_RIGHT_PANELS,
  );

export const DEFAULT_COLLAPSIBLE_SECTIONS_STATE: CollapsibleSectionsState = {
  basic: true,
  color: false,
  curves: true,
  details: false,
  effects: false,
  transformLens: false,
};

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
  lastApplyCommand: {
    acceptedDryRunPlanHash: string;
    acceptedDryRunPlanId: string;
    commandType: 'computationalMerge.createPanorama';
    dryRun: false;
    sourceCount: number;
    toolName: string;
  } | null;
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
  renderedReview: PanoramaRenderedReview | null;
  runtimePlan: PanoramaRuntimePlan | null;
  settings: PanoramaUiSettings;
  stitchingSourcePaths: Array<string>;
}

export interface HdrModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  lastApplyCommand?: {
    acceptedDryRunPlanHash: string;
    acceptedDryRunPlanId: string;
    commandType: 'computationalMerge.createHdr';
    dryRun: false;
    outputHandle?: string;
    previewDimensions?: { height: number; width: number };
    sourcePaths?: string[];
    sources: number;
    toolName: string;
  };
  lastDryRunCommand?: {
    commandType: 'computationalMerge.createHdr';
    deghosting: HdrMergeUiSettings['deghosting'];
    dryRun: true;
    exposureWeightingMode: HdrMergeUiSettings['exposureWeightingMode'];
    maxPreviewDimensionPx: number;
    mergeStrategy: HdrMergeUiSettings['mergeStrategy'];
    selectedSourceIndexes: HdrMergeUiSettings['selectedSourceIndexes'];
    sources: number;
    toneMappingPreset: HdrMergeUiSettings['toneMappingPreset'];
    toolName: string;
  };
  progressMessage: string | null;
  runtimePlan: HdrRuntimePlan | null;
  savedHandoffSummary: HdrEditableHandoffSummary | null;
  settings: HdrMergeUiSettings;
  sourceMetadata: HdrBracketPreflightSourceMetadata[];
  stitchingSourcePaths: Array<string>;
}

export interface SuperResolutionModalState {
  isOpen: boolean;
  lastApplyCommand?: {
    acceptedDryRunPlanHash: string;
    acceptedDryRunPlanId: string;
    commandType: 'computationalMerge.createSuperResolution';
    dryRun: false;
    sources: number;
    toolName: string;
  };
  lastDryRunCommand?: {
    commandType: 'computationalMerge.createSuperResolution';
    dryRun: true;
    sources: number;
    toolName: string;
  };
  outputReview: SuperResolutionOutputReviewWorkflow | null;
  settings: SuperResolutionUiSettings;
  sourcePreflightMetadata: SuperResolutionSourcePreflightMetadata[];
  sourcePaths: Array<string>;
}

export interface FocusStackModalState {
  isOpen: boolean;
  lastApplyCommand?: {
    acceptedDryRunPlanHash: string;
    acceptedDryRunPlanId: string;
    commandType: 'computationalMerge.createFocusStack';
    dryRun: false;
    sources: number;
    toolName: string;
  };
  lastDryRunCommand?: {
    commandType: 'computationalMerge.createFocusStack';
    dryRun: true;
    haloSuppressionStrengthPercent: number;
    sources: number;
    toolName: string;
  };
  outputReview: FocusStackOutputReviewWorkflow | null;
  settings: FocusStackUiSettings;
  sourcePreflightMetadata: FocusStackSourcePreflightMetadata[];
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
  lastApplyCommand: null,
  lastDryRunCommand: null,
  progressMessage: '',
  renderedReview: null,
  runtimePlan: null,
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
  runtimePlan: null,
  savedHandoffSummary: null,
  settings,
  sourceMetadata: [],
  stitchingSourcePaths: [],
});

export const createDefaultSuperResolutionModalState = (
  settings: SuperResolutionUiSettings = DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
): SuperResolutionModalState => ({
  isOpen: false,
  outputReview: null,
  settings,
  sourcePreflightMetadata: [],
  sourcePaths: [],
});

export const createDefaultFocusStackModalState = (
  settings: FocusStackUiSettings = DEFAULT_FOCUS_STACK_UI_SETTINGS,
): FocusStackModalState => ({
  isOpen: false,
  outputReview: null,
  settings,
  sourcePreflightMetadata: [],
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

export interface UIState {
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
  recentRightPanels: Panel[];
  slideDirection: number;
  collapsibleSectionsState: CollapsibleSectionsState;
  developPanelPinnedControlIds: string[];

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
  derivedOutputReceipts: Record<string, DerivedOutputReceipt>;
  layerMaskProvenanceReceipts: Record<string, LayerMaskProvenanceReceipt>;
  layerMaskSourceGraphRevision: string;
  layerMaskSourceGraphRevisionCounter: number;

  // Actions
  clearDerivedOutputReceipts: () => void;
  markLayerMaskProvenanceStale: (input: { layerIds?: string[]; reason: LayerMaskProvenanceInvalidationReason }) => void;
  recordLayerMaskPreviewReceipt: (input: { appliedCommandId: string; masks: Array<MaskContainer> }) => void;
  setDevelopPanelPinnedControlIds: (controlIds: string[]) => void;
  recordRecentRightPanel: (panel: Panel) => void;
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  upsertDerivedOutputReceipt: (receipt: DerivedOutputReceipt) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
}

export const useUIStore = create<UIState>((set, get) => {
  const initialRightPanel = readLastEditingRightPanel();

  return {
    activeView: 'library',
    isFullScreen: false,
    isWindowFullScreen: false,
    isInstantTransition: false,
    isLayoutReady: false,
    uiVisibility: { folderTree: true, filmstrip: true },
    isLibraryExportPanelVisible: false,

    leftPanelWidth: 256,
    rightPanelWidth: 360,
    bottomPanelHeight: 144,
    compactEditorPanelHeightOverride: null,

    activeRightPanel: initialRightPanel,
    renderedRightPanel: initialRightPanel,
    recentRightPanels: [initialRightPanel],
    slideDirection: 1,
    collapsibleSectionsState: { ...DEFAULT_COLLAPSIBLE_SECTIONS_STATE },
    developPanelPinnedControlIds: readDevelopPanelPinnedControlIds(),

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
    derivedOutputReceipts: {},
    layerMaskProvenanceReceipts: {},
    layerMaskSourceGraphRevision: DEFAULT_LAYER_MASK_SOURCE_GRAPH_REVISION,
    layerMaskSourceGraphRevisionCounter: 0,

    clearDerivedOutputReceipts: () => {
      set({ derivedOutputReceipts: {} });
    },

    markLayerMaskProvenanceStale: ({ layerIds, reason }) => {
      set((state) => {
        const nextRevisionCounter = state.layerMaskSourceGraphRevisionCounter + 1;
        return {
          layerMaskProvenanceReceipts: markLayerMaskReceiptsStale({
            ...(layerIds === undefined ? {} : { layerIds }),
            reason,
            receipts: state.layerMaskProvenanceReceipts,
          }),
          layerMaskSourceGraphRevision: buildLayerMaskSourceGraphRevision({
            previousRevision: state.layerMaskSourceGraphRevision,
            reason,
            revisionIndex: nextRevisionCounter,
          }),
          layerMaskSourceGraphRevisionCounter: nextRevisionCounter,
        };
      });
    },

    recordLayerMaskPreviewReceipt: ({ appliedCommandId, masks }) => {
      set((state) => ({
        layerMaskProvenanceReceipts: buildLayerMaskProvenanceReceipts({
          appliedCommandId,
          masks,
          sourceGraphRevision: state.layerMaskSourceGraphRevision,
        }),
      }));
    },

    setDevelopPanelPinnedControlIds: (controlIds) => {
      const normalizedControlIds = [...new Set(controlIds)].filter((controlId) => controlId.trim().length > 0);
      persistDevelopPanelPinnedControlIds(normalizedControlIds);
      set({ developPanelPinnedControlIds: normalizedControlIds });
    },

    recordRecentRightPanel: (panel) => {
      set((state) => ({ recentRightPanels: createRecentRightPanels(panel, state.recentRightPanels) }));
    },

    setUI: (updater) => {
      set((state) => (typeof updater === 'function' ? updater(state) : updater));
    },

    setRightPanel: (panelId) => {
      const current = get().activeRightPanel;
      if (panelId === current) {
        set({ activeRightPanel: null });
      } else {
        const rendered = get().renderedRightPanel;
        const previousPanel = current ?? rendered;
        const currentIndex = previousPanel ? RIGHT_PANEL_ORDER.indexOf(previousPanel) : -1;
        const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
        if (panelId && isEditingRightPanel(panelId)) {
          persistLastEditingRightPanel(panelId);
        }
        set({
          slideDirection: newIndex === currentIndex ? 0 : newIndex > currentIndex ? 1 : -1,
          activeRightPanel: panelId,
          renderedRightPanel: panelId,
          ...(panelId === null ? {} : { recentRightPanels: createRecentRightPanels(panelId, get().recentRightPanels) }),
        });
      }
    },

    upsertDerivedOutputReceipt: (receipt) => {
      set((state) => {
        const existing = state.derivedOutputReceipts[receipt.receiptId];
        if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(receipt)) {
          return state;
        }
        return {
          derivedOutputReceipts: {
            ...state.derivedOutputReceipts,
            [receipt.receiptId]: receipt,
          },
        };
      });
    },

    customEscapeHandler: null,
    setCustomEscapeHandler: (handler) => {
      set({ customEscapeHandler: handler });
    },
  };
});
