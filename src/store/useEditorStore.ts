import { create } from 'zustand';
import type { ChannelConfig } from '../components/adjustments/Curves';
import type { OverlayMode } from '../components/panel/right/color/CropPanel';
import { ToolType } from '../components/panel/right/layers/Masks';
import type { BrushSettings, SelectedImage, WaveformData } from '../components/ui/AppProperties';
import type { BaseRenderSize, ImageDimensions } from '../hooks/viewport/useImageRenderSize';
import type { MaskOverlaySettings } from '../schemas/masks/maskOverlaySchemas';
import type { GamutWarningOverlayPayload } from '../schemas/tauriEventSchemas';
import type { PreviewQualityStatus } from '../utils/adaptivePreviewQuality';
import {
  type AdjustmentSnapshot,
  PatchResidencyTracker,
  publishAdjustmentSnapshot,
} from '../utils/adjustmentSnapshots';
import { type Adjustments, DisplayMode, INITIAL_ADJUSTMENTS, type MaskContainer } from '../utils/adjustments';
import { type AiEditCommand, type AiEditSelection, resolveAiEditSelection } from '../utils/aiEditSelection';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  BasicToneApprovalClass,
  type BasicToneCommandEnvelope,
} from '../utils/basicToneCommandBridge';
import { isPendingExportSoftProofGamutWarningOverlay } from '../utils/color/runtime/gamutWarningDisplay';
import {
  createEditHistoryCheckpoint,
  type EditHistoryCheckpoint,
  goToEditHistoryIndex,
  pushEditHistoryEntryWithCheckpoints,
  redoEditHistory,
  renameEditHistoryCheckpoint,
  undoEditHistory,
} from '../utils/editHistory';
import {
  DEFAULT_EDITOR_COMPARE_STATE,
  type EditorCompareCommand,
  type EditorCompareState,
  reduceEditorCompare,
} from '../utils/editorCompare';
import { DEFAULT_EDITOR_ZOOM_MODE, type EditorZoomMode } from '../utils/editorZoom';
import { loadMaskOverlaySettingsPreference } from '../utils/mask/maskOverlayPreferences';
import { PANEL_SCOPES_HEIGHT } from '../utils/waveformSizing';
import type { WhiteBalancePickerRuntimeReceipt } from '../utils/whiteBalancePicker';

export interface InteractivePatch {
  basePreviewUrl: string | null;
  fullHeight: number;
  fullWidth: number;
  geometryIdentity: number;
  url: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  pixelHeight: number;
  pixelWidth: number;
  sourceImagePath: string;
}

export interface CopiedSectionAdjustments {
  section: string;
  values: Partial<Adjustments>;
}

export interface PresetApplication {
  before: Adjustments;
  expected: Adjustments;
  id: string;
  imagePath: string | null;
  name: string;
}

export interface ExportSoftProofTransformState {
  blackPointCompensation: string | null;
  colorManagedTransform: string | null;
  effectiveColorProfile: string | null;
  effectiveRenderingIntent: string | null;
  policyStatus: string | null;
  policyVersion: string | null;
  sourcePrecisionPath: string | null;
  transformApplied: boolean | null;
  transformPolicyFingerprint: string | null;
}

export interface PreviewScopeStatus {
  displayTransformLabel: string;
  exportProfileLabel: string | null;
  exportRenderingIntentLabel: string | null;
  histogramReady: boolean;
  path: string;
  renderBasis: 'display_referred' | 'editor_preview' | 'export_preview' | 'working_rgb';
  softProofTransformApplied: boolean;
  sourceLabel: string;
  updatedAt: string;
  waveformReady: boolean;
  workingTransformLabel: string;
  warningCodes: string[];
}

export type PreviewScopeRecoveryState = 'idle' | 'loading' | 'error';

