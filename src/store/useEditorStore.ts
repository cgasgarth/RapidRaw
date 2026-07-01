import { create } from 'zustand';
import type { ChannelConfig } from '../components/adjustments/Curves';
import type { OverlayMode } from '../components/panel/right/color/CropPanel';
import { ToolType } from '../components/panel/right/layers/Masks';
import type { BrushSettings, SelectedImage, WaveformData } from '../components/ui/AppProperties';
import type { BaseRenderSize, ImageDimensions } from '../hooks/viewport/useImageRenderSize';
import type { MaskOverlaySettings } from '../schemas/masks/maskOverlaySchemas';
import type { GamutWarningOverlayPayload } from '../schemas/tauriEventSchemas';
import { type Adjustments, DisplayMode, INITIAL_ADJUSTMENTS, type MaskContainer } from '../utils/adjustments';
import type { BasicToneCommandEnvelope } from '../utils/basicToneCommandBridge';
import { isPendingExportSoftProofGamutWarningOverlay } from '../utils/color/runtime/gamutWarningDisplay';
import { goToEditHistoryIndex, pushEditHistoryEntry, redoEditHistory, undoEditHistory } from '../utils/editHistory';
import { loadMaskOverlaySettingsPreference } from '../utils/mask/maskOverlayPreferences';
import { PANEL_SCOPES_HEIGHT } from '../utils/waveformSizing';

export interface InteractivePatch {
  url: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

export interface CopiedSectionAdjustments {
  section: string;
  values: Partial<Adjustments>;
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

export type PanelScopesLayout = 'overlay' | 'stacked';
export type EditorCompareMode = 'off' | 'hold-original' | 'split-wipe' | 'side-by-side';

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  lastBasicToneCommand: BasicToneCommandEnvelope | null;

  // History State
  history: Adjustments[];
  historyIndex: number;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  transformedOriginalUrl: string | null;
  interactivePatch: InteractivePatch | null;
  compareMode: EditorCompareMode;
  showOriginal: boolean;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  previewScopeStatus: PreviewScopeStatus | null;
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
  displaySize: ImageDimensions;
  previewSize: ImageDimensions;
  baseRenderSize: BaseRenderSize;
  originalSize: ImageDimensions;

  // Tools State
  isRotationActive: boolean;
  overlayMode: OverlayMode;
  overlayRotation: number;
  maskOverlaySettings: MaskOverlaySettings;
  isStraightenActive: boolean;
  isWbPickerActive: boolean;
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
  patchesSentToBackend: Set<string>;

  // Clipboard
  copiedSectionAdjustments: CopiedSectionAdjustments | null;
  copiedMask: MaskContainer | null;
  copiedAdjustments: Partial<Adjustments> | null;

  // Actions
  setEditor: (updater: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
  pushHistory: (newAdjustments: Adjustments) => void;
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

export const useEditorStore = create<EditorState>((set) => ({
  selectedImage: null,
  adjustments: INITIAL_ADJUSTMENTS,
  lastBasicToneCommand: null,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  compareMode: 'off',
  showOriginal: false,
  histogram: null,
  waveform: null,
  previewScopeStatus: null,
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
  activeMaskContainerId: null,
  activeMaskId: null,
  activeAiPatchContainerId: null,
  activeAiSubMaskId: null,

  zoom: 1,
  displaySize: { width: 0, height: 0 },
  previewSize: { width: 0, height: 0 },
  baseRenderSize: { width: 0, height: 0, offsetX: 0, offsetY: 0, containerWidth: 0, containerHeight: 0 },
  originalSize: { width: 0, height: 0 },

  isRotationActive: false,
  overlayMode: 'thirds',
  overlayRotation: 0,
  maskOverlaySettings: loadMaskOverlaySettingsPreference(),
  transformedOriginalUrl: null,
  isStraightenActive: false,
  isWbPickerActive: false,
  liveRotation: null,

  copiedSectionAdjustments: null,
  copiedMask: null,
  brushSettings: { size: 50, feather: 50, tool: ToolType.Brush },
  copiedAdjustments: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  isMaskControlHovered: false,
  hasRenderedFirstFrame: false,
  patchesSentToBackend: new Set<string>(),

  setEditor: (updater) => {
    set((state) => {
      const rawUpdate = typeof updater === 'function' ? updater(state) : updater;
      const update: Partial<EditorState> = { ...rawUpdate };

      if ('compareMode' in update) {
        update.showOriginal = update.compareMode === 'hold-original';
      } else if ('showOriginal' in update) {
        update.compareMode = update.showOriginal ? 'hold-original' : 'off';
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

  pushHistory: (newAdj) => {
    set((state) => {
      const nextHistory = pushEditHistoryEntry(state.history, state.historyIndex, newAdj);
      return nextHistory;
    });
  },

  undo: () => {
    set((state) => {
      const nextState = undoEditHistory(state);
      return { adjustments: nextState.adjustments, historyIndex: nextState.historyIndex };
    });
  },

  redo: () => {
    set((state) => {
      const nextState = redoEditHistory(state);
      return { adjustments: nextState.adjustments, historyIndex: nextState.historyIndex };
    });
  },

  resetHistory: (initialState) => {
    set({
      history: [initialState],
      historyIndex: 0,
      adjustments: initialState,
    });
  },

  goToHistoryIndex: (index) => {
    set((state) => {
      const nextState = goToEditHistoryIndex(state, index);
      return { adjustments: nextState.adjustments, historyIndex: nextState.historyIndex };
    });
  },
}));
