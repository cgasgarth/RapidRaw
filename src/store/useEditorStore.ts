import { create, type StoreApi } from 'zustand';
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
import { type Adjustments, type BasicAdjustment, DisplayMode, type MaskContainer } from '../utils/adjustments';
import { type AiEditCommand, type AiEditSelection, resolveAiEditSelection } from '../utils/aiEditSelection';
import { buildAiSourceArtifactEditTransaction } from '../utils/aiSourceArtifactEditTransaction';
import type { AutoEditPreviewSession } from '../utils/autoEditTransaction';
import { BasicToneApprovalClass, type BasicToneCommandEnvelope } from '../utils/basicToneCommandBridge';
import { type BasicToneCommitIdentity, buildBasicToneCommandEditTransaction } from '../utils/basicToneEditTransaction';
import {
  type BasicToneSliderInteraction,
  beginBasicToneSliderInteraction,
  buildBasicToneSliderInteractionRequest,
  isBasicToneSliderInteractionCurrent,
  reduceBasicToneSliderInteractionPreview,
} from '../utils/basicToneSliderInteraction';
import { isPendingExportSoftProofGamutWarningOverlay } from '../utils/color/runtime/gamutWarningDisplay';
import type { DetailModifierPreview } from '../utils/detailLoupe';
import { selectEditDocumentSourceArtifacts } from '../utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, type EditDocumentV2CopyPayload } from '../utils/editDocumentV2';
import {
  createEditHistoryCheckpoint,
  type EditHistoryCheckpoint,
  pushEditHistoryEntryWithCheckpoints,
  renameEditHistoryCheckpoint,
} from '../utils/editHistory';
import {
  DEFAULT_EDITOR_COMPARE_STATE,
  type EditorCompareCommand,
  type EditorCompareState,
  reduceEditorCompare,
} from '../utils/editorCompare';
import {
  type EditorTeardownTransactionRequest,
  type EditorTeardownTransactionResult,
  isEditorTeardownIdentityCurrent,
} from '../utils/editorTeardownTransaction';
import { DEFAULT_EDITOR_ZOOM_MODE, type EditorZoomMode } from '../utils/editorZoom';
import {
  areEditDocumentsEqual,
  type EditApplicationReceipt,
  type EditTransactionRequest,
  type EditTransactionResult,
  reduceEditTransaction,
} from '../utils/editTransaction';
import { buildHistoryNavigationEditTransaction } from '../utils/historyNavigationEditTransaction';
import { loadMaskOverlaySettingsPreference } from '../utils/mask/maskOverlayPreferences';
import type { PreviewArtifact, PreviewViewportTransformSnapshot } from '../utils/previewCoordinator';
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
  payload: EditDocumentV2CopyPayload;
}

interface PresetApplication {
  before: EditDocumentV2;
  expected: EditDocumentV2;
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

interface ProvisionalPreviewFrame {
  receipt: ProgressiveImageFrameReceipt;
  url: string;
}

interface ReferenceMatchPreview {
  baseAdjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  enabledGroups: ReferenceMatchGroup[];
  impact: number;
  proposalFingerprint: string;
  targetPath: string;
}

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  /** The sole mutable and persisted editor render authority. */
  editDocumentV2: EditDocumentV2;
  /** Monotonic revision used to reject stale preview/commit proposals. */
  adjustmentRevision: number;
  /** Once published, this adjustment object graph is immutable for the lifetime of the snapshot. */
  adjustmentSnapshot: AdjustmentSnapshot;
  lastEditApplicationReceipt: EditApplicationReceipt | null;
  imageSessionId: number;
  imageSession: EditorImageSession | null;
  viewportRevision: number;
  previewViewportTransform: PreviewViewportTransformSnapshot;
  proofRevision: number;
  lastBasicToneCommand: BasicToneCommandEnvelope | null;
  basicToneSliderInteraction: BasicToneSliderInteraction | null;

  // History State
  history: EditDocumentV2[];
  historyCheckpoints: EditHistoryCheckpoint[];
  historyIndex: number;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  presentedPreviewArtifact: PreviewArtifact | null;
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
  showClipping: boolean;
  isExportSoftProofEnabled: boolean;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  isWaveformVisible: boolean;
  activeWaveformChannel: DisplayMode;
  waveformHeight: number;
  panelScopesLayout: PanelScopesLayout;