export type PanelScopesLayout = 'overlay' | 'stacked';
export type { EditorCompareMode } from '../utils/editorCompare';

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  /** Once published, this adjustment object graph is immutable for the lifetime of the snapshot. */
  adjustmentSnapshot: AdjustmentSnapshot;
  imageSessionId: number;
  viewportRevision: number;
  proofRevision: number;
  lastBasicToneCommand: BasicToneCommandEnvelope | null;

  // History State
  history: Adjustments[];
  historyCheckpoints: EditHistoryCheckpoint[];
  historyIndex: number;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  transformedOriginalUrl: string | null;
  interactivePatch: InteractivePatch | null;
  previewQualityStatus: PreviewQualityStatus | null;
  compare: EditorCompareState;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  previewScopeStatus: PreviewScopeStatus | null;
  previewScopeRecoveryRequestId: number;
  previewScopeRecoveryState: PreviewScopeRecoveryState;
  previewScopeRecoveryError: string | null;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  isGamutWarningOverlayVisible: boolean;
  isExportSoftProofEnabled: boolean;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  isWaveformVisible: boolean;
  activeWaveformChannel: DisplayMode;
  waveformHeight: number;
  panelScopesLayout: PanelScopesLayout;

  // Interaction State
  isSliderDragging: boolean;
  zoom: number;
  zoomMode: EditorZoomMode;
  displaySize: ImageDimensions;
  previewSize: ImageDimensions;
  requestedPreviewResolution: number;
  renderedPreviewResolution: number;
  baseRenderSize: BaseRenderSize;
  viewportEpoch: number;
  originalSize: ImageDimensions;

  // Tools State
  isRotationActive: boolean;
  overlayMode: OverlayMode;
  overlayRotation: number;
  maskOverlaySettings: MaskOverlaySettings;
  isStraightenActive: boolean;
  isWbPickerActive: boolean;
  lastWhiteBalancePickerReceipt: WhiteBalancePickerRuntimeReceipt | null;
  liveRotation: number | null;
  brushSettings: BrushSettings | null;

  // Masks & AI
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  isMaskControlHovered: boolean;
  isGeneratingAiMask: boolean;
  isGeneratingAi: boolean;
  isAIConnectorConnected: boolean;
  hasRenderedFirstFrame: boolean;
  wgpuFrameSerial: number;
  wgpuFailureSerial: number;
  patchResidency: PatchResidencyTracker;

  // Clipboard
  copiedSectionAdjustments: CopiedSectionAdjustments | null;
  copiedMask: MaskContainer | null;
  copiedAdjustments: Partial<Adjustments> | null;
  presetApplication: PresetApplication | null;

  // Actions
  setEditor: (updater: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
  applyAiEditCommand: (command: AiEditCommand) => AiEditSelection | null;
  dispatchCompare: (command: EditorCompareCommand) => void;
  setPresetApplication: (presetApplication: PresetApplication | null) => void;
  createHistoryCheckpoint: (label: string) => void;
  applyBasicToneCommand: (command: BasicToneCommandEnvelope) => void;
  pushHistory: (newAdjustments: Adjustments) => void;
  renameHistoryCheckpoint: (checkpointId: string, label: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: (initialState: Adjustments) => void;
  goToHistoryIndex: (index: number) => void;
}

const shouldRevalidateGamutWarningOverlay = (update: Partial<EditorState>): boolean =>
  'selectedImage' in update ||
  'gamutWarningOverlay' in update ||
  'isExportSoftProofEnabled' in update ||
  'exportSoftProofRecipeId' in update ||
  'exportSoftProofTransform' in update;

const normalizeCompareStateUpdate = (state: EditorState, update: Partial<EditorState>): void => {
  if ('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) {
    update.compare = {
      ...DEFAULT_EDITOR_COMPARE_STATE,
      source: { identity: update.selectedImage?.path ?? null, kind: 'original' },
    };
    update.transformedOriginalUrl = null;
    update.previewQualityStatus = null;
  }
};

const createSessionCheckpointId = (historyIndex: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `checkpoint-${String(historyIndex)}-${String(Date.now())}`;
};

const historyNavigationPreviewInvalidation = {
  exportSoftProofTransform: null,
  finalPreviewUrl: null,
  gamutWarningOverlay: null,
  interactivePatch: null,
  previewQualityStatus: null,
  previewScopeStatus: null,
  previewScopeRecoveryRequestId: 0,
  previewScopeRecoveryState: 'idle',
  previewScopeRecoveryError: null,
  transformedOriginalUrl: null,
  uncroppedAdjustedPreviewUrl: null,
} satisfies Partial<EditorState>;

const publishAdjustmentState = (state: EditorState, adjustments: Adjustments) => ({
  adjustments,
  adjustmentSnapshot: publishAdjustmentSnapshot(state.adjustmentSnapshot, adjustments),
});

const resolveAiSelectionState = (
  state: EditorState,
  adjustments: Adjustments,
  requested: AiEditSelection = {
    containerId: state.activeAiPatchContainerId,
    subMaskId: state.activeAiSubMaskId,
  },
) => {
  const selection = resolveAiEditSelection(adjustments.aiPatches, requested);
  return {
    activeAiPatchContainerId: selection.containerId,
    activeAiSubMaskId: selection.subMaskId,
  };
};

const assertApprovedBasicToneCommand = (command: BasicToneCommandEnvelope, state: EditorState): void => {
  if (command.commandType !== 'toneColor.setBasicTone') {
    throw new Error('Editor basic-tone apply expected toneColor.setBasicTone command.');
  }
  if (command.dryRun) {
    throw new Error('Editor basic-tone apply requires dryRun=false.');
  }
  if (command.approval.approvalClass !== BasicToneApprovalClass.EditApply || command.approval.state !== 'approved') {
    throw new Error('Editor basic-tone apply requires approved edit-apply approval.');
  }
  if (
    command.parameters.acceptedDryRunPlanHash === undefined ||
    command.parameters.acceptedDryRunPlanId === undefined
  ) {
    throw new Error('Editor basic-tone apply requires accepted dry-run plan identity.');
  }
  if (command.expectedGraphRevision !== `history_${state.historyIndex}`) {
    throw new Error('Editor basic-tone apply rejected stale graph revision.');
  }
};

const initialAdjustments = structuredClone(INITIAL_ADJUSTMENTS);
const initialAdjustmentSnapshot = publishAdjustmentSnapshot(null, initialAdjustments);

const viewportRevisionKeys: Array<keyof EditorState> = [
  'baseRenderSize',
  'displaySize',
  'previewSize',
  'viewportEpoch',
  'zoomMode',
];

export const useEditorStore = create<EditorState>((set) => ({
  selectedImage: null,
  adjustments: initialAdjustments,
  adjustmentSnapshot: initialAdjustmentSnapshot,
  imageSessionId: 1,
  viewportRevision: 1,
  proofRevision: 1,
  lastBasicToneCommand: null,
  history: [initialAdjustments],
  historyCheckpoints: [],
  historyIndex: 0,

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  compare: DEFAULT_EDITOR_COMPARE_STATE,
  histogram: null,
  waveform: null,
  previewScopeStatus: null,
  previewScopeRecoveryRequestId: 0,
  previewScopeRecoveryState: 'idle',
  previewScopeRecoveryError: null,
  gamutWarningOverlay: null,
  isGamutWarningOverlayVisible: false,
  isExportSoftProofEnabled: false,
  exportSoftProofRecipeId: null,
  exportSoftProofTransform: null,
  isWaveformVisible: false,
  activeWaveformChannel: DisplayMode.Luma,
  waveformHeight: PANEL_SCOPES_HEIGHT.default,
  panelScopesLayout: 'stacked',

  isSliderDragging: false,
  interactivePatch: null,
  previewQualityStatus: null,
  activeMaskContainerId: null,
  activeMaskId: null,
  activeAiPatchContainerId: null,
  activeAiSubMaskId: null,

  zoom: 1,
  zoomMode: DEFAULT_EDITOR_ZOOM_MODE,
  displaySize: { width: 0, height: 0 },
  previewSize: { width: 0, height: 0 },
  requestedPreviewResolution: 0,
  renderedPreviewResolution: 0,
  baseRenderSize: { width: 0, height: 0, offsetX: 0, offsetY: 0, containerWidth: 0, containerHeight: 0 },
  viewportEpoch: 0,
  originalSize: { width: 0, height: 0 },

  isRotationActive: false,
  overlayMode: 'thirds',
  overlayRotation: 0,
  maskOverlaySettings: loadMaskOverlaySettingsPreference(),
  transformedOriginalUrl: null,
  isStraightenActive: false,
  isWbPickerActive: false,
  lastWhiteBalancePickerReceipt: null,
  liveRotation: null,

  copiedSectionAdjustments: null,
  copiedMask: null,
  brushSettings: { size: 50, feather: 50, tool: ToolType.Brush },
  copiedAdjustments: null,
  presetApplication: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  isMaskControlHovered: false,
  hasRenderedFirstFrame: false,
  wgpuFrameSerial: 0,
  wgpuFailureSerial: 0,
  patchResidency: new PatchResidencyTracker(1),

  setEditor: (updater) => {
    set((state) => {
      const rawUpdate = typeof updater === 'function' ? updater(state) : updater;
      const update: Partial<EditorState> = { ...rawUpdate };

      if ('adjustments' in update && update.adjustments !== undefined) {
        update.adjustmentSnapshot = publishAdjustmentSnapshot(state.adjustmentSnapshot, update.adjustments);
        update.adjustments = update.adjustmentSnapshot.value as Adjustments;
        Object.assign(
          update,
          resolveAiSelectionState(state, update.adjustments, {
            containerId:
              'activeAiPatchContainerId' in update
                ? (update.activeAiPatchContainerId ?? null)
                : state.activeAiPatchContainerId,
            subMaskId: 'activeAiSubMaskId' in update ? (update.activeAiSubMaskId ?? null) : state.activeAiSubMaskId,
          }),
        );
      } else if ('activeAiPatchContainerId' in update || 'activeAiSubMaskId' in update) {
        Object.assign(
          update,
          resolveAiSelectionState(state, state.adjustments, {
            containerId:
              'activeAiPatchContainerId' in update
                ? (update.activeAiPatchContainerId ?? null)
                : state.activeAiPatchContainerId,
            subMaskId: 'activeAiSubMaskId' in update ? (update.activeAiSubMaskId ?? null) : state.activeAiSubMaskId,
          }),
        );
      }
      if ('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) {
        update.imageSessionId = state.imageSessionId + 1;
        state.patchResidency.reset(update.imageSessionId);
      }
      if (viewportRevisionKeys.some((key) => key in update && update[key] !== state[key])) {
        update.viewportRevision = state.viewportRevision + 1;
      }
      if (
        ('isExportSoftProofEnabled' in update && update.isExportSoftProofEnabled !== state.isExportSoftProofEnabled) ||
        ('exportSoftProofRecipeId' in update && update.exportSoftProofRecipeId !== state.exportSoftProofRecipeId)
      ) {
        update.proofRevision = state.proofRevision + 1;
      }

      normalizeCompareStateUpdate(state, update);

      if ('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) {
        update.presetApplication = null;
      }

      if (!shouldRevalidateGamutWarningOverlay(update)) return update;

      const nextState = { ...state, ...update };
      const nextOverlay = 'gamutWarningOverlay' in update ? update.gamutWarningOverlay : state.gamutWarningOverlay;

      if (
        nextOverlay &&
        isPendingExportSoftProofGamutWarningOverlay(nextOverlay, {
          exportSoftProofRecipeId: nextState.exportSoftProofRecipeId,
          exportSoftProofTransform: nextState.exportSoftProofTransform,
          isExportSoftProofEnabled: nextState.isExportSoftProofEnabled,
          selectedImagePath: nextState.selectedImage?.path ?? null,
        })
      ) {
        return update;
      }

      return { ...update, gamutWarningOverlay: null };
    });
  },

  applyAiEditCommand: (command) => {
    let committedSelection: AiEditSelection | null = null;
    set((state) => {
      const result = command({
        aiPatches: state.adjustments.aiPatches,
        selection: {
          containerId: state.activeAiPatchContainerId,
          subMaskId: state.activeAiSubMaskId,
        },
      });
      if (!result) return {};

      const selection = resolveAiEditSelection(result.aiPatches, result.selection);
      const adjustments = { ...state.adjustments, aiPatches: result.aiPatches };
      const nextHistory = pushEditHistoryEntryWithCheckpoints(
        state.history,
        state.historyIndex,
        adjustments,
        state.historyCheckpoints,
      );
      committedSelection = selection;

      return {
        ...publishAdjustmentState(state, adjustments),
        activeAiPatchContainerId: selection.containerId,
        activeAiSubMaskId: selection.subMaskId,
        brushSettings: result.selectBrushTool
          ? {
              ...(state.brushSettings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
              tool: ToolType.Brush,
            }
          : state.brushSettings,
        history: nextHistory.history,
        historyCheckpoints: nextHistory.checkpoints,
        historyIndex: nextHistory.historyIndex,
      };
    });
    return committedSelection;
  },

  dispatchCompare: (command) => set((state) => ({ compare: reduceEditorCompare(state.compare, command) })),

  setPresetApplication: (presetApplication) => set({ presetApplication }),

  createHistoryCheckpoint: (label) => {
    set((state) => ({
      historyCheckpoints: createEditHistoryCheckpoint(
        state.historyCheckpoints,
        state.historyIndex,
        label,
        createSessionCheckpointId(state.historyIndex),
        new Date().toISOString(),
      ),
    }));
  },

  applyBasicToneCommand: (command) => {
    set((state) => {
      assertApprovedBasicToneCommand(command, state);
      const adjustments = applyBasicToneCommandEnvelopeToAdjustments(state.adjustments, command);
      const nextHistory = pushEditHistoryEntryWithCheckpoints(
        state.history,
        state.historyIndex,
        adjustments,
        state.historyCheckpoints,
      );

      return {
        ...historyNavigationPreviewInvalidation,
        ...publishAdjustmentState(state, adjustments),
        history: nextHistory.history,
        historyCheckpoints: nextHistory.checkpoints,
        historyIndex: nextHistory.historyIndex,
        lastBasicToneCommand: command,
      };
    });
  },

  pushHistory: (newAdj) => {
    set((state) => {
      const nextHistory = pushEditHistoryEntryWithCheckpoints(
        state.history,
        state.historyIndex,
        newAdj,
        state.historyCheckpoints,
      );
      return {
        history: nextHistory.history,
        historyCheckpoints: nextHistory.checkpoints,
        historyIndex: nextHistory.historyIndex,
      };
    });
  },

  renameHistoryCheckpoint: (checkpointId, label) => {
    set((state) => ({
      historyCheckpoints: renameEditHistoryCheckpoint(state.historyCheckpoints, checkpointId, label),
    }));
  },

  undo: () => {
    set((state) => {
      const nextState = undoEditHistory(state);
      if (nextState.historyIndex === state.historyIndex) return {};
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishAdjustmentState(state, nextState.adjustments),
        ...resolveAiSelectionState(state, nextState.adjustments),
        historyIndex: nextState.historyIndex,
      };
    });
  },

  redo: () => {
    set((state) => {
      const nextState = redoEditHistory(state);
      if (nextState.historyIndex === state.historyIndex) return {};
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishAdjustmentState(state, nextState.adjustments),
        ...resolveAiSelectionState(state, nextState.adjustments),
        historyIndex: nextState.historyIndex,
      };
    });
  },

  resetHistory: (initialState) => {
    set((state) => ({
      history: [initialState],
      historyCheckpoints: [],
      historyIndex: 0,
      ...publishAdjustmentState(state, initialState),
      ...resolveAiSelectionState(state, initialState),
    }));
  },

  goToHistoryIndex: (index) => {
    set((state) => {
      const nextState = goToEditHistoryIndex(state, index);
      if (nextState.historyIndex === state.historyIndex) return {};
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishAdjustmentState(state, nextState.adjustments),
        ...resolveAiSelectionState(state, nextState.adjustments),
        historyIndex: nextState.historyIndex,
      };
    });
  },
}));
