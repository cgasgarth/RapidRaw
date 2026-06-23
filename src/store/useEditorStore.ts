import { create } from 'zustand';

import { ToolType } from '../components/panel/right/Masks';
import { type Adjustments, DisplayMode, INITIAL_ADJUSTMENTS, type MaskContainer } from '../utils/adjustments';
import { goToEditHistoryIndex, pushEditHistoryEntry, redoEditHistory, undoEditHistory } from '../utils/editHistory';

import type { ChannelConfig } from '../components/adjustments/Curves';
import type { OverlayMode } from '../components/panel/right/CropPanel';
import type { SelectedImage, WaveformData, BrushSettings } from '../components/ui/AppProperties';
import type { BaseRenderSize, ImageDimensions } from '../hooks/useImageRenderSize';
import type { MaskOverlaySettings } from '../schemas/maskOverlaySchemas';
import type { GamutWarningOverlayPayload } from '../schemas/tauriEventSchemas';
import type { BasicToneCommandEnvelope } from '../utils/basicToneCommandBridge';

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
  showOriginal: boolean;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  isGamutWarningOverlayVisible: boolean;
  isExportSoftProofEnabled: boolean;
  exportSoftProofRecipeId: string | null;
  isWaveformVisible: boolean;
  activeWaveformChannel: DisplayMode;
  waveformHeight: number;

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

export const useEditorStore = create<EditorState>((set) => ({
  selectedImage: null,
  adjustments: INITIAL_ADJUSTMENTS,
  lastBasicToneCommand: null,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  showOriginal: false,
  histogram: null,
  waveform: null,
  gamutWarningOverlay: null,
  isGamutWarningOverlayVisible: true,
  isExportSoftProofEnabled: false,
  exportSoftProofRecipeId: null,
  isWaveformVisible: false,
  activeWaveformChannel: DisplayMode.Luma,
  waveformHeight: 220,

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
  maskOverlaySettings: { edgeThreshold: 0.5, mode: 'rubylith', opacity: 0.5 },
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
    set((state) => (typeof updater === 'function' ? updater(state) : updater));
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