  // Interaction State
  isSliderDragging: boolean;
  /** Transient Alt/Option diagnostic state; never persisted or included in edit history. */
  detailModifierPreview: DetailModifierPreview | null;
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
  copiedEditDocumentV2: EditDocumentV2CopyPayload | null;
  presetApplication: PresetApplication | null;

  // Actions
  publishPreviewViewportTransform: (transform: PreviewViewportTransformSnapshot) => void;
  setEditor: (updater: EditorStateUpdater) => void;
  hydrateEditorRenderAuthority: (updater: EditorRenderAuthorityHydrationUpdater) => void;
  publishWhiteBalancePickerPreview: (editDocumentV2: EditDocumentV2) => void;
  applyEditTransaction: (request: EditTransactionRequest) => EditTransactionResult;
  beginBasicToneSliderInteraction: (
    identity: BasicToneCommitIdentity,
    key: BasicAdjustment,
    interactionId: string,
  ) => boolean;
  updateBasicToneSliderInteraction: (interactionId: string, value: number) => void;
  commitBasicToneSliderInteraction: (interactionId: string) => EditTransactionResult | null;
  cancelBasicToneSliderInteraction: (interactionId: string) => void;
  applyEditorTeardownTransaction: (request: EditorTeardownTransactionRequest) => EditorTeardownTransactionResult;
  applyAiEditCommand: (command: AiEditCommand) => AiEditSelection | null;
  dispatchCompare: (command: EditorCompareCommand) => void;
  setReferenceMatchReferences: (
    updater: ReferenceMatchReference[] | ((references: ReferenceMatchReference[]) => ReferenceMatchReference[]),
  ) => void;
  setPresetApplication: (presetApplication: PresetApplication | null) => void;
  createHistoryCheckpoint: (label: string) => void;
  applyBasicToneCommand: (
    command: BasicToneCommandEnvelope,
    identity: BasicToneCommitIdentity,
  ) => EditTransactionResult;
  pushHistory: (expected: { adjustmentRevision: number; imageSessionId: string }) => void;
  renameHistoryCheckpoint: (checkpointId: string, label: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: (initialState: EditDocumentV2) => void;
  goToHistoryIndex: (index: number) => void;
}

const editorRenderAuthorityKeys = [
  'adjustmentRevision',
  'adjustmentSnapshot',
  'editDocumentV2',
  'history',
  'historyCheckpoints',
  'historyIndex',
] as const;
const removedEditorRenderAuthorityKeys = ['adjustments', 'editDocumentHistory'] as const;

type EditorRenderAuthorityKey = (typeof editorRenderAuthorityKeys)[number];
export type EditorStateUpdate = Omit<Partial<EditorState>, EditorRenderAuthorityKey>;
type EditorStateUpdater = EditorStateUpdate | ((state: EditorState) => EditorStateUpdate);
export type EditorRenderAuthorityHydration = EditorStateUpdate &
  Pick<EditorState, 'editDocumentV2'> &
  Partial<Pick<EditorState, 'adjustmentRevision' | 'history' | 'historyCheckpoints' | 'historyIndex'>>;
type EditorRenderAuthorityHydrationUpdater =
  | EditorRenderAuthorityHydration
  | ((state: EditorState) => EditorRenderAuthorityHydration);

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
    if (!('transformedOriginalUrl' in update)) update.transformedOriginalUrl = null;
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
  presentedPreviewArtifact: null,
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

const publishEditDocumentState = (state: EditorState, editDocumentV2: EditDocumentV2) => ({
  editDocumentV2,
  adjustmentSnapshot: publishAdjustmentSnapshot(state.adjustmentSnapshot, editDocumentV2),
  autoEditPreviewSession: null,
});

const resolveAiSelectionState = (
  state: EditorState,
  aiPatches: ReadonlyArray<Adjustments['aiPatches'][number]>,
  requested: AiEditSelection = {
    containerId: state.activeAiPatchContainerId,
    subMaskId: state.activeAiSubMaskId,
  },
) => {
  const selection = resolveAiEditSelection(aiPatches, requested);
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

const initialEditDocumentV2 = createDefaultEditDocumentV2();
const initialAdjustmentSnapshot = publishAdjustmentSnapshot(null, initialEditDocumentV2);

const viewportRevisionKeys: Array<keyof EditorState> = [
  'baseRenderSize',
  'displaySize',
  'previewViewportTransform',
  'previewSize',
  'viewportEpoch',
  'zoomMode',
];

const applyEditorStateUpdate = (
  set: StoreApi<EditorState>['setState'],
  updater: EditorStateUpdater | EditorRenderAuthorityHydrationUpdater,
  allowRenderAuthority: boolean,
): void => {
  set((state) => {
    const rawUpdate = typeof updater === 'function' ? updater(state) : updater;
    const forbiddenKey =
      removedEditorRenderAuthorityKeys.find((key) => key in rawUpdate) ??
      (allowRenderAuthority ? undefined : editorRenderAuthorityKeys.find((key) => key in rawUpdate));
    if (forbiddenKey !== undefined) {
      throw new Error(`editor.setEditor.render_authority_forbidden:${forbiddenKey}`);
    }
    if (allowRenderAuthority && !('editDocumentV2' in rawUpdate)) {
      throw new Error('editor.hydration.edit_document_required');
    }
    const update: Partial<EditorState> = { ...rawUpdate };

    if (
      state.basicToneSliderInteraction !== null &&
      (('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) ||
        ('imageSession' in update && update.imageSession?.id !== state.imageSession?.id) ||
        ('imageSessionId' in update && update.imageSessionId !== state.imageSessionId) ||
        'editDocumentV2' in update ||
        ('adjustmentRevision' in update && update.adjustmentRevision !== state.adjustmentRevision))
    ) {
      update.basicToneSliderInteraction = null;
      update.isSliderDragging = false;
    }

    if (
      ('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) ||
      ('imageSession' in update && update.imageSession?.id !== state.imageSession?.id) ||
      ('imageSessionId' in update && update.imageSessionId !== state.imageSessionId)
    ) {
      update.detailModifierPreview = null;
    }

    if ('editDocumentV2' in update && update.editDocumentV2 !== undefined) {
      if (!('adjustmentRevision' in update)) {
        update.adjustmentRevision = allowRenderAuthority ? state.adjustmentRevision : state.adjustmentRevision + 1;
      }
      update.referenceMatchPreview = null;
      update.autoEditPreviewSession = null;
      if (allowRenderAuthority) {
        const history = update.history ?? state.history;
        const historyIndex = update.historyIndex ?? state.historyIndex;
        if (!Number.isInteger(historyIndex) || historyIndex < 0 || historyIndex >= history.length) {
          throw new Error('editor.hydration.invalid_history_index');
        }
        if (!areEditDocumentsEqual(history[historyIndex], update.editDocumentV2)) {
          throw new Error('editor.hydration.inconsistent_history');
        }
      }
      update.adjustmentSnapshot = publishAdjustmentSnapshot(state.adjustmentSnapshot, update.editDocumentV2);
      update.lastEditApplicationReceipt = null;
      Object.assign(
        update,
        resolveAiSelectionState(state, selectEditDocumentSourceArtifacts(update.editDocumentV2).aiPatches, {
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
        resolveAiSelectionState(state, selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches, {
          containerId:
            'activeAiPatchContainerId' in update
              ? (update.activeAiPatchContainerId ?? null)
              : state.activeAiPatchContainerId,
          subMaskId: 'activeAiSubMaskId' in update ? (update.activeAiSubMaskId ?? null) : state.activeAiSubMaskId,
        }),
      );
    }
    if ('imageSession' in update) {
      update.imageSessionId =
        update.imageSession?.generation ??
        (allowRenderAuthority && typeof update.imageSessionId === 'number'
          ? update.imageSessionId
          : state.imageSessionId + 1);
      update.navigatorPreviewArtifact = null;
      update.presentedPreviewArtifact = null;
      update.provisionalPreviewFrame = null;
      update.hasRenderedFirstFrame = false;
      update.previewQualityStatus = null;
      state.patchResidency.reset(update.imageSessionId);
    } else if (
      'selectedImage' in update &&
      update.selectedImage?.path !== state.selectedImage?.path &&
      state.imageSession?.path !== update.selectedImage?.path
    ) {
      update.imageSessionId =
        allowRenderAuthority && 'imageSessionId' in update ? update.imageSessionId : state.imageSessionId + 1;
      update.imageSession =
        update.selectedImage === null
          ? null
          : createEditorImageSession({
              generation: update.imageSessionId,
              path: update.selectedImage?.path ?? '',
              source: update.selectedImage?.isReady ? 'cache' : 'cold-load',
            });
      update.navigatorPreviewArtifact = null;
      update.presentedPreviewArtifact = null;
      update.hasRenderedFirstFrame = false;
      update.previewQualityStatus = null;
      state.patchResidency.reset(update.imageSessionId);
    }
    if ('finalPreviewUrl' in update && !('navigatorPreviewArtifact' in update)) {
      update.navigatorPreviewArtifact = null;
    }
    if ('finalPreviewUrl' in update && !('presentedPreviewArtifact' in update)) {
      update.presentedPreviewArtifact = null;
    }
    if ('selectedImage' in update && update.selectedImage?.path !== state.selectedImage?.path) {
      update.previewViewportTransform = { positionX: 0, positionY: 0, scale: 1 };
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
};

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedImage: null,
  editDocumentV2: initialEditDocumentV2,
  adjustmentRevision: 0,
  adjustmentSnapshot: initialAdjustmentSnapshot,
  lastEditApplicationReceipt: null,
  imageSessionId: 1,
  imageSession: null,
  viewportRevision: 1,
  previewViewportTransform: { positionX: 0, positionY: 0, scale: 1 },
  proofRevision: 1,
  lastBasicToneCommand: null,
  basicToneSliderInteraction: null,
  history: [initialEditDocumentV2],
  historyCheckpoints: [],
  historyIndex: 0,

  finalPreviewUrl: null,
  presentedPreviewArtifact: null,
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
  showClipping: false,
  isExportSoftProofEnabled: false,
  exportSoftProofRecipeId: null,
  exportSoftProofTransform: null,
  isWaveformVisible: false,
  activeWaveformChannel: DisplayMode.Luma,
  waveformHeight: PANEL_SCOPES_HEIGHT.default,
  panelScopesLayout: 'stacked',

  isSliderDragging: false,
  detailModifierPreview: null,
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
  brushSettings: { density: 100, feather: 50, flow: 100, size: 50, tool: ToolType.Brush },
  copiedEditDocumentV2: null,
  presetApplication: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  isMaskControlHovered: false,
  hasRenderedFirstFrame: false,
  wgpuFrameSerial: 0,
  wgpuFailureSerial: 0,
  patchResidency: new PatchResidencyTracker(1),

  publishPreviewViewportTransform: (transform) => {
    set((state) => {
      const previous = state.previewViewportTransform;
      const transformChanged =
        previous.scale !== transform.scale ||
        previous.positionX !== transform.positionX ||
        previous.positionY !== transform.positionY;
      const zoomChanged = state.zoom !== transform.scale;
      if (!transformChanged && !zoomChanged) return state;
      return {
        ...(transformChanged
          ? {
              previewViewportTransform: { ...transform },
              viewportRevision: state.viewportRevision + 1,
            }
          : {}),
        ...(zoomChanged ? { zoom: transform.scale } : {}),
      };
    });
  },
  setEditor: (updater) => applyEditorStateUpdate(set, updater, false),
  hydrateEditorRenderAuthority: (updater) => applyEditorStateUpdate(set, updater, true),

  publishWhiteBalancePickerPreview: (editDocumentV2) =>
    set((state) => ({
      ...historyNavigationPreviewInvalidation,
      ...publishEditDocumentState(state, editDocumentV2),
    })),

  applyEditorTeardownTransaction: (request) => {
    let result: EditorTeardownTransactionResult | null = null;
    set((state) => {
      if (!isEditorTeardownIdentityCurrent(state, request)) throw new Error('editor_teardown.stale_identity');
      const editDocumentV2 = structuredClone(initialEditDocumentV2);
      const adjustmentsChanged = !areEditDocumentsEqual(state.editDocumentV2, editDocumentV2);
      const adjustmentRevision = state.adjustmentRevision + (adjustmentsChanged ? 1 : 0);
      const imageSessionId = state.imageSessionId + 1;
      state.patchResidency.reset(imageSessionId);
      result = { adjustmentRevision, adjustmentsChanged, transactionId: request.transactionId };
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishEditDocumentState(state, editDocumentV2),
        activeAiPatchContainerId: null,
        activeAiSubMaskId: null,
        activeMaskContainerId: null,
        activeMaskId: null,
        adjustmentRevision,
        autoEditPreviewSession: null,
        basicToneSliderInteraction: null,
        compare: DEFAULT_EDITOR_COMPARE_STATE,
        gamutWarningOverlay: null,
        hasRenderedFirstFrame: false,
        histogram: null,
        history: [structuredClone(editDocumentV2)],
        historyCheckpoints: [],
        historyIndex: 0,
        imageSession: null,
        imageSessionId,
        isMaskControlHovered: false,
        isWbPickerActive: false,
        isSliderDragging: false,
        detailModifierPreview: null,
        lastBasicToneCommand: null,
        lastEditApplicationReceipt: null,
        lastReferenceMatchApplicationReceipt: null,
        lastWhiteBalancePickerReceipt: null,
        presetApplication: null,
        referenceMatchSpatialAnalysis: null,
        referenceMatchPreview: null,
        selectedImage: null,
        viewportRevision: state.viewportRevision + 1,
        previewViewportTransform: { positionX: 0, positionY: 0, scale: 1 },
        waveform: null,
      };
    });
    if (result === null) throw new Error('editor_teardown.not_applied');
    return result;
  },

  applyEditTransaction: (request) => {
    let result: EditTransactionResult | null = null;
    set((state) => {
      if (request.persistence === 'preview-only') {
        throw new Error('edit_transaction.preview_requires_proposal');
      }
      const nativeHistoryBaseline = request.nativeCommittedHistoryBaseline;
      const historyTargetIndex = request.history === 'navigation' ? request.historyTargetIndex : undefined;
      const compensationHistory =
        request.history === 'compensation' && request.compensationHistory !== undefined
          ? {
              checkpoints: structuredClone([...request.compensationHistory.checkpoints]),
              entries: structuredClone([...request.compensationHistory.entries]),
              historyIndex: request.compensationHistory.historyIndex,
            }
          : undefined;
      const currentHistory = state.history.map((entry, index) =>
        index === state.historyIndex && !areEditDocumentsEqual(entry, state.editDocumentV2)
          ? state.editDocumentV2
          : entry,
      );
      if (request.history === 'navigation') {
        if (
          historyTargetIndex === undefined ||
          !Number.isInteger(historyTargetIndex) ||
          historyTargetIndex < 0 ||
          historyTargetIndex >= state.history.length
        ) {
          throw new Error(`edit_transaction.invalid_history_target:${String(historyTargetIndex)}`);
        }
      } else if (request.historyTargetIndex !== undefined) {
        throw new Error('edit_transaction.history_target_requires_navigation');
      }
      if (request.history === 'compensation') {
        if (
          compensationHistory === undefined ||
          !Number.isInteger(compensationHistory.historyIndex) ||
          compensationHistory.historyIndex < 0 ||
          compensationHistory.historyIndex >= compensationHistory.entries.length ||
          compensationHistory.checkpoints.some(
            (checkpoint) =>
              !Number.isInteger(checkpoint.historyIndex) ||
              checkpoint.historyIndex < 0 ||
              checkpoint.historyIndex >= compensationHistory.entries.length,
          )
        ) {
          throw new Error('edit_transaction.invalid_compensation_history');
        }
      } else if (request.compensationHistory !== undefined) {
        throw new Error('edit_transaction.compensation_history_requires_compensation');
      }
      if (
        nativeHistoryBaseline !== undefined &&
        (request.persistence !== 'native-committed' || request.history !== 'single-entry')
      ) {
        throw new Error('edit_transaction.native_history_baseline_requires_native_single_entry');
      }
      const currentImageSessionId = state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;
      const nextResult = reduceEditTransaction(
        nativeHistoryBaseline ?? state.editDocumentV2,
        state.adjustmentRevision,
        request,
        currentImageSessionId,
      );
      const reconcilesHydratedNativeCommit =
        nativeHistoryBaseline !== undefined && !areEditDocumentsEqual(state.editDocumentV2, nativeHistoryBaseline);
      if (reconcilesHydratedNativeCommit && !areEditDocumentsEqual(state.editDocumentV2, nextResult.after)) {
        throw new Error('edit_transaction.native_history_baseline_mismatch');
      }
      if (
        historyTargetIndex !== undefined &&
        !areEditDocumentsEqual(state.history[historyTargetIndex], nextResult.after)
      ) {
        throw new Error('edit_transaction.history_target_mismatch');
      }
      if (
        compensationHistory !== undefined &&
        !areEditDocumentsEqual(compensationHistory.entries[compensationHistory.historyIndex], nextResult.after)
      ) {
        throw new Error('edit_transaction.compensation_edit_document_history_target_mismatch');
      }
      const activeInteractionReceipt = state.lastEditApplicationReceipt;
      const coalescedReceipt =
        request.history === 'coalesced-interaction' &&
        state.historyIndex === state.history.length - 1 &&
        state.history[state.historyIndex] === state.editDocumentV2 &&
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
      if (nextResult.noOp) {
        if (request.history === 'reset') {
          return {
            ...historyNavigationPreviewInvalidation,
            history: [structuredClone(nextResult.after)],
            historyCheckpoints: [],
            historyIndex: 0,
          };
        }
        return historyTargetIndex === undefined ? state : { historyIndex: historyTargetIndex };
      }
      const nextHistory =
        request.history === 'none' || request.history === 'navigation'
          ? { history: currentHistory, checkpoints: state.historyCheckpoints, historyIndex: state.historyIndex }
          : compensationHistory !== undefined
            ? {
                history: structuredClone(compensationHistory.entries),
                checkpoints: structuredClone(compensationHistory.checkpoints),
                historyIndex: compensationHistory.historyIndex,
              }
            : request.history === 'reset'
              ? { history: [nextResult.after], checkpoints: [], historyIndex: 0 }
              : coalescedReceipt
                ? {
                    history: currentHistory.map((entry, index) =>
                      index === state.historyIndex ? nextResult.after : entry,
                    ),
                    checkpoints: state.historyCheckpoints,
                    historyIndex: state.historyIndex,
                  }
                : pushEditHistoryEntryWithCheckpoints(
                    reconcilesHydratedNativeCommit
                      ? currentHistory.map((entry, index) =>
                          index === state.historyIndex && nativeHistoryBaseline !== undefined
                            ? nativeHistoryBaseline
                            : entry,
                        )
                      : currentHistory,
                    state.historyIndex,
                    nextResult.after,
                    state.historyCheckpoints,
                  );
      return {
        ...historyNavigationPreviewInvalidation,
        ...publishEditDocumentState(state, nextResult.after),
        adjustmentRevision: nextResult.nextAdjustmentRevision,
        basicToneSliderInteraction: null,
        isSliderDragging: false,
        lastEditApplicationReceipt: publishedResult.applicationReceipt,
        history: nextHistory.history,
        historyCheckpoints: nextHistory.checkpoints,
        historyIndex: historyTargetIndex ?? nextHistory.historyIndex,
        ...(historyTargetIndex === undefined
          ? {}
          : resolveAiSelectionState(state, selectEditDocumentSourceArtifacts(nextResult.after).aiPatches)),
      };
    });
    if (!result) throw new Error('edit_transaction.not_applied');
    return result;
  },

  beginBasicToneSliderInteraction: (identity, key, interactionId) => {
    try {
      const interaction = beginBasicToneSliderInteraction(get(), identity, key, interactionId);
      set({ basicToneSliderInteraction: interaction, isSliderDragging: true });
      return true;
    } catch {
      return false;
    }
  },

  updateBasicToneSliderInteraction: (interactionId, value) => {
    set((state) => {
      const interaction = state.basicToneSliderInteraction;
      if (interaction?.interactionId !== interactionId) return {};
      if (!isBasicToneSliderInteractionCurrent(state, interaction)) {
        return { basicToneSliderInteraction: null, isSliderDragging: false };
      }
      const result = reduceBasicToneSliderInteractionPreview(interaction, value);
      return {
        basicToneSliderInteraction: {
          ...interaction,
          latestValue: value,
          previewSnapshot: publishAdjustmentSnapshot(
            interaction.previewSnapshot ?? state.adjustmentSnapshot,
            result.after,
          ),
        },
      };
    });
  },

  commitBasicToneSliderInteraction: (interactionId) => {
    const interaction = get().basicToneSliderInteraction;
    if (interaction?.interactionId !== interactionId) return null;
    if (!isBasicToneSliderInteractionCurrent(get(), interaction)) {
      set({ basicToneSliderInteraction: null, isSliderDragging: false });
      return null;
    }
    set({ basicToneSliderInteraction: null });
    try {
      return get().applyEditTransaction(
        buildBasicToneSliderInteractionRequest(interaction, interaction.latestValue, 'commit'),
      );
    } finally {
      set({ isSliderDragging: false });
    }
  },

  cancelBasicToneSliderInteraction: (interactionId) => {
    set((state) =>
      state.basicToneSliderInteraction?.interactionId === interactionId
        ? { basicToneSliderInteraction: null, isSliderDragging: false }
        : {},
    );
  },

  applyAiEditCommand: (command) => {
    const state = get();
    const result = command({
      aiPatches: selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches,
      selection: {
        containerId: state.activeAiPatchContainerId,
        subMaskId: state.activeAiSubMaskId,
      },
    });
    if (!result) return null;

    const transaction = buildAiSourceArtifactEditTransaction(state, result.aiPatches, crypto.randomUUID());
    if (transaction === null) return null;
    get().applyEditTransaction(transaction);

    const selection = resolveAiEditSelection(result.aiPatches, result.selection);
    set((current) => ({
      activeAiPatchContainerId: selection.containerId,
      activeAiSubMaskId: selection.subMaskId,
      brushSettings: result.selectBrushTool
        ? {
            ...(current.brushSettings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
            tool: ToolType.Brush,
          }
        : current.brushSettings,
    }));
    return selection;
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

  applyBasicToneCommand: (command, identity) => {
    const state = get();
    assertApprovedBasicToneCommand(command, state);
    const result = state.applyEditTransaction(buildBasicToneCommandEditTransaction(state, identity, command));
    set((current) =>
      current.adjustmentRevision === result.nextAdjustmentRevision ? { lastBasicToneCommand: command } : {},
    );
    return result;
  },

  pushHistory: (expected) => {
    set((state) => {
      const currentImageSessionId = state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;
      if (
        state.adjustmentRevision !== expected.adjustmentRevision ||
        currentImageSessionId !== expected.imageSessionId
      ) {
        return {};
      }
      const nextHistory = pushEditHistoryEntryWithCheckpoints(
        state.history,
        state.historyIndex,
        state.editDocumentV2,
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
    const state = get();
    const historyIndex = Math.max(0, state.historyIndex - 1);
    if (historyIndex === state.historyIndex) return;
    state.applyEditTransaction(
      buildHistoryNavigationEditTransaction(
        state,
        historyIndex,
        `history:${state.imageSession?.id ?? String(state.imageSessionId)}:${String(state.adjustmentRevision)}:${String(historyIndex)}`,
      ),
    );
  },

  redo: () => {
    const state = get();
    const historyIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
    if (historyIndex === state.historyIndex) return;
    state.applyEditTransaction(
      buildHistoryNavigationEditTransaction(
        state,
        historyIndex,
        `history:${state.imageSession?.id ?? String(state.imageSessionId)}:${String(state.adjustmentRevision)}:${String(historyIndex)}`,
      ),
    );
  },

  resetHistory: (initialState) => {
    set((state) => ({
      history: [initialState],
      historyCheckpoints: [],
      historyIndex: 0,
      ...publishEditDocumentState(state, initialState),
      ...resolveAiSelectionState(state, selectEditDocumentSourceArtifacts(initialState).aiPatches),
    }));
  },

  goToHistoryIndex: (index) => {
    const state = get();
    if (!Number.isInteger(index) || index < 0 || index >= state.history.length || index === state.historyIndex) return;
    state.applyEditTransaction(
      buildHistoryNavigationEditTransaction(
        state,
        index,
        `history:${state.imageSession?.id ?? String(state.imageSessionId)}:${String(state.adjustmentRevision)}:${String(index)}`,
      ),
    );
  },
}));

const directEditorStoreSetState = useEditorStore.setState;
useEditorStore.setState = (updater, replace) => {
  if (replace === true) throw new Error('editor.setState.replace_forbidden');
  const rawUpdate = typeof updater === 'function' ? updater(useEditorStore.getState()) : updater;
  const forbiddenKey =
    removedEditorRenderAuthorityKeys.find((key) => key in rawUpdate) ??
    editorRenderAuthorityKeys.find((key) => key in rawUpdate);
  if (forbiddenKey !== undefined) {
    throw new Error(`editor.setState.render_authority_forbidden:${forbiddenKey}`);
  }
  directEditorStoreSetState(rawUpdate);
};

export const isEditorImageSessionCurrent = (sessionId: string): boolean =>
  useEditorStore.getState().imageSession?.id === sessionId;
