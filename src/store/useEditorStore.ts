import { create } from 'zustand';
import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { MatchLookApplicationReceiptV1 } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import type { ChannelConfig } from '../components/adjustments/Curves';
import type { OverlayMode } from '../components/panel/right/color/CropPanel';
import { ToolType } from '../components/panel/right/layers/Masks';
import type { BrushSettings, SelectedImage, WaveformData } from '../components/ui/AppProperties';
import type { BaseRenderSize, ImageDimensions } from '../hooks/viewport/useImageRenderSize';
import type { ProgressiveImageFrameReceipt } from '../schemas/imageLoaderSchemas';
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
import type { AutoEditPreviewSession } from '../utils/autoEditTransaction';
import {
  applyBasicToneCommandEnvelopeToAdjustments,
  BasicToneApprovalClass,
  type BasicToneCommandEnvelope,
} from '../utils/basicToneCommandBridge';
import { isPendingExportSoftProofGamutWarningOverlay } from '../utils/color/runtime/gamutWarningDisplay';
import { legacyAdjustmentsToEditDocumentV2 } from '../utils/editDocumentV2';
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
import {
  type EditApplicationReceipt,
  type EditTransactionRequest,
  type EditTransactionResult,
  reduceEditTransaction,
} from '../utils/editTransaction';
import { loadMaskOverlaySettingsPreference } from '../utils/mask/maskOverlayPreferences';
import type { ReferenceMatchGroup, ReferenceMatchReference, ReferenceSpatialAnalysis } from '../utils/referenceMatch';
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

export interface EditorImageSession {
  generation: number;
  id: string;
  path: string;
  source: 'cache' | 'cold-load';
  status: 'selecting' | 'loading' | 'ready' | 'failed';
}

export const createEditorImageSession = ({
  generation,
  path,
  source,
}: Pick<EditorImageSession, 'generation' | 'path' | 'source'>): EditorImageSession => ({
  generation,
  id: `editor-image-session:${String(generation)}:${path.length}:${path}`,
  path,
  source,
  status: source === 'cache' ? 'ready' : 'loading',
});

export interface NavigatorPreviewArtifact {
  graphIdentity: string;
  id: string;
  imageSessionId: string;
  url: string;
}

export interface ProvisionalPreviewFrame {
  receipt: ProgressiveImageFrameReceipt;
  url: string;
}

export interface ReferenceMatchPreview {
  adjustments: Adjustments;
  baseAdjustmentRevision: number;
  enabledGroups: ReferenceMatchGroup[];
  impact: number;
  proposalFingerprint: string;
  targetPath: string;
}

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  /** Versioned render authority; flat adjustments are the compatibility projection. */
  editDocumentV2: EditDocumentV2;
  /** Monotonic revision used to reject stale preview/commit proposals. */
  adjustmentRevision: number;
  /** Once published, this adjustment object graph is immutable for the lifetime of the snapshot. */
  adjustmentSnapshot: AdjustmentSnapshot;
  lastEditApplicationReceipt: EditApplicationReceipt | null;
  imageSessionId: number;
  imageSession: EditorImageSession | null;
  viewportRevision: number;
  proofRevision: number;
  lastBasicToneCommand: BasicToneCommandEnvelope | null;

  // History State
  history: Adjustments[];
  historyCheckpoints: EditHistoryCheckpoint[];
  historyIndex: number;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  provisionalPreviewFrame: ProvisionalPreviewFrame | null;
  navigatorPreviewArtifact: NavigatorPreviewArtifact | null;
  uncroppedAdjustedPreviewUrl: string | null;
  transformedOriginalUrl: string | null;
  interactivePatch: InteractivePatch | null;
  previewQualityStatus: PreviewQualityStatus | null;
  compare: EditorCompareState;
  referenceMatchReferences: ReferenceMatchReference[];
  lastReferenceMatchApplicationReceipt: MatchLookApplicationReceiptV1 | null;
  referenceMatchPreview: ReferenceMatchPreview | null;
  autoEditPreviewSession: AutoEditPreviewSession | null;

  // Analytics
  histogram: ChannelConfig | null;
  referenceMatchSpatialAnalysis: ReferenceSpatialAnalysis | null;
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
  publishWhiteBalancePickerPreview: (adjustments: Adjustments) => void;
  applyEditTransaction: (request: EditTransactionRequest) => EditTransactionResult;
  applyAiEditCommand: (command: AiEditCommand) => AiEditSelection | null;
  dispatchCompare: (command: EditorCompareCommand) => void;
  setReferenceMatchReferences: (
    updater: ReferenceMatchReference[] | ((references: ReferenceMatchReference[]) => ReferenceMatchReference[]),
  ) => void;
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
    const currentCompareSource = state.compare?.source ?? DEFAULT_EDITOR_COMPARE_STATE.source;
    if (currentCompareSource.kind === 'original') {
      update.compare = {
        ...DEFAULT_EDITOR_COMPARE_STATE,
        source: { identity: update.selectedImage?.path ?? null, kind: 'original' },
      };
    }
    update.transformedOriginalUrl = null;
    update.previewQualityStatus = null;
    update.lastReferenceMatchApplicationReceipt = null;
    update.referenceMatchPreview = null;
  }
};

