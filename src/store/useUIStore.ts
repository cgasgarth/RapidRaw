import { create } from 'zustand';

import {
  getRightPanelHostDescriptor,
  isEditingRightPanel,
  isRightPanel,
  RIGHT_PANEL_ORDER,
} from '../components/panel/right/rightPanelRegistry';
import { type CullingSuggestions, type ImageFile, Panel, type UiVisibility } from '../components/ui/AppProperties';
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
import type {
  SingleImageX2ApplyReceipt,
  SingleImageX2Preview,
} from '../schemas/computational-merge/singleImageX2Schemas';
import type { BurstSrCandidateJobResult } from '../schemas/computational-merge/superResolutionCandidateRuntimeSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../schemas/computational-merge/superResolutionOutputReviewSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../schemas/computational-merge/superResolutionUiSchemas';
import type {
  CompactEditorDrawerState,
  EditorWorkspaceCompareMode,
  EditorWorkspaceLightsOutLevel,
  EditorWorkspacePreferences,
  EditorWorkspaceZoomMode,
} from '../schemas/editorWorkspacePreferencesSchemas';
import { editorWorkspacePreferencesSchema } from '../schemas/editorWorkspacePreferencesSchemas';
import type { FocusStackNativeInputPlan } from '../schemas/focus-stack/focusStackNativePlanSchemas';
import type { FocusStackOutputReviewWorkflow } from '../schemas/focus-stack/focusStackOutputReviewSchemas';
import type { FocusRetouchSession } from '../schemas/focus-stack/focusStackRetouchSchemas';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS, type FocusStackUiSettings } from '../schemas/focus-stack/focusStackUiSchemas';
import {
  type LibraryWorkspacePreferences,
  libraryWorkspacePreferencesSchema,
} from '../schemas/libraryWorkspacePreferencesSchemas';
import type { MaskContainer } from '../utils/adjustments';
import {
  EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY,
  type EditorWorkspaceViewport,
  getEffectiveEditorWorkspaceLayout,
  LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY,
  type LegacyEditorWorkspacePreferences,
  readEditorWorkspacePreferences,
  saveEditorWorkspacePreferences,
  shouldPersistLegacyWorkspaceMigration,
} from '../utils/editorWorkspacePreferences';
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
import { readLibraryWorkspacePreferences, saveLibraryWorkspacePreferences } from '../utils/libraryWorkspacePreferences';
import type { NegativeLabSessionSnapshot } from '../utils/negative-lab/negativeLabSessionState';
import type { SuperResolutionNativeReadiness } from '../utils/superResolutionNativeReadiness';
import type { SuperResolutionSourcePreflightMetadata } from '../utils/superResolutionSourcePreflight';
import { useEditorStore } from './useEditorStore';

export interface CollapsibleSectionsState {
  basic: boolean;
  color: boolean;
  curves: boolean;
  details: boolean;
  effects: boolean;
  transformLens: boolean;
}

export const LAST_EDITING_RIGHT_PANEL_STORAGE_KEY = LEGACY_LAST_EDITING_RIGHT_PANEL_STORAGE_KEY;
export { EDITOR_WORKSPACE_PREFERENCES_STORAGE_KEY };
export const MAX_RECENT_RIGHT_PANELS = 5;

export const LAZY_COMPUTATIONAL_MODAL_IDS = ['panorama', 'hdr', 'superResolution', 'focusStack'] as const;
export type LazyComputationalModalId = (typeof LAZY_COMPUTATIONAL_MODAL_IDS)[number];

const MODAL_STATE_BY_LAZY_ID = {
  focusStack: 'focusStackModalState',
  hdr: 'hdrModalState',
  panorama: 'panoramaModalState',
  superResolution: 'superResolutionModalState',
} as const satisfies Record<LazyComputationalModalId, keyof UIState>;

export const collectOpenedLazyModalIds = (
  mountedIds: ReadonlySet<LazyComputationalModalId>,
  update: Partial<UIState>,
): ReadonlySet<LazyComputationalModalId> => {
  let nextIds: Set<LazyComputationalModalId> | null = null;
  for (const id of LAZY_COMPUTATIONAL_MODAL_IDS) {
    const modalState = update[MODAL_STATE_BY_LAZY_ID[id]];
    if (typeof modalState !== 'object' || modalState === null || !('isOpen' in modalState) || !modalState.isOpen)
      continue;
    if (mountedIds.has(id)) continue;
    nextIds ??= new Set(mountedIds);
    nextIds.add(id);
  }
  return nextIds ?? mountedIds;
};

export const readLastEditingRightPanel = (): Panel => readEditorWorkspacePreferences().rightInspector.activePanel;

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

const createCollapsibleSectionsState = (preferences: EditorWorkspacePreferences): CollapsibleSectionsState => ({
  basic: preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('basic') ?? false,
  color: preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('color') ?? false,
  curves: preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('curves') ?? false,
  details: preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('details') ?? false,
  effects: preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('effects') ?? false,
  transformLens:
    preferences.rightInspector.expandedSectionsByPanel[Panel.Adjustments]?.includes('transformLens') ?? false,
});

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
  alignmentCancellationId: string | null;
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
  applyReceipt?: import('../schemas/computational-merge/burstSrApplySchemas').BurstSrApplyReceipt | null;
  candidateJob?: BurstSrCandidateJobResult | null;
  candidateJobId?: string | null;
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
  singleImagePreview: SingleImageX2Preview | null;
  singleImageApplyReceipt?: SingleImageX2ApplyReceipt | null;
  nativeReadiness?: SuperResolutionNativeReadiness | null;
  settings: SuperResolutionUiSettings;
  sourcePreflightMetadata: SuperResolutionSourcePreflightMetadata[];
  sourcePaths: Array<string>;
}

export interface FocusStackModalState {
  applyReceipt?: import('../schemas/focus-stack/focusStackApplySchemas').FocusStackApplyReceipt | null;
  candidateJob?: import('../schemas/focus-stack/focusStackCandidateRuntimeSchemas').FocusStackCandidateJobResult | null;
  candidateJobId?: string | null;
  error: string | null;
  isPlanning: boolean;
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
  nativeInputPlan: FocusStackNativeInputPlan | null;
  settings: FocusStackUiSettings;
  sourcePreflightMetadata: FocusStackSourcePreflightMetadata[];
  sourcePaths: Array<string>;
}

export interface FocusRetouchToolState {
  active: boolean;
  erase: boolean;
  hardnessPercent: number;
  packagePath: string;
  radiusPx: number;
  selectedSource: number;
  session: FocusRetouchSession | null;
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
  session: NegativeLabSessionSnapshot | null;
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
  alignmentCancellationId: null,
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
  applyReceipt: null,
  candidateJob: null,
  candidateJobId: null,
  isOpen: false,
  nativeReadiness: null,
  outputReview: null,
  singleImagePreview: null,
  singleImageApplyReceipt: null,
  settings,
  sourcePreflightMetadata: [],
  sourcePaths: [],
});