const createSessionCheckpointId = (historyIndex: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `checkpoint-${String(historyIndex)}-${String(Date.now())}`;
};

const historyNavigationPreviewInvalidation = {
  exportSoftProofTransform: null,
  finalPreviewUrl: null,
  provisionalPreviewFrame: null,
  navigatorPreviewArtifact: null,
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

const publishAdjustmentState = (
  state: EditorState,
  adjustments: Adjustments,
  editDocumentV2: EditDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments),
) => ({
  adjustments,
  editDocumentV2,
  adjustmentSnapshot: publishAdjustmentSnapshot(state.adjustmentSnapshot, adjustments, editDocumentV2),
  autoEditPreviewSession: null,
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
const initialEditDocumentV2 = legacyAdjustmentsToEditDocumentV2(initialAdjustments);
const initialAdjustmentSnapshot = publishAdjustmentSnapshot(null, initialAdjustments, initialEditDocumentV2);

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
  editDocumentV2: initialEditDocumentV2,
  adjustmentRevision: 0,
  adjustmentSnapshot: initialAdjustmentSnapshot,
  lastEditApplicationReceipt: null,
  imageSessionId: 1,
  imageSession: null,
  viewportRevision: 1,
  proofRevision: 1,
  lastBasicToneCommand: null,
  history: [initialAdjustments],
  historyCheckpoints: [],
  historyIndex: 0,

  finalPreviewUrl: null,
  provisionalPreviewFrame: null,
  navigatorPreviewArtifact: null,
  uncroppedAdjustedPreviewUrl: null,
  compare: DEFAULT_EDITOR_COMPARE_STATE,
  referenceMatchReferences: [],
  lastReferenceMatchApplicationReceipt: null,
  referenceMatchPreview: null,
  autoEditPreviewSession: null,
  histogram: null,
  referenceMatchSpatialAnalysis: null,
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
        if (!('adjustmentRevision' in update)) update.adjustmentRevision = state.adjustmentRevision + 1;
        update.referenceMatchPreview = null;
        update.autoEditPreviewSession = null;
        update.editDocumentV2 = legacyAdjustmentsToEditDocumentV2(update.adjustments);
        update.adjustmentSnapshot = publishAdjustmentSnapshot(
          state.adjustmentSnapshot,
          update.adjustments,
          update.editDocumentV2,
        );
        update.adjustments = update.adjustmentSnapshot.value as Adjustments;
        update.lastEditApplicationReceipt = null;
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
      if ('imageSession' in update) {
        update.imageSessionId = update.imageSession?.generation ?? state.imageSessionId + 1;
        update.navigatorPreviewArtifact = null;
        update.provisionalPreviewFrame = null;
        state.patchResidency.reset(update.imageSessionId);
      } else if (
        'selectedImage' in update &&
        update.selectedImage?.path !== state.selectedImage?.path &&
        state.imageSession?.path !== update.selectedImage?.path
      ) {
        update.imageSessionId = state.imageSessionId + 1;
        update.imageSession =
          update.selectedImage === null
            ? null
            : createEditorImageSession({
                generation: update.imageSessionId,
                path: update.selectedImage?.path ?? '',
                source: update.selectedImage?.isReady ? 'cache' : 'cold-load',
              });
        update.navigatorPreviewArtifact = null;
        state.patchResidency.reset(update.imageSessionId);
      }
      if ('finalPreviewUrl' in update && !('navigatorPreviewArtifact' in update)) {
        update.navigatorPreviewArtifact = null;
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
        update.autoEditPreviewSession = null;
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

  publishWhiteBalancePickerPreview: (adjustments) =>
    set((state) => ({
      ...historyNavigationPreviewInvalidation,
      ...publishAdjustmentState(state, adjustments),
    })),

  applyEditTransaction: (request) => {
    let result: EditTransactionResult | null = null;
    set((state) => {
      if (request.persistence === 'preview-only') {
        throw new Error('edit_transaction.preview_requires_proposal');
      }
      const currentImageSessionId = state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;
      const nextResult = reduceEditTransaction(
        state.adjustments,
        state.adjustmentRevision,
        request,
        currentImageSessionId,
        state.editDocumentV2,
      );
      const activeInteractionReceipt = state.lastEditApplicationReceipt;
      const coalescedReceipt =
        request.history === 'coalesced-interaction' &&
        state.historyIndex === state.history.length - 1 &&
        state.history[state.historyIndex] === state.adjustments &&
        activeInteractionReceipt?.transactionId === request.transactionId &&
        activeInteractionReceipt.imageSessionId === request.imageSessionId &&
        activeInteractionReceipt.source === request.source
          ? activeInteractionReceipt
          : null;
      const publishedResult = coalescedReceipt
        ? {
            ...nextResult,
            applicationReceipt: {
              ...nextResult.applicationReceipt,
              baseAdjustmentRevision: coalescedReceipt.baseAdjustmentRevision,
            },
          }
        : nextResult;
      result = publishedResult;
      if (nextResult.noOp) return {};
      const nextHistory =
        request.history === 'none'
          ? { history: state.history, checkpoints: state.historyCheckpoints, historyIndex: state.historyIndex }
          : request.history === 'reset'
            ? { history: [nextResult.after], checkpoints: [], historyIndex: 0 }
            : coalescedReceipt
              ? {
                  history: state.history.map((entry, index) =>
                    index === state.historyIndex ? nextResult.after : entry,
                  ),
                  checkpoints: state.historyCheckpoints,
                  historyIndex: state.historyIndex,
                }
              : pushEditHistoryEntryWithCheckpoints(
                  state.history,
                  state.historyIndex,
                  nextResult.after,
                  state.historyCheckpoints,
                );
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishAdjustmentState(state, nextResult.after, nextResult.afterEditDocumentV2),
        adjustmentRevision: nextResult.nextAdjustmentRevision,
        lastEditApplicationReceipt: publishedResult.applicationReceipt,
        history: nextHistory.history,
        historyCheckpoints: nextHistory.checkpoints,
        historyIndex: nextHistory.historyIndex,
      };
    });
    if (!result) throw new Error('edit_transaction.not_applied');
    return result;
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

  setReferenceMatchReferences: (updater) =>
    set((state) => ({
      referenceMatchReferences: typeof updater === 'function' ? updater(state.referenceMatchReferences) : updater,
    })),

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

export const isEditorImageSessionCurrent = (sessionId: string): boolean =>
  useEditorStore.getState().imageSession?.id === sessionId;