export const createDefaultFocusStackModalState = (
  settings: FocusStackUiSettings = DEFAULT_FOCUS_STACK_UI_SETTINGS,
): FocusStackModalState => ({
  applyReceipt: null,
  candidateJob: null,
  candidateJobId: null,
  error: null,
  isOpen: false,
  isPlanning: false,
  nativeInputPlan: null,
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
  editorWorkspacePreferences: EditorWorkspacePreferences;
  editorWorkspaceViewport: EditorWorkspaceViewport;
  libraryWorkspacePreferences: LibraryWorkspacePreferences;

  // Dimensions
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;
  libraryLeftPanelWidth: number;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  mountedKeepAlivePanels: ReadonlySet<Panel>;
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
  mountedLazyModalIds: ReadonlySet<LazyComputationalModalId>;
  focusRetouchToolState: FocusRetouchToolState;
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
  hydrateEditorWorkspacePreferences: (legacy?: LegacyEditorWorkspacePreferences) => void;
  hydrateLibraryWorkspacePreferences: (folderTreeVisible?: unknown) => void;
  setDefaultEditorCompareMode: (mode: EditorWorkspaceCompareMode) => void;
  setDefaultEditorZoomMode: (mode: EditorWorkspaceZoomMode) => void;
  setEditorLightsOutLevel: (level: EditorWorkspaceLightsOutLevel) => void;
  setCompactEditorDrawerState: (state: CompactEditorDrawerState) => void;
  setEditorRegionSize: (
    region: 'compactTools' | 'filmstrip' | 'leftSidebar' | 'rightInspector',
    size: number | null,
  ) => void;
  setEditorRegionVisibility: (region: 'filmstrip' | 'leftSidebar' | 'rightInspector', visible: boolean) => void;
  setEditorSectionExpanded: (panel: Panel, sectionId: string, expanded: boolean) => void;
  setEditorLeftSectionExpanded: (sectionId: string, expanded: boolean) => void;
  setEditorWorkspaceViewport: (viewport: EditorWorkspaceViewport) => void;
  selectEditorPanel: (panel: Panel, viewport?: EditorWorkspaceViewport) => void;
  setLibraryFolderTreeVisibility: (visible: boolean) => void;
  setLibraryFolderTreeWidth: (width: number) => void;
  recordRecentRightPanel: (panel: Panel) => void;
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  upsertDerivedOutputReceipt: (receipt: DerivedOutputReceipt) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
}

export const useUIStore = create<UIState>((set, get) => {
  const initialPreferences = readEditorWorkspacePreferences();
  const initialLibraryPreferences = readLibraryWorkspacePreferences();
  const initialRightPanel = initialPreferences.rightInspector.activePanel;
  const initialLayout = getEffectiveEditorWorkspaceLayout(initialPreferences, {
    height: Number.MAX_SAFE_INTEGER,
    isCompactPortrait: false,
    isPortrait: false,
    width: Number.MAX_SAFE_INTEGER,
  });

  const applyWorkspacePreferences = (
    preferences: EditorWorkspacePreferences,
    viewport: EditorWorkspaceViewport = get().editorWorkspaceViewport,
  ) => {
    const effectiveLayout = getEffectiveEditorWorkspaceLayout(preferences, viewport);
    return {
      bottomPanelHeight: effectiveLayout.bottomPanelHeight,
      compactEditorPanelHeightOverride: effectiveLayout.compactEditorPanelHeightOverride,
      editorWorkspacePreferences: preferences,
      editorWorkspaceViewport: viewport,
      leftPanelWidth: effectiveLayout.leftPanelWidth,
      rightPanelWidth: effectiveLayout.rightPanelWidth,
      uiVisibility: {
        filmstrip: preferences.filmstrip.visible,
        folderTree: preferences.leftSidebar.visible,
      },
    };
  };

  return {
    activeView: 'library',
    isFullScreen: false,
    isWindowFullScreen: false,
    isInstantTransition: false,
    isLayoutReady: false,
    uiVisibility: {
      folderTree: initialPreferences.leftSidebar.visible,
      filmstrip: initialPreferences.filmstrip.visible,
    },
    isLibraryExportPanelVisible: false,
    editorWorkspacePreferences: initialPreferences,
    editorWorkspaceViewport: { height: 0, isCompactPortrait: false, isPortrait: false, width: 0 },
    libraryWorkspacePreferences: initialLibraryPreferences,

    leftPanelWidth: 256,
    rightPanelWidth: 360,
    bottomPanelHeight: initialLayout.bottomPanelHeight,
    compactEditorPanelHeightOverride: initialLayout.compactEditorPanelHeightOverride,
    libraryLeftPanelWidth: initialLibraryPreferences.folderTree.width,

    activeRightPanel: initialRightPanel,
    renderedRightPanel: initialRightPanel,
    mountedKeepAlivePanels:
      getRightPanelHostDescriptor(initialRightPanel).keepAlive === 'session' ? new Set([initialRightPanel]) : new Set(),
    recentRightPanels: [initialRightPanel],
    slideDirection: 1,
    collapsibleSectionsState: createCollapsibleSectionsState(initialPreferences),
    developPanelPinnedControlIds: initialPreferences.rightInspector.pinnedControlIds,

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
    mountedLazyModalIds: new Set(),
    focusRetouchToolState: {
      active: false,
      erase: false,
      hardnessPercent: 70,
      packagePath: '',
      radiusPx: 24,
      selectedSource: 0,
      session: null,
    },
    negativeModalState: { isOpen: false, session: null, targetPaths: [] },
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
      set((state) => {
        const preferences = {
          ...state.editorWorkspacePreferences,
          rightInspector: {
            ...state.editorWorkspacePreferences.rightInspector,
            pinnedControlIds: normalizedControlIds,
          },
        };
        saveEditorWorkspacePreferences(preferences);
        return { developPanelPinnedControlIds: normalizedControlIds, editorWorkspacePreferences: preferences };
      });
    },

    hydrateEditorWorkspacePreferences: (legacy = {}) => {
      const preferences = readEditorWorkspacePreferences(legacy);
      if (shouldPersistLegacyWorkspaceMigration(legacy)) saveEditorWorkspacePreferences(preferences);
      const activeRightPanel = preferences.rightInspector.visible ? preferences.rightInspector.activePanel : null;
      set({
        ...applyWorkspacePreferences(preferences),
        activeRightPanel,
        collapsibleSectionsState: createCollapsibleSectionsState(preferences),
        developPanelPinnedControlIds: preferences.rightInspector.pinnedControlIds,
        recentRightPanels: preferences.rightInspector.recentPanels,
        renderedRightPanel: preferences.rightInspector.activePanel,
      });
    },

    hydrateLibraryWorkspacePreferences: (folderTreeVisible) => {
      const preferences = readLibraryWorkspacePreferences({ folderTreeVisible });
      saveLibraryWorkspacePreferences(preferences);
      set({ libraryLeftPanelWidth: preferences.folderTree.width, libraryWorkspacePreferences: preferences });
    },

    setDefaultEditorCompareMode: (mode) => {
      set((state) => {
        const preferences = {
          ...state.editorWorkspacePreferences,
          viewer: { ...state.editorWorkspacePreferences.viewer, compareMode: mode },
        };
        saveEditorWorkspacePreferences(preferences);
        return { editorWorkspacePreferences: preferences };
      });
    },

    setDefaultEditorZoomMode: (mode) => {
      set((state) => {
        const preferences = {
          ...state.editorWorkspacePreferences,
          viewer: { ...state.editorWorkspacePreferences.viewer, defaultZoomMode: mode },
        };
        saveEditorWorkspacePreferences(preferences);
        return { editorWorkspacePreferences: preferences };
      });
    },

    setEditorLightsOutLevel: (level) => {
      set((state) => {
        const preferences = {
          ...state.editorWorkspacePreferences,
          viewer: { ...state.editorWorkspacePreferences.viewer, lightsOutLevel: level },
        };
        saveEditorWorkspacePreferences(preferences);
        return { editorWorkspacePreferences: preferences };
      });
    },

    setCompactEditorDrawerState: (drawerState) => {
      set((state) => {
        const preferences = structuredClone(state.editorWorkspacePreferences);
        preferences.compact.drawerState = drawerState;
        preferences.compact.toolsExpanded = drawerState !== 'collapsed';
        saveEditorWorkspacePreferences(preferences);
        return applyWorkspacePreferences(preferences, state.editorWorkspaceViewport);
      });
    },

    setEditorRegionSize: (region, size) => {
      set((state) => {
        const preferences = structuredClone(state.editorWorkspacePreferences);
        if (region === 'leftSidebar' && typeof size === 'number') preferences.leftSidebar.width = size;
        if (region === 'rightInspector' && typeof size === 'number') preferences.rightInspector.width = size;
        if (region === 'filmstrip' && typeof size === 'number') preferences.filmstrip.height = size;
        if (region === 'compactTools') preferences.compact.toolsHeight = size;

        const parsed = editorWorkspacePreferencesSchema.safeParse(preferences);
        if (!parsed.success) return state;
        saveEditorWorkspacePreferences(parsed.data);
        return applyWorkspacePreferences(parsed.data, state.editorWorkspaceViewport);
      });
    },

    setEditorRegionVisibility: (region, visible) => {
      set((state) => {
        const preferences = structuredClone(state.editorWorkspacePreferences);
        if (region === 'leftSidebar') preferences.leftSidebar.visible = visible;
        if (region === 'rightInspector') {
          preferences.compact.toolsExpanded = visible;
          preferences.compact.drawerState = visible ? 'expanded' : 'collapsed';
          preferences.rightInspector.visible = visible;
        }
        if (region === 'filmstrip') preferences.filmstrip.visible = visible;
        saveEditorWorkspacePreferences(preferences);
        return {
          ...applyWorkspacePreferences(preferences, state.editorWorkspaceViewport),
          ...(region === 'rightInspector'
            ? { activeRightPanel: visible ? preferences.rightInspector.activePanel : null }
            : {}),
        };
      });
    },

    setEditorSectionExpanded: (panel, sectionId, expanded) => {
      if (sectionId.trim().length === 0) return;
      set((state) => {
        const currentSections = state.editorWorkspacePreferences.rightInspector.expandedSectionsByPanel[panel] ?? [];
        const nextSections = expanded
          ? [...new Set([...currentSections, sectionId])]
          : currentSections.filter((currentSection) => currentSection !== sectionId);
        const preferences = {
          ...state.editorWorkspacePreferences,
          rightInspector: {
            ...state.editorWorkspacePreferences.rightInspector,
            expandedSectionsByPanel: {
              ...state.editorWorkspacePreferences.rightInspector.expandedSectionsByPanel,
              [panel]: nextSections,
            },
          },
        };
        saveEditorWorkspacePreferences(preferences);
        return {
          collapsibleSectionsState:
            panel === Panel.Adjustments
              ? { ...state.collapsibleSectionsState, [sectionId]: expanded }
              : state.collapsibleSectionsState,
          editorWorkspacePreferences: preferences,
        };
      });
    },

    setEditorLeftSectionExpanded: (sectionId, expanded) => {
      if (sectionId.trim().length === 0) return;
      set((state) => {
        const currentSections = state.editorWorkspacePreferences.leftSidebar.expandedSections;
        const expandedSections = expanded
          ? [...new Set([...currentSections, sectionId])]
          : currentSections.filter((currentSection) => currentSection !== sectionId);
        const preferences = {
          ...state.editorWorkspacePreferences,
          leftSidebar: { ...state.editorWorkspacePreferences.leftSidebar, expandedSections },
        };
        saveEditorWorkspacePreferences(preferences);
        return { editorWorkspacePreferences: preferences };
      });
    },

    setEditorWorkspaceViewport: (viewport) => {
      set((state) => {
        if (
          state.editorWorkspaceViewport.width === viewport.width &&
          state.editorWorkspaceViewport.height === viewport.height &&
          state.editorWorkspaceViewport.isPortrait === viewport.isPortrait &&
          state.editorWorkspaceViewport.isCompactPortrait === viewport.isCompactPortrait
        )
          return state;

        if (!viewport.isCompactPortrait && state.activeRightPanel === Panel.Presets) {
          const preferences = structuredClone(state.editorWorkspacePreferences);
          preferences.leftSidebar.visible = true;
          preferences.leftSidebar.expandedSections = [
            ...new Set([...preferences.leftSidebar.expandedSections, 'presets']),
          ];
          saveEditorWorkspacePreferences(preferences);
          return {
            ...applyWorkspacePreferences(preferences, viewport),
            activeRightPanel: null,
            renderedRightPanel: Panel.Presets,
          };
        }
        return applyWorkspacePreferences(state.editorWorkspacePreferences, viewport);
      });
    },

    selectEditorPanel: (panel, viewport = get().editorWorkspaceViewport) => {
      if (panel === Panel.Presets && !viewport.isCompactPortrait) {
        set((state) => {
          const preferences = structuredClone(state.editorWorkspacePreferences);
          preferences.leftSidebar.visible = true;
          preferences.leftSidebar.expandedSections = [
            ...new Set([...preferences.leftSidebar.expandedSections, 'presets']),
          ];
          saveEditorWorkspacePreferences(preferences);
          return {
            ...applyWorkspacePreferences(preferences, viewport),
            activeRightPanel: null,
            renderedRightPanel: Panel.Presets,
          };
        });
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() =>
            document.querySelector<HTMLButtonElement>('[data-testid="editor-left-presets-toggle"]')?.focus(),
          );
        }
        return;
      }
      get().setRightPanel(panel);
      useEditorStore.getState().setEditor({
        activeAiSubMaskId: null,
        activeMaskId: null,
        isMaskControlHovered: false,
        isWbPickerActive: false,
      });
    },

    setLibraryFolderTreeVisibility: (visible) => {
      set((state) => {
        const preferences = {
          ...state.libraryWorkspacePreferences,
          folderTree: { ...state.libraryWorkspacePreferences.folderTree, visible },
        };
        saveLibraryWorkspacePreferences(preferences);
        return { libraryWorkspacePreferences: preferences };
      });
    },

    setLibraryFolderTreeWidth: (width) => {
      set((state) => {
        const preferences = {
          ...state.libraryWorkspacePreferences,
          folderTree: { ...state.libraryWorkspacePreferences.folderTree, width },
        };
        const parsed = libraryWorkspacePreferencesSchema.safeParse(preferences);
        if (!parsed.success) return state;
        saveLibraryWorkspacePreferences(parsed.data);
        return { libraryLeftPanelWidth: width, libraryWorkspacePreferences: parsed.data };
      });
    },

    recordRecentRightPanel: (panel) => {
      set((state) => ({ recentRightPanels: createRecentRightPanels(panel, state.recentRightPanels) }));
    },

    setUI: (updater) => {
      set((state) => {
        const update = typeof updater === 'function' ? updater(state) : updater;
        const mountedLazyModalIds = collectOpenedLazyModalIds(state.mountedLazyModalIds, update);
        return mountedLazyModalIds === state.mountedLazyModalIds ? update : { ...update, mountedLazyModalIds };
      });
    },

    setRightPanel: (panelId) => {
      const current = get().activeRightPanel;
      if (panelId === current) {
        get().setEditorRegionVisibility('rightInspector', false);
      } else {
        const rendered = get().renderedRightPanel;
        const previousPanel = current ?? rendered;
        const currentIndex = previousPanel ? RIGHT_PANEL_ORDER.indexOf(previousPanel) : -1;
        const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
        set((state) => {
          const preferences = structuredClone(state.editorWorkspacePreferences);
          if (panelId && isEditingRightPanel(panelId)) {
            preferences.rightInspector.activePanel = panelId;
            preferences.rightInspector.visible = true;
            preferences.compact.toolsExpanded = true;
            preferences.compact.drawerState = 'expanded';
          }
          if (panelId)
            preferences.rightInspector.recentPanels = createRecentRightPanels(
              panelId,
              preferences.rightInspector.recentPanels,
            );
          saveEditorWorkspacePreferences(preferences);
          return {
            slideDirection: newIndex === currentIndex ? 0 : newIndex > currentIndex ? 1 : -1,
            activeRightPanel: panelId,
            renderedRightPanel: previousPanel,
            mountedKeepAlivePanels:
              panelId !== null && getRightPanelHostDescriptor(panelId).keepAlive === 'session'
                ? new Set([...state.mountedKeepAlivePanels, panelId])
                : state.mountedKeepAlivePanels,
            ...(panelId === null
              ? {}
              : { recentRightPanels: createRecentRightPanels(panelId, state.recentRightPanels) }),
            editorWorkspacePreferences: preferences,
          };
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
