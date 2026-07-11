import cx from 'clsx';
import {
  Brush,
  Camera,
  ChevronDown,
  Circle,
  CircleGauge,
  FolderOpen,
  GripHorizontal,
  Layers3,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TriangleRight,
} from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Crop, PercentCrop } from 'react-image-crop';
import AdjustmentSlider from '../../components/adjustments/AdjustmentSlider';
import ColorPanel from '../../components/adjustments/Color';
import DetailsPanel from '../../components/adjustments/Details';
import EffectsPanel from '../../components/adjustments/Effects';
import FocusStackModal from '../../components/modals/computational-merge/FocusStackModal';
import HdrModal from '../../components/modals/computational-merge/HdrModal';
import PanoramaModal from '../../components/modals/computational-merge/PanoramaModal';
import SuperResolutionModal from '../../components/modals/computational-merge/SuperResolutionModal';
import CullingModal from '../../components/modals/editing/CullingModal';
import { LensCorrectionSession } from '../../components/modals/editing/LensCorrectionModal';
import CommandPaletteModal from '../../components/modals/navigation/CommandPaletteModal';
import { NegativeConversionModal } from '../../components/modals/negative-lab/NegativeConversionModal';
import BottomBar from '../../components/panel/BottomBar';
import EditorToolbar from '../../components/panel/editor/EditorToolbar';
import ImageCanvas from '../../components/panel/editor/ImageCanvas';
import ViewerFooter from '../../components/panel/editor/ViewerFooter';
import AgentChatShell from '../../components/panel/right/ai/AgentChatShell';
import { AgentPanel } from '../../components/panel/right/ai/AgentPanel';
import { TetherPanel } from '../../components/panel/right/capture/TetherPanel';
import ControlsPanel from '../../components/panel/right/color/ControlsPanel';
import CropPanel from '../../components/panel/right/color/CropPanel';
import { EditorRightPanelHost } from '../../components/panel/right/EditorRightPanelHost';
import ExportPanel from '../../components/panel/right/export/ExportPanel';
import { MaskOverlayReviewControls } from '../../components/panel/right/layers/MaskOverlayReviewControls';
import { Mask, type SubMask, SubMaskMode, ToolType } from '../../components/panel/right/layers/Masks';
import { ObjectPromptControls } from '../../components/panel/right/layers/ObjectPromptControls';
import RightPanelSwitcher from '../../components/panel/right/RightPanelSwitcher';
import {
  type AppSettings,
  type BrushSettings,
  type CullingSuggestions,
  type ImageFile,
  Panel,
  RawStatus,
  type SelectedImage,
  SortDirection,
  Theme,
  ThumbnailAspectRatio,
} from '../../components/ui/AppProperties';
import { ExportColorProfile, ExportRenderingIntent, Status } from '../../components/ui/ExportImportProperties';
import { editorChromeStatusChipClassName, editorChromeTokens } from '../../components/ui/editorChromeTokens';
import { inspectorTokens } from '../../components/ui/inspectorTokens';
import Button from '../../components/ui/primitives/Button';
import Dropdown from '../../components/ui/primitives/Dropdown';
import Input from '../../components/ui/primitives/Input';
import InspectorSegmentedControl from '../../components/ui/primitives/InspectorSegmentedControl';
import Switch from '../../components/ui/primitives/Switch';
import { ContextMenuProvider } from '../../context/ContextMenuContext';
import {
  DEFAULT_HDR_MERGE_UI_SETTINGS,
  type HdrMergeUiSettings,
} from '../../schemas/computational-merge/hdrMergeUiSchemas';
import {
  DEFAULT_PANORAMA_UI_SETTINGS,
  type PanoramaRenderedReview,
  type PanoramaRuntimePlan,
  type PanoramaUiSettings,
} from '../../schemas/computational-merge/panoramaUiSchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../../schemas/computational-merge/superResolutionOutputReviewSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../../schemas/computational-merge/superResolutionUiSchemas';
import type { FocusStackOutputReviewWorkflow } from '../../schemas/focus-stack/focusStackOutputReviewSchemas';
import {
  DEFAULT_FOCUS_STACK_UI_SETTINGS,
  type FocusStackUiSettings,
} from '../../schemas/focus-stack/focusStackUiSchemas';
import type { MaskOverlaySettings } from '../../schemas/masks/maskOverlaySchemas';
import type { GamutWarningOverlayPayload } from '../../schemas/tauriEventSchemas';
import type {
  TetherCaptureResponse,
  TetherDiscoveryResponse,
  TetherSessionResponse,
} from '../../schemas/tetheringSchemas';
import type { ExportSoftProofTransformState } from '../../store/useEditorStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { DEFAULT_COLLAPSIBLE_SECTIONS_STATE, useUIStore } from '../../store/useUIStore';
import { thumbnailCache } from '../../thumbnails/thumbnailCacheInstance';
import {
  ActiveChannel,
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../utils/adjustments';
import { agentChatTranscriptFixture } from '../../utils/agent/session/agentChatTranscriptFixture';
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computational-merge/computationalMergeAppServerRoutePairs';
import { DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF } from '../../utils/detail/detailOutputComparisonProof';
import { buildFocusStackOutputReviewWorkflow } from '../../utils/focusStackOutputReview';
import { buildHdrBracketPreflight, type HdrBracketPreflightSourceMetadata } from '../../utils/hdrBracketPreflight';
import {
  deriveLayerMaskExportParityReceiptState,
  type LayerMaskExportParityReceipt,
} from '../../utils/layers/layerMaskExportParityReceipt';
import { applyLayerStackCommandBridgeOperation } from '../../utils/layers/layerStackCommandBridge';
import { handleNegativeConversionEditorHandoff } from '../../utils/negative-lab/negativeLabEditorHandoff';
import { buildSuperResolutionOutputReviewWorkflow } from '../../utils/superResolutionOutputReview';
import type { SuperResolutionSourcePreflightMetadata } from '../../utils/superResolutionSourcePreflight';
import { PANEL_SCOPES_HEIGHT } from '../../utils/waveformSizing';
import { VISUAL_SMOKE_PROOF_TEST_IDS, VISUAL_SMOKE_SCENARIO_IDS, type VisualSmokeMode } from './visualSmokeScenarios';

interface VisualSmokeAppProps {
  mode: string;
}

interface SrPrivateRawVisualProof {
  detailGainRatio: string;
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  exportReviewHash: string;
  fixtureId: string;
  outputArtifactScore: string;
  outputHeight: string;
  outputPixelCount: string;
  outputScale: string;
  outputWidth: string;
  previewArtifact: string;
  previewDataUrl: string;
  previewHash: string;
  privateRunReportPath: string;
  reconstructionPath: string;
  reconstructionHash: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  resultReviewHash: string;
  sourceCoverageRatio: string;
  sourceCount: string;
  sourceHashes: string;
  sourceHeights: string;
  sourcePaths: string;
  sourceWidths: string;
}

interface FocusPrivateRawVisualProof {
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  fixtureId: string;
  focusCoverageRatio: string;
  haloRiskCellRatio: string;
  lowConfidenceCellRatio: string;
  outputPixelCount: string;
  previewArtifact: string;
  previewDataUrl: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sharpnessGainRatio: string;
  sourceCount: string;
  sourceCoverageRatio: string;
  sourceWinnerDistribution: string;
  stackHash: string;
  stackPath: string;
  transitionArtifactScore: string;
  winnerSourceCount: string;
}

interface HdrPrivateRawVisualProof {
  afterArtifact: string;
  afterDataUrl: string;
  beforeArtifact: string;
  beforeDataUrl: string;
  exportArtifact: string;
  fixtureId: string;
  mergeArtifact: string;
  previewArtifact: string;
  previewDataUrl: string;
  sourceCount: string;
}

interface PanoramaPrivateRawVisualProof {
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  fixtureId: string;
  panoramaPath: string;
  previewArtifact: string;
  previewDataUrl: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sourceCount: string;
}

interface LayerMaskPrivateRawVisualProof {
  brushCommandType?: string;
  changedPixelRatio: string;
  exportArtifact: string;
  exportParityReceipt: LayerMaskExportParityReceipt;
  finalExportHash: string;
  fixtureId: string;
  metricCount: string;
  refineCommandType?: string;
  refinedMaskContentHash: string;
  refinedPreviewArtifact: string;
  refinedPreviewDataUrl: string;
  refinedPreviewHash: string;
  sourceGraphRevision: string;
  unmaskedPreviewArtifact: string;
  unmaskedPreviewDataUrl: string;
  unmaskedPreviewHash: string;
  unrefinedPreviewArtifact: string;
  unrefinedPreviewDataUrl: string;
  unrefinedPreviewHash: string;
}

interface NegativeLabPublicExportVisualProof {
  appliedProfileClaimPolicy: string;
  appliedProfileDisplayName: string;
  appliedProfilePresetId: string;
  appliedProfileProvenanceHash: string;
  baseFogSample: string;
  baseFogStrength: string;
  changedPixelRatio: string;
  densityWeights: string;
  exportPlanId: string;
  fixtureId: string;
  outputDataUrl: string;
  outputFormat: string;
  outputPath: string;
  runtimeStatus: string;
  sourceDataUrl: string;
  sourcePath: string;
}

interface NegativeLabRealRawPrivateVisualProof {
  changedPixelRatio: string;
  fixtureId: string;
  inputToOutputMeanAbsDelta: string;
  outputDataUrl: string;
  outputFormat: string;
  outputPath: string;
  proofBoundary: string;
  proofStatus: string;
  sourceIsRaw: string;
  sourcePath: string;
}

declare global {
  interface Window {
    __RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__?: FocusPrivateRawVisualProof;
    __RAWENGINE_HDR_PRIVATE_RAW_PROOF__?: HdrPrivateRawVisualProof;
    __RAWENGINE_LAYER_MASK_PRIVATE_RAW_PROOF__?: LayerMaskPrivateRawVisualProof;
    __RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF__?: NegativeLabPublicExportVisualProof;
    __RAWENGINE_NEGATIVE_LAB_REAL_RAW_PRIVATE_PROOF__?: NegativeLabRealRawPrivateVisualProof;
    __RAWENGINE_PANORAMA_PRIVATE_RAW_PROOF__?: PanoramaPrivateRawVisualProof;
    __RAWENGINE_SR_PRIVATE_RAW_PROOF__?: SrPrivateRawVisualProof;
  }
}

const adjustmentsPanelRetuneRawImage: SelectedImage = {
  exif: null,
  height: 4024,
  isRaw: true,
  isReady: true,
  originalUrl: null,
  path: '/visual-smoke/adjustments-panel-retune.ARW',
  rawDevelopmentReport: {
    cameraProfile: {
      algorithmId: 'visual-smoke-camera-profile-v1',
      candidateCount: 1,
      colorCheckerGate: {
        status: 'gated_pass',
      },
      illuminantEstimateConfidence: 'high',
      illuminantEstimateMethod: 'as_shot_white_xy',
      status: 'single_illuminant',
      warningCodes: [],
    },
    demosaicAlgorithmId: 'visual-smoke-demosaic-v1',
    demosaicPath: 'standard',
    processingProfile: 'balanced',
    runtime: {
      cacheHit: true,
      decodeElapsedMs: 12,
      outputDimensions: [6048, 4024],
      previewElapsedMs: 6,
    },
  },
  thumbnailUrl: '',
  width: 6048,
};

function useAdjustmentPanelSmokeState() {
  const [isReady] = useState(() => {
    const adjustments: Adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      brightness: 0.42,
      clarity: 18,
      contrast: 12,
      glowAmount: 16,
      levels: {
        ...INITIAL_ADJUSTMENTS.levels,
        inputBlack: 0.06,
        inputWhite: 0.92,
      },
      sectionVisibility: {
        ...INITIAL_ADJUSTMENTS.sectionVisibility,
        effects: false,
      },
    };
    useEditorStore.setState({
      adjustments,
      copiedSectionAdjustments: {
        section: 'basic',
        values: {
          brightness: adjustments.brightness,
          contrast: adjustments.contrast,
          exposure: adjustments.exposure,
        },
      },
      histogram: null,
      history: [adjustments],
      historyIndex: 0,
      isWaveformVisible: false,
      previewScopeStatus: null,
      selectedImage: adjustmentsPanelRetuneRawImage,
      waveform: null,
    });
    useUIStore.setState({
      collapsibleSectionsState: {
        ...DEFAULT_COLLAPSIBLE_SECTIONS_STATE,
        basic: true,
        curves: false,
        details: true,
        effects: false,
      },
    });
    return true;
  });

  return isReady;
}

function AdjustmentsPanelRetuneVisualSmoke() {
  const { t } = useTranslation();
  const isReady = useAdjustmentPanelSmokeState();

  return (
    <main
      className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.AdjustmentsPanelRetune}
      data-visual-smoke-ready={String(isReady)}
    >
      <section className="h-[880px] w-[360px] overflow-hidden border border-white/10 bg-[#15181c]">
        <div
          className="border-b border-white/10 px-3 py-2 text-sm font-semibold"
          data-testid="adjustments-panel-retune-heading"
        >
          {t('editor.adjustments.scopedSections.basic')}
        </div>
        <div className="h-[calc(100%-37px)]" data-visual-smoke-section="adjustments-panel-retune">
          <ContextMenuProvider>
            <ControlsPanel />
          </ContextMenuProvider>
        </div>
      </section>
    </main>
  );
}

function ProfessionalAdjustmentsCompactVisualSmoke() {
  const { t } = useTranslation();
  const isReady = useAdjustmentPanelSmokeState();

  return (
    <main
      className="grid min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAdjustmentsCompact}
      data-visual-smoke-ready={String(isReady)}
    >
      <section className="h-screen w-screen overflow-hidden bg-[#15181c]">
        <div
          className="border-b border-white/10 px-3 py-2 text-sm font-semibold"
          data-testid="adjustments-panel-retune-heading"
        >
          {t('editor.adjustments.scopedSections.basic')}
        </div>
        <div className="h-[calc(100%-37px)]" data-visual-smoke-section="adjustments-panel-retune">
          <ContextMenuProvider>
            <ControlsPanel />
          </ContextMenuProvider>
        </div>
      </section>
    </main>
  );
}

function ProfessionalEditorTokensVisualSmoke() {
  const [sliderValue, setSliderValue] = useState(18);
  const [isSwitchChecked, setIsSwitchChecked] = useState(true);
  const [dropdownValue, setDropdownValue] = useState<'balanced' | 'proof' | 'mask'>('balanced');
  const [segmentedValue, setSegmentedValue] = useState<'raw' | 'proof' | 'mask'>('raw');
  const token = editorChromeTokens;
  const focusStateClass = 'ring-2 ring-editor-focus-ring ring-offset-1 ring-offset-editor-matte outline-none';

  return (
    <main
      className="min-h-screen bg-editor-matte p-5 font-sans text-text-primary max-[700px]:p-3"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorTokens}
      data-visual-smoke-ready="true"
    >
      <div className="mx-auto grid h-[calc(100vh-40px)] max-w-6xl grid-cols-[minmax(0,1fr)_360px] overflow-hidden rounded-lg border border-editor-border bg-editor-panel shadow-[0_14px_34px_var(--editor-overlay-shadow)] max-[700px]:h-auto max-[700px]:min-h-[calc(100vh-24px)] max-[700px]:grid-cols-1">
        <section
          className="relative flex min-h-0 items-center justify-center overflow-hidden border-r border-editor-border bg-editor-panel-well p-6 max-[700px]:min-h-[280px] max-[700px]:flex-col max-[700px]:items-stretch max-[700px]:border-r-0 max-[700px]:border-b"
          data-visual-smoke-section="professional-editor-preview"
        >
          <div className="absolute left-4 top-4 flex gap-1.5 max-[700px]:static max-[700px]:mb-2 max-[700px]:flex-wrap">
            {(['success', 'warning', 'danger', 'info'] as const).map((status) => (
              <span className={editorChromeStatusChipClassName(status)} key={status}>
                {status}
              </span>
            ))}
          </div>
          <div className="aspect-[4/3] w-full max-w-3xl overflow-hidden rounded-md border border-editor-overlay-stroke bg-[linear-gradient(135deg,#182329,#405559_38%,#9c8d68_63%,#efe1bf)] shadow-[0_24px_52px_var(--editor-overlay-shadow)]">
            <div className="h-full w-full bg-[radial-gradient(circle_at_34%_30%,rgba(255,255,238,0.54),transparent_18%),linear-gradient(165deg,transparent_48%,rgba(12,18,23,0.68)_49%)]" />
          </div>
        </section>

        <aside
          className="grid min-h-0 grid-cols-[42px_minmax(0,1fr)] bg-editor-panel max-[700px]:grid-cols-1"
          data-visual-smoke-section="professional-editor-controls"
        >
          <nav
            aria-label={copy.professionalEditorModeRail}
            className="flex flex-col items-center gap-1 border-r border-editor-border bg-editor-matte p-1.5 max-[700px]:h-[42px] max-[700px]:flex-row max-[700px]:border-r-0 max-[700px]:border-b"
          >
            <button
              aria-label={copy.professionalEditorAdjust}
              aria-pressed="true"
              className={`${token.button.base} ${token.button.iconCompact} ${token.button.selectedQuiet} ${token.focusRing}`}
              type="button"
            >
              <SlidersHorizontal size={15} />
            </button>
            <button
              aria-label={copy.professionalEditorAi}
              className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${focusStateClass}`}
              type="button"
            >
              <Sparkles size={15} />
            </button>
            <button
              aria-label={copy.professionalEditorReset}
              className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${token.focusRing}`}
              disabled={true}
              type="button"
            >
              <RotateCcw size={15} />
            </button>
          </nav>

          <div className="min-h-0 overflow-y-auto">
            <header className="flex min-h-9 items-center justify-between border-b border-editor-border px-3">
              <h1 className={token.typography.panelTitle}>{copy.professionalEditorTokens}</h1>
              <span className={editorChromeStatusChipClassName('neutral')}>{copy.professionalEditorMatte}</span>
            </header>

            <div className="space-y-3 p-3">
              <section className="space-y-2" data-visual-smoke-section="professional-editor-state-matrix">
                <div className="flex items-center justify-between">
                  <h2 className={token.typography.inspectorLabel}>{copy.professionalEditorControlStates}</h2>
                  <span className={editorChromeStatusChipClassName('info')}>{copy.professionalEditorFocus}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] max-[700px]:grid-cols-3">
                  <Button onClick={() => {}} variant="editorPrimary">
                    {copy.professionalEditorApply}
                  </Button>
                  <Button onClick={() => {}} variant="editorQuiet">
                    {copy.professionalEditorHover}
                  </Button>
                  <Button onClick={() => {}} variant="editorSelected" aria-pressed="true">
                    {copy.professionalEditorActive}
                  </Button>
                  <Button onClick={() => {}} variant="editorDestructive">
                    {copy.professionalEditorReset}
                  </Button>
                  <Button onClick={() => {}} variant="editorQuiet" disabled={true}>
                    {copy.professionalEditorDisabled}
                  </Button>
                  <Button onClick={() => {}} variant="editorQuiet" aria-busy="true">
                    {copy.professionalEditorLoading}
                  </Button>
                </div>
              </section>

              <section className="space-y-2 rounded-md border border-editor-border bg-editor-panel-well p-2">
                <div className="flex items-center justify-between">
                  <h2 className={token.typography.inspectorLabel}>{copy.professionalEditorCompactRow}</h2>
                  <span className={editorChromeStatusChipClassName('success')}>{copy.professionalEditorReady}</span>
                </div>
                <Input
                  autoFocus={true}
                  chrome="editor"
                  density="compact"
                  aria-label="Focused exposure value"
                  defaultValue="+0.18 EV"
                />
                <Dropdown
                  chrome="editor"
                  options={[
                    { label: 'Balanced RAW', value: 'balanced' },
                    { label: 'Soft proof', value: 'proof' },
                    { label: 'Mask edit', value: 'mask' },
                  ]}
                  value={dropdownValue}
                  onChange={setDropdownValue}
                />
                <InspectorSegmentedControl
                  ariaLabel="Inspector proof mode"
                  onChange={setSegmentedValue}
                  options={[
                    { label: 'RAW', value: 'raw' },
                    { label: 'Proof', value: 'proof' },
                    { label: 'Mask', value: 'mask' },
                  ]}
                  value={segmentedValue}
                />
                <Switch
                  chrome="editor"
                  checked={isSwitchChecked}
                  label="Highlight warnings"
                  onChange={setIsSwitchChecked}
                />
                <AdjustmentSlider
                  density="compact"
                  label="Clarity"
                  max={100}
                  min={-100}
                  onValueChange={setSliderValue}
                  step={1}
                  value={sliderValue}
                />
                <AdjustmentSlider
                  density="compact"
                  disabled={true}
                  label="Disabled row"
                  max={100}
                  min={0}
                  onValueChange={() => {}}
                  step={1}
                  value={34}
                  fillOrigin="min"
                />
                <p className={inspectorTokens.control.validation.error} role="alert">
                  {copy.professionalEditorValidationError}
                </p>
                <div
                  className={inspectorTokens.actionRow.root}
                  aria-label={copy.professionalEditorActions}
                  role="group"
                >
                  <button
                    aria-label={copy.professionalEditorResetInspector}
                    className={inspectorTokens.actionRow.iconButton}
                    type="button"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button className={inspectorTokens.actionRow.button} type="button">
                    {copy.professionalEditorCopySettings}
                  </button>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-2 text-[11px] max-[700px]:grid-cols-3">
                {(['success', 'warning', 'danger', 'info'] as const).map((status) => (
                  <div className="rounded border border-editor-border bg-editor-panel-raised p-2" key={status}>
                    <span className={editorChromeStatusChipClassName(status)}>{status}</span>
                    <p className="mt-1 font-mono tabular-nums text-text-secondary">{copy.professionalEditorRailSize}</p>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

const editorParityToolTabs = [
  { Icon: SlidersHorizontal, id: 'adjust', label: 'Adjust' },
  { Icon: CircleGauge, id: 'color', label: 'Color' },
  { Icon: Circle, id: 'crop', label: 'Crop' },
  { Icon: Layers3, id: 'masks', label: 'Masks' },
  { Icon: Sparkles, id: 'agent', label: 'Agent' },
  { Icon: FolderOpen, id: 'export', label: 'Export' },
] as const;

function EditorParityContractVisualSmoke() {
  const token = editorChromeTokens;

  return (
    <main
      className="editor-visual-fixture h-screen min-h-screen overflow-hidden bg-editor-matte p-2 font-sans text-text-primary max-[700px]:h-auto max-[700px]:min-h-screen"
      data-editor-parity-motion="standard"
      data-testid="editor-parity-contract"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.EditorParityContract}
      data-visual-smoke-ready="true"
    >
      <div className="grid h-full min-h-0 w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)_84px] overflow-hidden border border-editor-divider bg-editor-panel shadow-[0_14px_34px_var(--editor-overlay-shadow)] max-[700px]:h-auto max-[700px]:min-h-[calc(100vh-16px)] max-[700px]:grid-rows-[44px_auto_76px]">
        <header className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden border-b border-editor-divider bg-editor-panel px-2 max-[700px]:px-1">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className={`${token.typography.panelTitle} truncate max-[700px]:text-[12px]`}>
              {copy.editorParityContractTitle}
            </span>
            <span className={`${token.typography.metadata} max-[700px]:hidden`}>{copy.editorParityDesktopMatrix}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span
              className={`${token.typography.status} rounded-sm bg-editor-selected-quiet px-1.5 py-0.5 max-[700px]:hidden`}
            >
              {copy.editorParityReadyImage}
            </span>
            <button
              aria-label={copy.editorParityKeyboardFocus}
              className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${token.focusRing} shrink-0 max-[700px]:min-h-11 max-[700px]:min-w-11`}
              data-editor-parity-coarse-pointer="true"
              data-editor-parity-state="keyboard-focus"
              type="button"
            >
              <Camera size={14} />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 w-full min-w-0 max-w-full grid-cols-[132px_minmax(0,1fr)_272px] overflow-hidden max-[700px]:grid-cols-1 max-[700px]:overflow-visible">
          <aside
            className="min-h-0 border-r border-editor-divider bg-editor-panel max-[700px]:border-r-0 max-[700px]:border-b"
            data-editor-parity-panel="left-expanded"
            data-visual-smoke-section="editor-parity-left-panel"
          >
            <div className="flex min-h-9 items-center justify-between border-b border-editor-divider px-2">
              <span className={token.typography.sectionTitle}>{copy.editorParityWorkflow}</span>
              <span className="h-1.5 w-1.5 bg-editor-info" aria-hidden="true" />
            </div>
            <div className="space-y-1 p-1.5">
              {[copy.editorParityCatalog, copy.editorParityDevelop, copy.editorParityReview].map((label) => (
                <button
                  className={`${token.button.base} ${token.button.quiet} h-7 w-full justify-start px-2 text-[11px] ${
                    label === 'Develop' ? token.state.selected : ''
                  }`}
                  key={label}
                  type="button"
                >
                  {label}
                </button>
              ))}
              <button
                aria-label={copy.editorParityCollapsedLeftPanel}
                className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${token.focusRing}`}
                data-editor-parity-panel="left-collapsed"
                type="button"
              >
                <ChevronDown className="-rotate-90" size={14} />
              </button>
            </div>
          </aside>

          <section
            className="grid min-h-0 grid-rows-[minmax(0,1fr)_38px] bg-editor-viewer-matte max-[700px]:min-h-[290px]"
            data-visual-smoke-section="editor-parity-viewer"
          >
            <div className="relative m-2 min-h-0 overflow-hidden border border-editor-overlay-stroke bg-editor-viewer-matte shadow-[0_24px_52px_var(--editor-overlay-shadow)]">
              <div className="absolute inset-0 bg-[linear-gradient(145deg,#1b2b31,#4d6868_42%,#b39b70_67%,#e7d4a7)]" />
              <div className="absolute inset-x-[18%] inset-y-[10%] border border-editor-overlay-stroke bg-black/20" />
              <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                {[
                  ['no-image', copy.editorParityNoImage],
                  ['loading-image', copy.editorParityLoadingImage],
                  ['ready-image', copy.editorParityReadyImage],
                  ['render-failure', copy.editorParityRenderFailed],
                ].map(([state, label]) => (
                  <span
                    className={`rounded-sm px-1.5 py-0.5 ${token.typography.status} ${
                      state === 'render-failure'
                        ? 'bg-editor-danger-surface text-editor-danger'
                        : 'bg-editor-overlay-surface'
                    }`}
                    data-editor-parity-viewer-state={state}
                    key={state}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="absolute bottom-2 left-2 flex gap-1">
                <span className="rounded-sm bg-editor-overlay-surface px-1.5 py-0.5 text-[10px] font-medium">
                  {copy.editorParityFit}
                </span>
                <span className="rounded-sm bg-editor-overlay-surface px-1.5 py-0.5 text-[10px] font-medium">
                  {copy.editorParityFullSize}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-editor-divider bg-editor-panel px-2">
              <span className={token.typography.metadata}>{copy.editorParityViewerZoom}</span>
              <span className={`${token.typography.status} text-editor-warning`}>{copy.editorParityProofWarning}</span>
            </div>
          </section>

          <aside
            className="grid min-h-0 grid-cols-[34px_minmax(0,1fr)] border-l border-editor-divider bg-editor-panel max-[700px]:grid-cols-[42px_minmax(0,1fr)] max-[700px]:border-l-0 max-[700px]:border-t"
            data-editor-parity-panel="right-expanded"
            data-visual-smoke-section="editor-parity-inspector"
          >
            <nav
              aria-label={copy.editorParityTools}
              className="flex flex-col gap-1 border-r border-editor-divider bg-editor-matte p-1 max-[700px]:flex-row max-[700px]:overflow-x-auto"
            >
              {editorParityToolTabs.map(({ Icon, id, label }) => (
                <button
                  aria-label={label}
                  aria-pressed={id === 'adjust'}
                  className={`${token.button.base} ${token.button.iconCompact} ${
                    id === 'adjust' ? token.toolTab.active : token.toolTab.inactive
                  } ${token.focusRing}`}
                  data-editor-parity-tool={id}
                  key={id}
                  type="button"
                >
                  <Icon size={14} />
                </button>
              ))}
            </nav>
            <div className="min-h-0 overflow-hidden">
              <header className="flex min-h-9 items-center justify-between border-b border-editor-divider px-2">
                <span className={token.typography.panelTitle}>{copy.editorParityAdjust}</span>
                <button
                  aria-label={copy.editorParityCollapsedRightPanel}
                  className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${token.focusRing}`}
                  data-editor-parity-panel="right-collapsed"
                  type="button"
                >
                  <ChevronDown className="rotate-90" size={14} />
                </button>
              </header>
              <div className="space-y-1.5 p-2">
                <section className="border-b border-editor-divider pb-1.5" data-editor-parity-section="default">
                  <button className={`${inspectorTokens.disclosure.header} ${token.focusRing}`} type="button">
                    <span className={token.typography.sectionTitle}>{copy.editorParityLight}</span>
                    <span className={token.typography.metadata}>{copy.editorParityDefault}</span>
                  </button>
                  <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-2 px-2 pt-1">
                    <span className={token.typography.controlLabel}>{copy.editorParityExposure}</span>
                    <span className={`${inspectorTokens.numeric.value} text-right text-[11px]`}>0.00</span>
                  </div>
                </section>
                <section
                  className={`border-b border-editor-divider pb-1.5 ${inspectorTokens.state.edited}`}
                  data-editor-parity-section="edited"
                >
                  <button className={`${inspectorTokens.disclosure.header} ${token.focusRing}`} type="button">
                    <span className={token.typography.sectionTitle}>{copy.editorParityColor}</span>
                    <span className="text-[10px] font-medium text-editor-info">{copy.editorParityEdited}</span>
                  </button>
                  <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-2 px-2 pt-1">
                    <span className={token.typography.controlLabel}>{copy.editorParitySaturation}</span>
                    <span className={`${inspectorTokens.numeric.value} text-right text-[11px]`}>+12</span>
                  </div>
                </section>
                <button
                  className={`${token.button.base} h-8 w-full ${token.button.quiet} ${token.state.disabled}`}
                  data-editor-parity-state="disabled"
                  disabled={true}
                  type="button"
                >
                  {copy.editorParityDisabledControl}
                </button>
                <div className="grid grid-cols-2 gap-1" data-visual-smoke-section="editor-parity-theme-audit">
                  <div
                    className="editor-visual-fixture border border-editor-divider bg-editor-panel-well p-1.5"
                    data-editor-theme="dark"
                  >
                    <span className={token.typography.status}>{copy.editorParityDark}</span>
                  </div>
                  <div
                    className="editor-visual-fixture border border-editor-divider bg-editor-panel-well p-1.5"
                    data-editor-theme="light"
                  >
                    <span className={token.typography.status}>{copy.editorParityLight}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer
          className="border-t border-editor-divider bg-editor-panel"
          data-editor-parity-filmstrip="expanded"
          data-visual-smoke-section="editor-parity-filmstrip"
        >
          <div className="flex min-h-7 items-center justify-between border-b border-editor-divider px-2">
            <span className={token.typography.sectionTitle}>{copy.editorParityFilmstrip}</span>
            <button
              aria-label={copy.editorParityCollapsedFilmstrip}
              className={`${token.button.base} ${token.button.iconCompact} ${token.button.quiet} ${token.focusRing}`}
              data-editor-parity-filmstrip="collapsed"
              type="button"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="flex h-[55px] items-center gap-1 overflow-hidden px-2">
            {['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07'].map((label, index) => (
              <div
                className={`h-11 w-14 shrink-0 border ${
                  index === 2
                    ? 'border-editor-primary-active bg-editor-selected-quiet'
                    : 'border-editor-divider bg-editor-panel-well'
                }`}
                data-editor-parity-thumbnail={index === 2 ? 'selected' : 'idle'}
                key={label}
              >
                <div className="h-7 bg-[linear-gradient(145deg,#1f3037,#809477_55%,#b2855f)]" />
                <span className="block px-1 pt-0.5 text-[9px] font-medium text-text-secondary">{label}</span>
              </div>
            ))}
            <button
              aria-label={copy.editorParityCoarsePointerTarget}
              className={`${token.button.base} ${token.density.coarsePointerTarget} ${token.button.quiet} ${token.focusRing} ml-auto`}
              data-editor-parity-state="coarse-pointer"
              type="button"
            >
              <Plus size={16} />
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}

const professionalEditorShellImage: SelectedImage = {
  ...adjustmentsPanelRetuneRawImage,
  height: 3648,
  path: '/visual-smoke/professional-editor-shell.ARW',
  width: 5472,
};

const professionalEditorToolbarImage: SelectedImage = {
  ...professionalEditorShellImage,
  exif: {
    DateTimeOriginal: '2026:06:17 19:24:31',
    ExposureTime: '1/250',
    FNumber: '5.6',
    FocalLengthIn35mmFilm: '35',
    ISO: '200',
  },
  path: '/visual-smoke/professional-editor-toolbar.NEF?vc=7',
};

const professionalEditorShellImageList: ImageFile[] = [
  {
    exif: null,
    is_edited: true,
    is_virtual_copy: false,
    modified: 1_772_333_000,
    path: professionalEditorShellImage.path,
    rating: 4,
    tags: ['shell'],
  },
];

const buildProfessionalFilmstripThumb = (tone: string, accent: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220"><rect width="320" height="220" fill="${tone}"/><path d="M0 148 C72 112 118 132 172 88 C214 54 258 68 320 34 L320 220 L0 220 Z" fill="${accent}" opacity="0.72"/><path d="M0 176 C84 128 146 162 208 116 C250 86 282 92 320 70 L320 220 L0 220 Z" fill="#0b0d10" opacity="0.52"/><circle cx="78" cy="58" r="27" fill="#f3e7b6" opacity="0.78"/><text x="18" y="204" fill="#f7f7f2" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="700">${label}</text></svg>`,
  )}`;

const professionalFilmstripThumbs = [
  buildProfessionalFilmstripThumb('#1f2931', '#7b9a78', 'A01'),
  buildProfessionalFilmstripThumb('#242733', '#aa8b58', 'A02'),
  buildProfessionalFilmstripThumb('#1b3035', '#647d9f', 'A03'),
  buildProfessionalFilmstripThumb('#30242a', '#9b6f75', 'A04'),
  buildProfessionalFilmstripThumb('#253125', '#8fa864', 'A05'),
] as const;

const professionalFilmstripImageList: ImageFile[] = [
  {
    exif: {
      RawEngineCameraProfileFallbackReason: 'matrix_profile_missing',
      RawEngineCameraProfileStatus: 'fallback',
      RawEngineRawProcessingMode: 'highlight_recovery',
      RawEngineRawProcessingProvenance: 'GPU preview',
    },
    is_edited: true,
    is_virtual_copy: false,
    modified: 1_772_333_100,
    path: '/visual-smoke/filmstrip-context-active.ARW',
    rating: 4,
    tags: ['color:red', 'select'],
  },
  {
    exif: {
      RawEngineCameraProfileWarnings: 'dual_illuminant_estimate',
      RawEngineRawProcessingMode: 'balanced',
    },
    is_edited: false,
    is_virtual_copy: false,
    modified: 1_772_333_200,
    path: '/visual-smoke/filmstrip-context-selected.NEF',
    rating: 2,
    tags: ['color:yellow', 'select'],
  },
  {
    exif: {
      RawEngineRawProcessingMode: 'low_noise',
      RawEngineRawProcessingProvenance: 'CPU proof',
    },
    is_edited: true,
    is_virtual_copy: false,
    modified: 1_772_333_300,
    path: '/visual-smoke/filmstrip-context-multiselect.RAF',
    rating: 5,
    tags: ['color:green', 'select'],
  },
  {
    exif: null,
    is_edited: false,
    is_virtual_copy: true,
    modified: 1_772_333_400,
    path: '/visual-smoke/filmstrip-context-copy.DNG?vc=2',
    rating: 1,
    tags: ['color:blue'],
  },
  {
    exif: {
      RawEngineCameraProfileStatus: 'unavailable',
      RawEngineCameraProfileFallbackReason: 'unsupported_camera',
    },
    is_edited: true,
    is_virtual_copy: false,
    modified: 1_772_333_500,
    path: '/visual-smoke/filmstrip-context-loading.CR3',
    rating: 0,
    tags: null,
  },
];

const professionalFilmstripSelectedImage: SelectedImage = {
  ...professionalEditorShellImage,
  exif: professionalFilmstripImageList[0]?.exif ?? null,
  path: professionalFilmstripImageList[0]?.path ?? professionalEditorShellImage.path,
  thumbnailUrl: professionalFilmstripThumbs[0],
};

const professionalFilmstripContextTitle = 'Professional filmstrip context';
const professionalFilmstripContextStatus = 'bottom bar';

function useProfessionalEditorToolbarSmokeState() {
  useEffect(() => {
    const initial = structuredClone(INITIAL_ADJUSTMENTS);
    const exposure = { ...initial, exposure: 0.42 };
    const crop = { ...exposure, crop: { x: 0.06, y: 0.08, width: 0.88, height: 0.78 } };
    const masks = {
      ...crop,
      masks: [
        {
          adjustments: { ...INITIAL_MASK_ADJUSTMENTS, clarity: 14, exposure: 0.2 },
          id: 'visual-smoke-mask-1',
          invert: false,
          name: 'Face dodge',
          opacity: 78,
          subMasks: [] as SubMask[],
          visible: true,
        },
      ] as MaskContainer[],
    };

    useSettingsStore.setState({
      appSettings: {
        exportPresets: [
          {
            blackPointCompensation: true,
            colorProfile: ExportColorProfile.DisplayP3,
            dontEnlarge: true,
            enableResize: false,
            enableWatermark: false,
            fileFormat: 'jpeg',
            filenameTemplate: '{original_filename}_proof',
            id: 'visual-smoke-display-p3',
            jpegQuality: 92,
            keepMetadata: true,
            name: 'Display P3 proof',
            preserveTimestamps: true,
            renderingIntent: ExportRenderingIntent.RelativeColorimetric,
            resizeMode: 'longEdge',
            resizeValue: 2048,
            stripGps: true,
            watermarkAnchor: 'bottomRight',
            watermarkOpacity: 75,
            watermarkPath: null,
            watermarkScale: 10,
            watermarkSpacing: 5,
          },
        ],
        lastRootPath: null,
        theme: Theme.Dark,
      },
      osPlatform: 'macos',
    });
    useEditorStore.setState({
      adjustments: masks,
      exportSoftProofRecipeId: 'visual-smoke-display-p3',
      exportSoftProofTransform: {
        blackPointCompensation: 'enabled',
        colorManagedTransform: 'display-p3-preview',
        effectiveColorProfile: ExportColorProfile.DisplayP3,
        effectiveRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
        policyStatus: 'applied',
        policyVersion: 'visual-smoke-v1',
        sourcePrecisionPath: 'raw-linear-f32',
        transformApplied: true,
        transformPolicyFingerprint: 'sha256:professional-editor-toolbar-smoke',
      },
      history: [initial, exposure, crop, masks],
      historyIndex: 2,
      isExportSoftProofEnabled: true,
      selectedImage: professionalEditorToolbarImage,
      compare: {
        ...useEditorStore.getState().compare,
        mode: 'hold-original',
      },
    });
  }, []);
}

function useProfessionalEditorSmokeState() {
  useEffect(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    useEditorStore.setState({
      adjustments,
      displaySize: { height: 540, width: 810 },
      histogram: null,
      history: [adjustments],
      historyIndex: 0,
      isWaveformVisible: false,
      originalSize: { height: professionalEditorShellImage.height, width: professionalEditorShellImage.width },
      previewScopeStatus: null,
      selectedImage: professionalEditorShellImage,
      waveform: null,
      waveformHeight: PANEL_SCOPES_HEIGHT.default,
    });
    useUIStore.setState({
      collapsibleSectionsState: { ...DEFAULT_COLLAPSIBLE_SECTIONS_STATE },
    });
  }, []);
}

function useProfessionalFilmstripContextSmokeState() {
  useEffect(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      contrast: 12,
      exposure: 0.35,
      highlights: -28,
      shadows: 18,
    };
    useEditorStore.setState({
      adjustments,
      copiedAdjustments: { contrast: adjustments.contrast, exposure: adjustments.exposure },
      displaySize: { height: 680, width: 1020 },
      histogram: null,
      history: [adjustments],
      historyIndex: 0,
      isWaveformVisible: false,
      originalSize: {
        height: professionalFilmstripSelectedImage.height,
        width: professionalFilmstripSelectedImage.width,
      },
      previewScopeStatus: null,
      selectedImage: professionalFilmstripSelectedImage,
      waveform: null,
      waveformHeight: PANEL_SCOPES_HEIGHT.default,
    });
    useLibraryStore.setState({
      filterCriteria: {
        ...useLibraryStore.getState().filterCriteria,
        colors: ['red', 'yellow'],
        rating: 2,
      },
      imageList: professionalFilmstripImageList,
      imageRatings: {
        [professionalFilmstripImageList[0]?.path ?? '']: 4,
        [professionalFilmstripImageList[1]?.path ?? '']: 2,
        [professionalFilmstripImageList[2]?.path ?? '']: 5,
        [professionalFilmstripImageList[3]?.path ?? '']: 1,
      },
      multiSelectedPaths: professionalFilmstripImageList.slice(0, 4).map((image) => image.path),
    });
    thumbnailCache.setMany(
      professionalFilmstripImageList.slice(0, 4).map((image, index) => ({
        generation: 0,
        path: image.path,
        url: professionalFilmstripThumbs[index] ?? null,
      })),
    );
    useProcessStore.setState({
      isCopied: true,
      isPasted: true,
    });
  }, []);
}

function ProfessionalEditorToolbarVisualSmoke() {
  const [historyIndex, setHistoryIndex] = useState(2);
  const [showOriginal, setShowOriginal] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [history] = useState(() => {
    const initial = structuredClone(INITIAL_ADJUSTMENTS);
    const exposure = { ...initial, exposure: 0.42 };
    const crop = { ...exposure, crop: { x: 0.06, y: 0.08, width: 0.88, height: 0.78 } };
    const masks = {
      ...crop,
      masks: [
        {
          adjustments: { ...INITIAL_MASK_ADJUSTMENTS, clarity: 14, exposure: 0.2 },
          id: 'visual-smoke-mask-1',
          invert: false,
          name: 'Face dodge',
          opacity: 78,
          subMasks: [] as SubMask[],
          visible: true,
        },
      ] as MaskContainer[],
    };
    return [initial, exposure, crop, masks];
  });
  useProfessionalEditorToolbarSmokeState();

  return (
    <main
      className="min-h-screen bg-editor-matte p-4 font-sans text-text-primary max-[700px]:p-2"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorToolbar}
      data-visual-smoke-ready="true"
    >
      <div className="mx-auto flex h-[calc(100vh-32px)] max-w-6xl flex-col gap-3 overflow-hidden max-[700px]:h-[calc(100vh-16px)]">
        <header className="flex min-h-9 shrink-0 items-center justify-between">
          <h1 className={editorChromeTokens.typography.panelTitle}>{copy.professionalEditorToolbar}</h1>
          <div className="flex gap-1.5">
            <span className={editorChromeStatusChipClassName('success')}>{copy.professionalEditorReady}</span>
            <span className={editorChromeStatusChipClassName('warning')}>{copy.professionalEditorSoftProof}</span>
          </div>
        </header>

        <section
          className="rounded-lg border border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-editor-toolbar-primary"
        >
          <EditorToolbar
            canRedo={historyIndex < history.length - 1}
            canUndo={historyIndex > 0}
            isAndroid={false}
            isFullScreen={isFullscreen}
            isLoading={true}
            negativeLabDisabledReason="Unsupported source for this handoff"
            onBackToLibrary={() => {}}
            onOpenNegativeLab={() => {}}
            onRedo={() => setHistoryIndex((index) => Math.min(index + 1, history.length - 1))}
            onToggleFullScreen={() => setIsFullscreen((value) => !value)}
            onToggleShowOriginal={() => setShowOriginal((value) => !value)}
            onUndo={() => setHistoryIndex((index) => Math.max(index - 1, 0))}
            osPlatform="macos"
            selectedImage={professionalEditorToolbarImage}
            showOriginal={showOriginal}
          />
        </section>

        <section
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-3 overflow-hidden max-[700px]:grid-cols-1"
          data-visual-smoke-section="professional-editor-toolbar-workspace"
        >
          <div className="grid min-h-0 place-items-center overflow-hidden rounded-lg border border-editor-border bg-editor-panel-well p-4">
            <div className="aspect-[4/3] w-full max-w-4xl overflow-hidden rounded-md border border-editor-overlay-stroke bg-[linear-gradient(135deg,#162129,#435d62_38%,#a39062_64%,#ead7ab)] shadow-[0_24px_52px_var(--editor-overlay-shadow)]">
              <div className="h-full w-full bg-[radial-gradient(circle_at_36%_30%,rgba(255,247,213,0.56),transparent_18%),linear-gradient(168deg,transparent_52%,rgba(12,16,20,0.7)_53%)]" />
            </div>
          </div>

          <aside
            className="min-h-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel p-3"
            data-visual-smoke-section="professional-editor-toolbar-state-matrix"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-editor-border bg-editor-panel-raised p-2">
                <span className={editorChromeTokens.typography.compactRowLabel}>
                  {copy.professionalEditorToolbarHistory}
                </span>
                <span className={editorChromeStatusChipClassName('info')}>
                  {historyIndex + 1}/{history.length}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-editor-border bg-editor-panel-raised p-2">
                <span className={editorChromeTokens.typography.compactRowLabel}>
                  {copy.professionalEditorToolbarOriginalCompare}
                </span>
                <span className={editorChromeStatusChipClassName(showOriginal ? 'warning' : 'neutral')}>
                  {showOriginal ? 'original' : 'edited'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-editor-border bg-editor-panel-raised p-2">
                <span className={editorChromeTokens.typography.compactRowLabel}>
                  {copy.professionalEditorToolbarNegativeLab}
                </span>
                <span className={editorChromeStatusChipClassName('danger')}>
                  {copy.professionalEditorToolbarDisabled}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-editor-border bg-editor-panel-raised p-2">
                <span className={editorChromeTokens.typography.compactRowLabel}>
                  {copy.professionalEditorToolbarFullscreen}
                </span>
                <span className={editorChromeStatusChipClassName(isFullscreen ? 'success' : 'neutral')}>
                  {isFullscreen ? 'active' : 'ready'}
                </span>
              </div>
            </div>
          </aside>
        </section>

        <section
          className="rounded-lg border border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-editor-toolbar-fullscreen-state"
        >
          <EditorToolbar
            canRedo={false}
            canUndo={true}
            isAndroid={false}
            isFullScreen={true}
            isLoading={false}
            negativeLabDisabledReason={null}
            onBackToLibrary={() => {}}
            onOpenNegativeLab={() => {}}
            onRedo={() => {}}
            onToggleFullScreen={() => {}}
            onToggleShowOriginal={() => {}}
            onUndo={() => {}}
            osPlatform="macos"
            selectedImage={professionalEditorToolbarImage}
            showOriginal={false}
          />
        </section>
      </div>
    </main>
  );
}

function ProfessionalEditorCanvasWell({ portrait = false }: { portrait?: boolean }) {
  return (
    <div
      className="grid h-full min-h-0 place-items-center overflow-hidden rounded-lg border border-editor-border bg-editor-panel-well p-3"
      data-testid={portrait ? 'professional-editor-compact-canvas' : 'professional-editor-shell-canvas'}
      data-visual-smoke-section="professional-editor-canvas"
    >
      <div
        className={cx(
          'relative overflow-hidden rounded-md border border-editor-overlay-stroke shadow-[0_24px_52px_var(--editor-overlay-shadow)]',
          portrait ? 'aspect-[3/4] h-full max-h-[360px]' : 'aspect-[4/3] w-full max-w-5xl',
        )}
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#18232b_0%,#3f5960_36%,#968762_64%,#ebd5aa_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_36%_28%,rgba(255,246,208,0.56),transparent_18%),linear-gradient(170deg,transparent_52%,rgba(12,16,20,0.68)_53%)]" />
        <div className="absolute bottom-3 left-3 rounded border border-editor-overlay-stroke bg-editor-panel/80 px-2 py-1 text-[11px] text-text-secondary">
          {copy.professionalEditorPreviewReady}
        </div>
      </div>
    </div>
  );
}

function useProfessionalEditorStatusChipsSmokeState() {
  useEffect(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      levels: {
        ...INITIAL_ADJUSTMENTS.levels,
        inputBlack: 0.06,
        inputWhite: 0.92,
      },
    };
    const exportSoftProofTransform = {
      blackPointCompensation: 'enabled',
      colorManagedTransform: 'display-p3-preview',
      effectiveColorProfile: ExportColorProfile.DisplayP3,
      effectiveRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      policyStatus: 'applied',
      policyVersion: 'visual-smoke-v1',
      sourcePrecisionPath: 'raw-linear-f32',
      transformApplied: true,
      transformPolicyFingerprint: 'sha256:professional-editor-status-chips',
    };
    const gamutWarningOverlay: GamutWarningOverlayPayload = {
      black_point_compensation: exportSoftProofTransform.blackPointCompensation,
      color_managed_transform: exportSoftProofTransform.colorManagedTransform,
      coverage_ratio: 0.125,
      effective_color_profile: exportSoftProofTransform.effectiveColorProfile,
      effective_rendering_intent: exportSoftProofTransform.effectiveRenderingIntent,
      export_soft_proof_recipe_id: 'visual-smoke-display-p3',
      height: 180,
      mask_data_url: 'data:image/png;base64,AAAA',
      max_channel_value: 255,
      min_channel_value: 0,
      pixel_count: 360,
      policy_status: exportSoftProofTransform.policyStatus,
      policy_version: exportSoftProofTransform.policyVersion,
      preview_basis: 'export_preview',
      source_image_path: professionalEditorShellImage.path,
      source_precision_path: exportSoftProofTransform.sourcePrecisionPath,
      transform_applied: exportSoftProofTransform.transformApplied,
      transform_policy_fingerprint: exportSoftProofTransform.transformPolicyFingerprint,
      warning_pixel_count: 45,
      width: 240,
    };

    useEditorStore.setState({
      adjustments,
      exportSoftProofRecipeId: 'visual-smoke-display-p3',
      exportSoftProofTransform,
      gamutWarningOverlay,
      isExportSoftProofEnabled: true,
      previewScopeStatus: {
        displayTransformLabel: 'Display P3',
        exportProfileLabel: 'Display P3',
        exportRenderingIntentLabel: 'Relative Colorimetric',
        histogramReady: true,
        path: professionalEditorShellImage.path,
        renderBasis: 'export_preview',
        softProofTransformApplied: true,
        sourceLabel: 'Export preview',
        updatedAt: '2026-07-02T16:00:00.000Z',
        waveformReady: true,
        workingTransformLabel: 'Working RGB',
        warningCodes: [],
      },
      selectedImage: professionalEditorShellImage,
    });
  }, []);
}

function ProfessionalEditorStatusChipsVisualSmoke() {
  const { t } = useTranslation();
  useProfessionalEditorStatusChipsSmokeState();

  return (
    <main
      className="min-h-screen bg-editor-matte p-4 font-sans text-text-primary"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorStatusChips}
      data-visual-smoke-ready="true"
    >
      <div className="mx-auto grid h-[calc(100vh-32px)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
        <header className="flex min-h-9 shrink-0 items-center justify-between">
          <h1 className={editorChromeTokens.typography.panelTitle}>{t('editor.chromeStatus.visualSmokeTitle')}</h1>
          <span className={editorChromeStatusChipClassName('warning')}>
            {t('editor.chromeStatus.visualSmokeSummary')}
          </span>
        </header>
        <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3" data-visual-smoke-section="normal">
          <div className="relative min-h-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel-well p-2">
            <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-editor-panel-well">
              <div className="grid min-h-0 flex-1 place-items-center">
                <div className="aspect-[4/3] w-[82%] overflow-hidden rounded-md border border-editor-overlay-stroke bg-[linear-gradient(135deg,#18232b_0%,#3f5960_36%,#968762_64%,#ebd5aa_100%)] shadow-[0_24px_52px_var(--editor-overlay-shadow)]">
                  <div className="h-full w-full bg-[radial-gradient(circle_at_36%_28%,rgba(255,246,208,0.56),transparent_18%),linear-gradient(170deg,transparent_52%,rgba(12,16,20,0.68)_53%)]" />
                </div>
              </div>
              <ViewerFooter
                activeTool="crop"
                isFullScreen={false}
                isRendering={false}
                resolvedZoom={{
                  cssPercent: 100,
                  devicePixelsPerImagePixel: 1,
                  displayPercent: 100,
                  imagePixelsPerCssPixel: 1,
                  imagePixelsPerDevicePixel: 1,
                  mode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
                  requiredPreviewResolution: 4096,
                  transformScale: 1,
                }}
                samplerState={null}
                zoomResolutionState="ready"
              />
            </div>
          </div>
          <aside
            className="min-h-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel p-3"
            data-visual-smoke-section="fullscreen"
          >
            <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-editor-border bg-editor-panel-well">
              <div className="grid min-h-0 flex-1 place-items-center">
                <div className="aspect-[3/4] h-[78%] rounded-md border border-editor-overlay-stroke bg-[linear-gradient(160deg,#1b2630,#6d856f_52%,#d6c28c)] shadow-[0_18px_42px_var(--editor-overlay-shadow)]" />
              </div>
              <ViewerFooter
                activeTool="none"
                isFullScreen={true}
                isRendering={true}
                resolvedZoom={{
                  cssPercent: 50,
                  devicePixelsPerImagePixel: 0.5,
                  displayPercent: 50,
                  imagePixelsPerCssPixel: 2,
                  imagePixelsPerDevicePixel: 2,
                  mode: { kind: 'fit' },
                  requiredPreviewResolution: 2048,
                  transformScale: 1,
                }}
                samplerState={null}
                zoomResolutionState="settling"
              />
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ProfessionalEditorBottomBar() {
  return (
    <BottomBar
      filmstripHeight={96}
      imageList={professionalEditorShellImageList}
      imageRatings={{ [professionalEditorShellImage.path]: 4 }}
      isCopied={false}
      isCopyDisabled={false}
      isFilmstripVisible={false}
      isLoading={false}
      isPasted={false}
      isPasteDisabled={false}
      isRatingDisabled={false}
      isResizing={false}
      multiSelectedPaths={[professionalEditorShellImage.path]}
      onClearSelection={() => {}}
      onCopy={() => {}}
      onImageSelect={() => {}}
      onOpenCopyPasteSettings={() => {}}
      onPaste={() => {}}
      onRate={() => {}}
      onRequestThumbnails={() => {}}
      rating={4}
      selectedImage={professionalEditorShellImage}
      setIsFilmstripVisible={() => {}}
      showFilmstrip={false}
      showZoomControls={false}
      thumbnailAspectRatio={ThumbnailAspectRatio.Cover}
      totalImages={1}
    />
  );
}

function ProfessionalFilmstripContextVisualSmoke() {
  const [isFilmstripVisible, setIsFilmstripVisible] = useState(true);
  const [multiSelectedPaths, setMultiSelectedPaths] = useState(() =>
    professionalFilmstripImageList.slice(0, 4).map((image) => image.path),
  );
  const [selectedImage, setSelectedImage] = useState<SelectedImage>(professionalFilmstripSelectedImage);
  useProfessionalFilmstripContextSmokeState();

  const imageRatings = {
    [professionalFilmstripImageList[0]?.path ?? '']: 4,
    [professionalFilmstripImageList[1]?.path ?? '']: 2,
    [professionalFilmstripImageList[2]?.path ?? '']: 5,
    [professionalFilmstripImageList[3]?.path ?? '']: 1,
  };

  const bottomBarProps = {
    imageList: professionalFilmstripImageList,
    imageRatings,
    isCopyDisabled: false,
    isLoading: false,
    isPasteDisabled: false,
    isRatingDisabled: false,
    multiSelectedPaths,
    onClearSelection: () => {
      setMultiSelectedPaths([]);
    },
    onCopy: () => {},
    onImageSelect: (path: string) => {
      const selectedFile = professionalFilmstripImageList.find((image) => image.path === path);
      if (selectedFile) {
        setSelectedImage({
          ...professionalFilmstripSelectedImage,
          exif: selectedFile.exif ?? null,
          path: selectedFile.path,
          thumbnailUrl:
            professionalFilmstripThumbs[professionalFilmstripImageList.indexOf(selectedFile)] ??
            professionalFilmstripSelectedImage.thumbnailUrl,
        });
      }
      setMultiSelectedPaths([path]);
    },
    onOpenCopyPasteSettings: () => {},
    onPaste: () => {},
    onRate: () => {},
    onRequestThumbnails: () => {},
    onZoomChange: () => {},
    rating: 4,
    selectedImage,
    thumbnailAspectRatio: ThumbnailAspectRatio.Cover,
    totalImages: professionalFilmstripImageList.length,
  } satisfies Pick<
    Parameters<typeof BottomBar>[0],
    | 'imageList'
    | 'imageRatings'
    | 'isCopyDisabled'
    | 'isLoading'
    | 'isPasteDisabled'
    | 'isRatingDisabled'
    | 'multiSelectedPaths'
    | 'onClearSelection'
    | 'onCopy'
    | 'onImageSelect'
    | 'onOpenCopyPasteSettings'
    | 'onPaste'
    | 'onRate'
    | 'onRequestThumbnails'
    | 'onZoomChange'
    | 'rating'
    | 'selectedImage'
    | 'thumbnailAspectRatio'
    | 'totalImages'
  >;

  return (
    <main
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalFilmstripContext}
      data-visual-smoke-ready="true"
      style={{
        background: 'var(--editor-matte)',
        color: 'var(--text-primary)',
        display: 'grid',
        fontFamily: 'var(--font-sans)',
        minHeight: '100vh',
        overflow: 'hidden',
        padding: 12,
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', gap: 8, minHeight: 0, minWidth: 0, overflow: 'hidden', width: '100%' }}>
        <div
          data-visual-smoke-section="professional-filmstrip-context-title"
          style={{
            alignItems: 'center',
            background: 'var(--editor-panel)',
            border: '1px solid var(--editor-border)',
            borderRadius: 8,
            display: 'flex',
            justifyContent: 'space-between',
            minHeight: 32,
            paddingInline: 12,
          }}
        >
          <span className={editorChromeTokens.typography.panelTitle}>{professionalFilmstripContextTitle}</span>
          <span className={editorChromeStatusChipClassName('info')}>{professionalFilmstripContextStatus}</span>
        </div>
        <section data-visual-smoke-section="professional-filmstrip-editor-context" style={{ minHeight: 0 }}>
          <ProfessionalEditorCanvasWell />
        </section>

        <section
          data-testid="professional-filmstrip-context-expanded"
          data-visual-smoke-section="professional-filmstrip-context-expanded"
          style={{ minWidth: 0 }}
        >
          <BottomBar
            {...bottomBarProps}
            filmstripHeight={112}
            isCopied={true}
            isFilmstripVisible={isFilmstripVisible}
            isPasted={true}
            isResizing={false}
            setIsFilmstripVisible={setIsFilmstripVisible}
            showFilmstrip={true}
          />
        </section>

        <section
          data-visual-smoke-section="professional-filmstrip-context-secondary-states"
          style={{ display: 'grid', gap: 8, minWidth: 0 }}
        >
          <BottomBar
            {...bottomBarProps}
            filmstripHeight={112}
            isCopied={false}
            isCopyDisabled={true}
            isFilmstripVisible={false}
            isPasted={false}
            isPasteDisabled={true}
            isRatingDisabled={true}
            isResizing={false}
            selectedImage={undefined}
            setIsFilmstripVisible={() => {}}
            showFilmstrip={true}
          />
          <BottomBar
            {...bottomBarProps}
            isCopied={true}
            isFilmstripVisible={false}
            isPasted={true}
            showFilmstrip={false}
          />
        </section>
      </div>
    </main>
  );
}

function ProfessionalEditorPanelHost({
  activePanel,
  onPanelSelect,
  slideDirection = 0,
}: {
  activePanel: Panel | null;
  onPanelSelect: (panel: Panel) => void;
  slideDirection?: number;
}) {
  const exportState = { errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle };

  return (
    <>
      <div data-visual-smoke-section="professional-editor-rail">
        <RightPanelSwitcher activePanel={activePanel} isInstantTransition={true} onPanelSelect={onPanelSelect} />
      </div>
      <div
        className="min-h-0 min-w-0 overflow-hidden border-l border-editor-border"
        data-visual-smoke-section="professional-editor-panel"
      >
        <ContextMenuProvider>
          <EditorRightPanelHost
            activeRightPanel={activePanel}
            appSettings={null}
            exportState={exportState}
            handleSettingsChange={() => {}}
            multiSelectedPaths={[professionalEditorShellImage.path]}
            onLinkedVariantImported={() => {}}
            onNavigateToCommunity={() => {}}
            onOpenTetherCapture={() => {}}
            renderedRightPanel={activePanel}
            rootPaths={[]}
            selectedImage={professionalEditorShellImage}
            setExportState={() => {}}
            slideDirection={slideDirection}
          />
        </ContextMenuProvider>
      </div>
    </>
  );
}

function ProfessionalEditorShellVisualSmoke() {
  const [activePanel, setActivePanel] = useState<Panel | null>(Panel.Adjustments);
  useProfessionalEditorSmokeState();
  const handlePanelSelect = (panel: Panel) => {
    useUIStore.getState().recordRecentRightPanel(panel);
    setActivePanel(panel);
  };

  return (
    <main
      className="h-full min-h-screen bg-editor-matte p-3 font-sans text-text-primary"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShell}
    >
      <div className="flex h-[calc(100vh-24px)] min-h-0 gap-2 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            className="flex min-h-11 shrink-0 items-center justify-between rounded-lg border border-editor-border bg-editor-panel px-3"
            data-visual-smoke-section="professional-editor-toolbar"
            data-testid="professional-editor-shell-toolbar"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{copy.professionalEditorShell}</span>
              <span className={editorChromeStatusChipClassName('success')}>{copy.professionalEditorReady}</span>
            </div>
            <span className={editorChromeStatusChipClassName('warning')}>{copy.professionalEditorSoftProof}</span>
          </div>
          <ProfessionalEditorCanvasWell />
          <div
            data-visual-smoke-section="professional-editor-bottom-bar"
            data-testid="professional-editor-shell-bottom-bar"
          >
            <ProfessionalEditorBottomBar />
          </div>
        </section>

        <div className="w-2 shrink-0 rounded bg-editor-matte" data-testid="professional-editor-shell-resizer" />

        <aside
          className="grid h-full min-w-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel"
          data-testid="professional-editor-shell-right-panel"
          style={{ gridTemplateColumns: '42px minmax(0, 360px)' }}
        >
          <ProfessionalEditorPanelHost activePanel={activePanel} onPanelSelect={handlePanelSelect} />
        </aside>
      </div>
    </main>
  );
}

const exportProofFooterReceipt = {
  completedAt: '2026-07-01T06:00:00.000Z',
  outputs: [
    {
      bitDepth: 16,
      blackPointCompensation: 'enabled',
      byteSize: 18_432_000,
      cmm: 'moxcms',
      colorManagedTransform: 'display-p3-output',
      colorProfile: 'Display P3',
      effectiveColorProfile: ExportColorProfile.DisplayP3,
      effectiveRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      format: 'tiff',
      iccEmbedded: true,
      outputPath: '/visual-smoke/exports/professional-export-proof-footer.tif',
      policyStatus: 'applied',
      policyVersion: 'visual-smoke-v1',
      renderingIntent: ExportRenderingIntent.RelativeColorimetric,
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      sourceIccProfileHash: 'sha256:visual-smoke-source-profile',
      sourcePath: professionalEditorShellImage.path,
      sourcePrecisionPath: 'raw-linear-f32',
      transformApplied: true,
      transformPolicyFingerprint: 'sha256:professional-export-proof-footer',
    },
  ],
  terminalStatus: 'completed' as const,
  total: 1,
};

function ExportProofFooterPanel({
  label,
  exportState,
  selectedImage = professionalEditorShellImage,
}: {
  exportState: Parameters<typeof ExportPanel>[0]['exportState'];
  label: string;
  selectedImage?: SelectedImage | null;
}) {
  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-surface bg-bg-secondary max-lg:min-h-[640px]"
      data-visual-smoke-section={`export-proof-footer-${label.toLowerCase()}`}
    >
      <div className="flex items-center justify-between border-b border-surface px-2 py-1">
        <span className={editorChromeTokens.typography.compactRowLabel}>{label}</span>
        <span className={editorChromeStatusChipClassName(exportState.status === Status.Error ? 'danger' : 'info')}>
          {exportState.status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ContextMenuProvider>
          <ExportPanel
            appSettings={{
              exportPresets: [],
              lastRootPath: null,
              theme: Theme.Dark,
            }}
            exportState={exportState}
            isVisible={true}
            multiSelectedPaths={selectedImage ? [selectedImage.path] : []}
            onLinkedVariantImported={() => {}}
            onSettingsChange={() => {}}
            rootPaths={[]}
            selectedImage={selectedImage}
            setExportState={() => {}}
          />
        </ContextMenuProvider>
      </div>
    </section>
  );
}

function ProfessionalExportProofFooterVisualSmoke() {
  useProfessionalEditorToolbarSmokeState();

  return (
    <main
      className="min-h-screen bg-bg-primary p-3 font-sans text-text-primary"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalExportProofFooter}
      data-visual-smoke-ready="true"
    >
      <div className="mx-auto flex flex-col gap-3 overflow-hidden" style={{ height: 'calc(100vh - 24px)' }}>
        <header className="flex items-center justify-between">
          <h1 className={editorChromeTokens.typography.panelTitle}>{copy.professionalExportProofFooter}</h1>
          <div className="flex gap-1.5">
            <span className={editorChromeStatusChipClassName('success')}>{copy.exportFooterIdle}</span>
            <span className={editorChromeStatusChipClassName('info')}>{copy.exportFooterRunning}</span>
            <span className={editorChromeStatusChipClassName('danger')}>{copy.exportFooterRetry}</span>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-5">
          <ExportProofFooterPanel
            label="Idle"
            exportState={{ errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle }}
          />
          <ExportProofFooterPanel
            label="Running"
            exportState={{ errorMessage: '', progress: { current: 1, total: 3 }, status: Status.Exporting }}
          />
          <ExportProofFooterPanel
            label="Completed"
            exportState={{
              errorMessage: '',
              lastReceipt: exportProofFooterReceipt,
              progress: { current: 1, total: 1 },
              status: Status.Success,
            }}
          />
          <ExportProofFooterPanel
            label="Failed"
            exportState={{
              errorMessage: 'Output folder was removed before export completed.',
              progress: { current: 0, total: 1 },
              status: Status.Error,
            }}
          />
          <ExportProofFooterPanel
            label="Blocked"
            exportState={{ errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle }}
            selectedImage={null}
          />
        </div>
      </div>
    </main>
  );
}

function ProfessionalEditorCompactPortraitVisualSmoke() {
  const [activePanel, setActivePanel] = useState<Panel | null>(Panel.Color);
  useProfessionalEditorSmokeState();
  const handlePanelSelect = (panel: Panel) => {
    useUIStore.getState().recordRecentRightPanel(panel);
    setActivePanel(panel);
  };

  return (
    <main
      className="h-full min-h-screen bg-editor-matte p-2 font-sans text-text-primary"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorCompactPortrait}
    >
      <div className="flex h-[calc(100vh-16px)] min-h-0 flex-col gap-2 overflow-hidden">
        <div
          className="flex min-h-10 shrink-0 items-center justify-between rounded-lg border border-editor-border bg-editor-panel px-2"
          data-visual-smoke-section="professional-editor-compact-toolbar"
          data-testid="professional-editor-compact-toolbar"
        >
          <span className="truncate text-sm font-semibold">{copy.professionalEditorCompactPortrait}</span>
          <span className={editorChromeStatusChipClassName('info')}>{copy.professionalEditorCompact}</span>
        </div>

        <div
          className="shrink-0 border-y border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-editor-compact-bottom-bar"
          data-testid="professional-editor-compact-bottom-bar"
        >
          <ProfessionalEditorBottomBar />
        </div>

        <div className="min-h-[250px] flex-1 overflow-hidden">
          <ProfessionalEditorCanvasWell portrait />
        </div>

        <section
          className="flex min-h-[360px] shrink-0 flex-col overflow-hidden rounded-lg border border-editor-border bg-editor-panel"
          data-testid="professional-editor-compact-panel-shell"
        >
          <div
            className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-editor-border px-2 py-1.5"
            data-testid="professional-editor-compact-panel-header"
          >
            <div className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal aria-hidden="true" className="text-text-secondary" size={16} />
              <span className="truncate text-sm font-medium text-text-primary">{activePanel ?? Panel.Color}</span>
            </div>
            <div className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center text-text-tertiary"
                data-testid="professional-editor-compact-panel-grip"
              >
                <GripHorizontal size={18} />
              </span>
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-text-secondary"
                data-testid="professional-editor-compact-panel-toggle"
              >
                <ChevronDown size={14} />
              </span>
            </div>
          </div>
          <div
            className="shrink-0 border-b border-editor-border"
            data-visual-smoke-section="professional-editor-compact-switcher"
          >
            <RightPanelSwitcher
              activePanel={activePanel}
              isInstantTransition={true}
              layout="horizontal"
              onPanelSelect={handlePanelSelect}
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            data-visual-smoke-section="professional-editor-compact-panel"
          >
            <ContextMenuProvider>
              <EditorRightPanelHost
                activeRightPanel={activePanel}
                appSettings={null}
                exportState={{ errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle }}
                handleSettingsChange={() => {}}
                multiSelectedPaths={[professionalEditorShellImage.path]}
                onLinkedVariantImported={() => {}}
                onNavigateToCommunity={() => {}}
                onOpenTetherCapture={() => {}}
                renderedRightPanel={activePanel}
                rootPaths={[]}
                selectedImage={professionalEditorShellImage}
                setExportState={() => {}}
                slideDirection={0}
              />
            </ContextMenuProvider>
          </div>
        </section>
      </div>
    </main>
  );
}

const visualSmokeComponents = {
  [VISUAL_SMOKE_SCENARIO_IDS.AdjustmentsPanelRetune]: AdjustmentsPanelRetuneVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.AgentChatUi]: AgentChatVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.BrushMaskCanvasUi]: BrushMaskCanvasVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ColorRangeLocalAdjustment]: ColorRangeLocalAdjustmentVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ColorWorkflow]: ColorWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows]: CommandPaletteWorkflowSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.CullingCompareSync]: CullingCompareSyncVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.DetailDustSpot]: DetailDustSpotVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.DetailWorkspace]: DetailWorkspaceVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.EditorParityContract]: EditorParityContractVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FilmLookBrowser]: FilmLookVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview]: FocusPrivateRawModalReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi]: FocusPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusUi]: FocusStackVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff]: HdrPrivateRawEditorHandoffVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi]: HdrPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrSavedOutputEditorPath]: HdrSavedOutputEditorPathVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrUi]: HdrVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LayerBrushLocalAdjustment]: LayerBrushLocalAdjustmentVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi]: LayerMaskPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LayerStackWorkflow]: LayerStackWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LensCorrectionSession]: LensCorrectionSessionVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LibraryWorkflow]: LibraryWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.MaskOverlayRawProof]: MaskOverlayRawProofVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview]: NegativeLabPublicExportReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabEditorLayerHandoff]: NegativeLabEditorLayerHandoffVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview]: NegativeLabRealRawPrivateReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabWorkspace]: NegativeLabVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ObjectPromptUi]: ObjectPromptVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi]: PanoramaPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaProcessingCommand]: PanoramaProcessingCommandVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaSavedReview]: PanoramaSavedReviewVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaUi]: PanoramaVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAdjustmentsCompact]: ProfessionalAdjustmentsCompactVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalCanvasOverlays]: ProfessionalCanvasOverlaysVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalCropTransformWorkspace]: ProfessionalCropTransformWorkspaceVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorCompactPortrait]: ProfessionalEditorCompactPortraitVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorStatusChips]: ProfessionalEditorStatusChipsVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalFilmstripContext]: ProfessionalFilmstripContextVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShell]: ProfessionalEditorShellVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorToolbar]: ProfessionalEditorToolbarVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorTokens]: ProfessionalEditorTokensVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalExportProofFooter]: ProfessionalExportProofFooterVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAgentReview]: ProfessionalAgentReviewVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAgentReviewWorkspace]: ProfessionalAgentReviewWorkspaceVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ProfessionalLayersCompact]: ProfessionalLayersCompactVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview]: SuperResolutionPrivateRawModalReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi]: SuperResolutionPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrUi]: SuperResolutionVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.TetherDiscoveryUi]: TetherDiscoveryVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail]: WorkflowRailVisualSmoke,
} satisfies Partial<Record<VisualSmokeMode, () => ReactElement>>;
type VisualSmokeComponentMode = keyof typeof visualSmokeComponents;

const isVisualSmokeComponentMode = (mode: string): mode is VisualSmokeComponentMode => mode in visualSmokeComponents;

const agentChatSmokeTitle = 'Agent chat UI smoke';
const agentChatSmokeRuntime = 'UI-only';
const agentVisualSmokeHistogramBins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 9 : 3));
const workflowRailDensityTitle = 'Workflow rail density';
const workflowRailRuntime = 'UI polish';
const workflowRailTargetProof = 'Fixed 36px icon targets keep the rail compact without changing panel order.';
const workflowRailActivePanelLabel = 'Active panel';
const workflowRailNoPanelLabel = 'none';
const tetherDiscoverySmokeTitle = 'Tethered camera discovery';
const tetherDiscoveryMockResponse: TetherDiscoveryResponse = {
  cameras: [
    {
      batteryPercent: 87,
      capabilities: [
        { id: 'discovery', label: 'Discovery', status: 'ready' },
        { id: 'battery_status', label: 'Battery reported', status: 'ready' },
        { id: 'storage_status', label: 'Storage reported', status: 'ready' },
        { id: 'live_view', label: 'Live view simulator', status: 'ready' },
        { id: 'remote_capture', label: 'Remote capture ready', status: 'ready' },
      ],
      connection: {
        transport: 'USB-C PTP',
        trusted: true,
      },
      controls: [
        {
          currentValue: '400',
          id: 'iso',
          label: 'ISO',
          status: 'ready',
          unit: null,
          values: ['100', '200', '400', '800', '1600'],
          writable: true,
        },
        {
          currentValue: '1/125',
          id: 'shutterSpeed',
          label: 'Shutter',
          status: 'ready',
          unit: 's',
          values: ['1/60', '1/125', '1/250'],
          writable: true,
        },
        {
          currentValue: 'f/5.6',
          id: 'aperture',
          label: 'Aperture',
          status: 'ready',
          unit: 'f-stop',
          values: ['f/4', 'f/5.6', 'f/8'],
          writable: true,
        },
      ],
      displayName: 'Sony ILCE-7M4',
      id: 'validation-camera-sony-a7iv',
      make: 'Sony',
      model: 'ILCE-7M4',
      storage: {
        freeGb: 118.4,
        label: 'Slot 1',
        state: 'ready',
      },
    },
  ],
  provider: {
    adapter: 'visual_smoke_tether_provider',
    message: 'Visual smoke provider proves the discovery panel without requiring a physical camera.',
    mode: 'fake',
    status: 'ready',
  },
  proof: {
    fakeProviderAvailable: true,
    macosProviderBoundary: 'visual_smoke_provider_not_hardware_capture',
    manualHardwareRequired: true,
  },
};
const tetherSessionMockResponse: TetherSessionResponse = {
  session: {
    cameraDisplayName: 'Sony ILCE-7M4',
    cameraId: 'validation-camera-sony-a7iv',
    captureCounter: 0,
    destinationRoot: '/tmp/rawengine-tether-captures',
    openedAt: '2026-06-23T00:00:00.000Z',
    providerMode: 'fake',
    recovery: {
      message: 'Partial tether downloads were quarantined before capture.',
      partialFilesFound: 1,
      quarantinedFiles: ['/tmp/rawengine-tether-captures/.rawengine-tether-quarantine/interrupted.ARW.part'],
      status: 'quarantined',
    },
    sessionId: 'tether-session-visual-smoke',
    status: 'open',
  },
  status: 'open',
};
const tetherClosedSessionMockResponse: TetherSessionResponse = {
  session: null,
  status: 'closed',
};
const tetherCaptureMockResponse = {
  backup: {
    bytes: 25565952,
    checksum: 'sha256:2ada128405c6e1b55734bb69c842259b9e1d1882abbc8f0a50461f456a93e18b',
    destinationPath: '/tmp/rawengine-tether-backup/alaska-dsc7853_0001.ARW',
    enabled: true,
    error: null,
    status: 'verified',
  },
  bytes: 25565952,
  cameraDisplayName: 'Sony ILCE-7M4',
  cameraControlValues: {
    aperture: 'f/5.6',
    iso: '800',
    shutterSpeed: '1/125',
  },
  capturedAt: '2026-06-23T00:00:02.000Z',
  checksum: 'sha256:2ada128405c6e1b55734bb69c842259b9e1d1882abbc8f0a50461f456a93e18b',
  ingest: {
    addTags: ['wedding', 'incoming'],
    applyPresetIds: ['camera-standard-start'],
    collisionIndex: 1,
    fileName: '0001_alaska-dsc7853.ARW',
    namingTemplate: '{counter:04}_{source_stem}',
    presetId: 'wedding-copy-ingest',
  },
  importedPath: '/tmp/rawengine-tether-captures/alaska-dsc7853.ARW',
  metadata: {
    applied: true,
    appliedFields: ['rating', 'tags', 'Artist', 'ImageDescription', 'UserComment'],
    sidecarPath: '/tmp/rawengine-tether-captures/alaska-dsc7853.ARW.rrdata',
    templateId: 'studioSession',
  },
  providerMode: 'fake',
  sessionId: 'tether-session-visual-smoke',
  sourcePath: '/Users/cgas/Pictures/Capture One/Alaska/_DSC7853.ARW',
  status: 'captured',
} satisfies TetherCaptureResponse;

const brushMaskCanvasImageWidth = 640;
const brushMaskCanvasImageHeight = 360;
const brushMaskCanvasContainerId = 'brush-mask-canvas-container';
const brushMaskCanvasSubMaskId = 'brush-mask-canvas-submask';
const brushMaskCanvasImageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="${brushMaskCanvasImageWidth}" height="${brushMaskCanvasImageHeight}" viewBox="0 0 ${brushMaskCanvasImageWidth} ${brushMaskCanvasImageHeight}">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#2d4a62"/>
      <stop offset="0.45" stop-color="#496b7c"/>
      <stop offset="1" stop-color="#101820"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#sky)"/>
  <rect x="0" y="230" width="640" height="130" fill="#1c2a20"/>
  <path d="M0 250 C120 210 190 250 290 205 C390 160 475 210 640 165 L640 360 L0 360 Z" fill="#35473a"/>
  <circle cx="486" cy="72" r="38" fill="#e9d89a"/>
</svg>`)}`;

const brushMaskCanvasImage: SelectedImage = {
  exif: null,
  height: brushMaskCanvasImageHeight,
  isRaw: false,
  isReady: true,
  originalUrl: brushMaskCanvasImageDataUrl,
  path: '/validation/brush-mask-canvas-ui.jpg',
  thumbnailUrl: brushMaskCanvasImageDataUrl,
  width: brushMaskCanvasImageWidth,
};

const brushMaskCanvasBrushSettings: BrushSettings = {
  feather: 35,
  size: 72,
  tool: ToolType.Brush,
};

interface BrushMaskCanvasPoint {
  x: number;
  y: number;
}

interface BrushMaskCanvasLine {
  brushSize?: number;
  points: Array<BrushMaskCanvasPoint>;
  tool?: string;
}

const isBrushMaskCanvasPoint = (value: unknown): value is BrushMaskCanvasPoint => {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === 'number' && typeof point.y === 'number';
};

const isBrushMaskCanvasLine = (value: unknown): value is BrushMaskCanvasLine => {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as { brushSize?: unknown; points?: unknown; tool?: unknown };
  return (
    Array.isArray(line.points) &&
    line.points.every(isBrushMaskCanvasPoint) &&
    (line.brushSize === undefined || typeof line.brushSize === 'number') &&
    (line.tool === undefined || typeof line.tool === 'string')
  );
};

const readBrushMaskCanvasLines = (subMask: SubMask): Array<BrushMaskCanvasLine> => {
  const rawLines = subMask.parameters?.['lines'];
  return Array.isArray(rawLines) ? rawLines.filter(isBrushMaskCanvasLine) : [];
};

const isMaskContainer = (value: unknown): value is MaskContainer => {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as { subMasks?: unknown }).subMasks);
};

const createBrushMaskCanvasSubMask = (): SubMask => ({
  id: brushMaskCanvasSubMaskId,
  invert: false,
  mode: SubMaskMode.Additive,
  name: 'Brush canvas proof',
  opacity: 100,
  parameters: { lines: [] },
  type: Mask.Brush,
  visible: true,
});

const createBrushMaskCanvasContainer = (subMask: SubMask): MaskContainer => ({
  adjustments: INITIAL_ADJUSTMENTS,
  blendMode: 'normal',
  id: brushMaskCanvasContainerId,
  invert: false,
  name: 'Brush canvas proof',
  opacity: 100,
  subMasks: [subMask],
  visible: true,
});

const buildBrushMaskCanvasOverlayUrl = (subMask: SubMask | undefined): string | null => {
  const lines = subMask ? readBrushMaskCanvasLines(subMask) : [];
  if (lines.length === 0) return null;

  const paths = lines
    .map((line) => {
      if (line.points.length === 0) {
        return '';
      }
      const color = line.tool === ToolType.Eraser ? 'rgba(244,63,94,0.72)' : 'rgba(14,165,233,0.72)';
      const width = line.brushSize ?? 48;
      const points = line.points.map((point) => `${point.x},${point.y}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${brushMaskCanvasImageWidth}" height="${brushMaskCanvasImageHeight}" viewBox="0 0 ${brushMaskCanvasImageWidth} ${brushMaskCanvasImageHeight}">${paths}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

function BrushMaskCanvasVisualSmoke() {
  const [subMask, setSubMask] = useState(createBrushMaskCanvasSubMask);
  const [livePreview, setLivePreview] = useState<MaskContainer | null>(null);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(brushMaskCanvasBrushSettings);
  const activeSubMask = livePreview?.subMasks[0] ?? subMask;
  const lines = readBrushMaskCanvasLines(subMask);
  const toolOrder = lines.map((line) => line.tool ?? 'unknown').join(',');
  const pointCounts = lines.map((line) => String(line.points.length)).join(',');

  const updateSubMask = (id: string | null, patch: Partial<SubMask>) => {
    if (id !== brushMaskCanvasSubMaskId) return;
    setSubMask((current) => ({ ...current, ...patch }));
    setLivePreview(null);
  };

  const adjustments: Adjustments = {
    ...INITIAL_ADJUSTMENTS,
    aiPatches: [],
    masks: [createBrushMaskCanvasContainer(subMask)],
  };

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.BrushMaskCanvasUi}
    >
      <div className="grid h-screen grid-cols-[1fr_320px] bg-[#0f1114]" data-visual-smoke-section="brush-canvas">
        <section className="grid grid-rows-[44px_1fr] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.brushMaskCanvasUi}
            </span>
          </div>
          <div className="grid place-items-center bg-[#0b0d10] p-8">
            <div className="relative h-[360px] w-[640px] overflow-hidden rounded border border-white/10 bg-black">
              <ImageCanvas
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={brushMaskCanvasContainerId}
                activeMaskId={brushMaskCanvasSubMaskId}
                adjustments={adjustments}
                appSettings={null}
                brushSettings={brushSettings}
                crop={null}
                cursorStyle="crosshair"
                exportSoftProofRecipeId={null}
                exportSoftProofTransform={null}
                finalPreviewUrl={brushMaskCanvasImageDataUrl}
                gamutWarningOverlay={null}
                handleCropComplete={() => {}}
                hasRenderedFirstFrame
                imageRenderSize={{
                  height: brushMaskCanvasImageHeight,
                  offsetX: 0,
                  offsetY: 0,
                  scale: 1,
                  width: brushMaskCanvasImageWidth,
                }}
                isAiEditing={false}
                isCropping={false}
                isExportSoftProofEnabled={false}
                isMaskControlHovered={false}
                isMasking
                isMaxZoom={false}
                isRotationActive={false}
                isGamutWarningOverlayVisible={false}
                isSliderDragging={false}
                isStraightenActive={false}
                maskOverlayUrl={buildBrushMaskCanvasOverlayUrl(activeSubMask)}
                onGenerateAiMask={() => {}}
                onLiveMaskPreview={(preview) => {
                  if (isMaskContainer(preview)) setLivePreview(preview);
                }}
                onQuickErase={() => {}}
                onSelectAiSubMask={() => {}}
                onSelectMask={() => {}}
                onStraighten={() => {}}
                selectedImage={brushMaskCanvasImage}
                setAdjustments={() => {}}
                setCrop={() => {}}
                setIsMaskHovered={() => {}}
                setIsMaskTouchInteracting={() => {}}
                showOriginal={false}
                transformState={{ positionX: 0, positionY: 0, scale: 1 }}
                transformedOriginalUrl={brushMaskCanvasImageDataUrl}
                uncroppedAdjustedPreviewUrl={brushMaskCanvasImageDataUrl}
                updateSubMask={updateSubMask}
              />
            </div>
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm" data-visual-smoke-section="brush-proof">
          <div
            className="sr-only"
            data-image-height={brushMaskCanvasImageHeight}
            data-image-path={brushMaskCanvasImage.path}
            data-image-width={brushMaskCanvasImageWidth}
            data-lines-json={encodeURIComponent(JSON.stringify(lines))}
            data-mask-id={brushMaskCanvasSubMaskId}
            data-point-counts={pointCounts}
            data-refine-brush-feather={brushSettings.feather}
            data-refine-brush-size={brushSettings.size}
            data-stroke-count={lines.length}
            data-testid="brush-mask-canvas-ui-proof"
            data-tool-order={toolOrder}
          />
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.runtimeProof}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.strokeCount(lines.length)}</span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
              onClick={() => {
                setBrushSettings((current) => ({ ...current, size: 96 }));
              }}
              type="button"
            >
              {copy.brushSize96}
            </button>
            <button
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
              onClick={() => {
                setBrushSettings((current) => ({ ...current, feather: 64 }));
              }}
              type="button"
            >
              {copy.brushFeather64}
            </button>
          </div>
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.toolOrder}</p>
              <p>{toolOrder || 'none'}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.pointCounts}</p>
              <p>{pointCounts || 'none'}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

const cropTransformSmokeImage: SelectedImage = {
  ...brushMaskCanvasImage,
  path: '/validation/professional-crop-transform-workspace.jpg',
};

function ProfessionalCropTransformWorkspaceVisualSmoke() {
  const adjustments = useEditorStore((state) => state.adjustments);
  const overlayMode = useEditorStore((state) => state.overlayMode);
  const overlayRotation = useEditorStore((state) => state.overlayRotation);
  const isStraightenActive = useEditorStore((state) => state.isStraightenActive);
  const liveRotation = useEditorStore((state) => state.liveRotation);
  const [crop, setCropState] = useState<Crop>({
    height: 64,
    unit: '%',
    width: 68,
    x: 16,
    y: 18,
  });

  useEffect(() => {
    const nextAdjustments: Adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aspectRatio: 16 / 9,
      crop: {
        height: Math.round(brushMaskCanvasImageHeight * 0.64),
        width: Math.round(brushMaskCanvasImageWidth * 0.68),
        x: Math.round(brushMaskCanvasImageWidth * 0.16),
        y: Math.round(brushMaskCanvasImageHeight * 0.18),
      },
      flipHorizontal: true,
      rotation: 2.4,
    };

    useEditorStore.setState({
      adjustments: nextAdjustments,
      displaySize: { height: 405, width: 720 },
      finalPreviewUrl: brushMaskCanvasImageDataUrl,
      hasRenderedFirstFrame: true,
      history: [nextAdjustments],
      historyIndex: 0,
      isRotationActive: false,
      isStraightenActive: false,
      liveRotation: null,
      originalSize: { height: cropTransformSmokeImage.height, width: cropTransformSmokeImage.width },
      overlayMode: 'phiGrid',
      overlayRotation: 1,
      selectedImage: cropTransformSmokeImage,
      transformedOriginalUrl: brushMaskCanvasImageDataUrl,
      uncroppedAdjustedPreviewUrl: brushMaskCanvasImageDataUrl,
    });
    useUIStore.setState({
      collapsibleSectionsState: { ...DEFAULT_COLLAPSIBLE_SECTIONS_STATE },
      isLensCorrectionModalOpen: false,
      isTransformModalOpen: false,
    });
  }, []);

  const isCompactViewport = typeof window !== 'undefined' && window.innerWidth < 700;

  return (
    <main
      className="h-full min-h-screen bg-editor-matte font-sans text-text-primary"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalCropTransformWorkspace}
      style={{ padding: isCompactViewport ? 8 : 12 }}
    >
      <div
        className="grid min-h-0 overflow-hidden rounded-lg border border-editor-border bg-editor-panel"
        style={{
          gridTemplateColumns: isCompactViewport ? '1fr' : 'minmax(0, 1fr) 360px',
          gridTemplateRows: isCompactViewport ? 'minmax(0, 1fr) 420px' : undefined,
          height: `calc(100vh - ${isCompactViewport ? 16 : 24}px)`,
        }}
      >
        <section
          className={cx(
            'grid min-h-0 border-editor-border bg-editor-matte',
            isCompactViewport ? 'border-b' : 'border-r',
          )}
          data-visual-smoke-section="crop-transform-canvas"
          style={{ gridTemplateRows: '40px minmax(0, 1fr)' }}
        >
          <div className="flex items-center justify-between border-b border-editor-border bg-editor-panel px-3">
            <span className="text-sm font-semibold">{copy.professionalCropTransformWorkspace}</span>
            <span className={editorChromeStatusChipClassName('info')}>{copy.runtimeOverlay}</span>
          </div>
          <div className="grid min-h-0 place-items-center" style={{ padding: isCompactViewport ? 12 : 20 }}>
            <div
              className="relative h-full w-full overflow-hidden rounded-md border border-editor-overlay-stroke bg-black shadow-2xl"
              data-testid="professional-crop-transform-canvas"
              style={{ maxHeight: 520, maxWidth: 920 }}
            >
              <ImageCanvas
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={null}
                activeMaskId={null}
                adjustments={adjustments}
                appSettings={null}
                brushSettings={null}
                crop={crop}
                cursorStyle="default"
                exportSoftProofRecipeId={null}
                exportSoftProofTransform={null}
                finalPreviewUrl={brushMaskCanvasImageDataUrl}
                gamutWarningOverlay={null}
                handleCropComplete={(nextCrop: Crop) => {
                  setCropState(nextCrop);
                }}
                hasRenderedFirstFrame
                imageRenderSize={{ height: 405, offsetX: 0, offsetY: 0, scale: 1, width: 720 }}
                isAiEditing={false}
                isCropping={true}
                isExportSoftProofEnabled={false}
                isGamutWarningOverlayVisible={false}
                isMaskControlHovered={false}
                isMasking={false}
                isMaxZoom={false}
                isRotationActive={false}
                isSliderDragging={false}
                isStraightenActive={isStraightenActive}
                liveRotation={liveRotation}
                maskOverlayUrl={null}
                onGenerateAiMask={() => {}}
                onQuickErase={() => {}}
                onSelectAiSubMask={() => {}}
                onSelectMask={() => {}}
                onStraighten={() => {}}
                overlayMode={overlayMode}
                overlayRotation={overlayRotation}
                selectedImage={cropTransformSmokeImage}
                setAdjustments={(updater) => {
                  useEditorStore.setState((state) => ({ adjustments: updater(state.adjustments) }));
                }}
                setCrop={(nextCrop: Crop, _percentageCrop: PercentCrop) => {
                  setCropState(nextCrop);
                }}
                setIsMaskHovered={() => {}}
                setIsMaskTouchInteracting={() => {}}
                showOriginal={false}
                transformState={{ positionX: 0, positionY: 0, scale: 1 }}
                transformedOriginalUrl={brushMaskCanvasImageDataUrl}
                uncroppedAdjustedPreviewUrl={brushMaskCanvasImageDataUrl}
                updateSubMask={() => {}}
              />
            </div>
          </div>
        </section>

        <aside
          className="min-h-0 overflow-hidden bg-editor-panel"
          data-testid="professional-crop-transform-panel"
          data-visual-smoke-section="crop-transform-panel"
        >
          <ContextMenuProvider>
            <CropPanel />
          </ContextMenuProvider>
        </aside>

        <div
          className="sr-only"
          data-active-overlay={overlayMode}
          data-aspect-ratio={String(adjustments.aspectRatio)}
          data-canvas-backed="image-canvas"
          data-crop-height={String(crop.height)}
          data-crop-width={String(crop.width)}
          data-flip-horizontal={String(adjustments.flipHorizontal)}
          data-testid="professional-crop-transform-proof"
          data-visual-smoke-section="crop-transform-proof"
        />
      </div>
    </main>
  );
}

const professionalCanvasAppSettings = {
  lastRootPath: null,
  theme: Theme.Dark,
  useWgpuRenderer: false,
} satisfies AppSettings;

const professionalCanvasRetouchTargetMaskId = 'professional-canvas-retouch-target-mask';
const professionalCanvasRetouchLayerId = 'professional-canvas-retouch-layer';

const professionalCanvasRetouchMask: SubMask = {
  id: professionalCanvasRetouchTargetMaskId,
  invert: false,
  mode: SubMaskMode.Additive,
  name: 'Retouch target',
  opacity: 100,
  parameters: {
    centerX: brushMaskCanvasImageWidth * 0.56,
    centerY: brushMaskCanvasImageHeight * 0.48,
    radiusX: 46,
    radiusY: 46,
    rotation: 0,
  },
  type: Mask.Radial,
  visible: true,
};

const professionalCanvasRetouchContainer: MaskContainer = {
  adjustments: INITIAL_ADJUSTMENTS,
  blendMode: 'normal',
  id: professionalCanvasRetouchLayerId,
  invert: false,
  name: 'Retouch canvas proof',
  opacity: 100,
  retouchCloneSource: {
    featherRadiusPx: 22,
    radiusPx: 46,
    retouchMode: 'heal',
    rotationDegrees: -12,
    scale: 1.08,
    sourcePoint: { x: 0.31, y: 0.36 },
    targetPoint: { x: 0.56, y: 0.48 },
  },
  retouchRemoveSource: {
    featherRadiusPx: 18,
    generator: 'local_patch_fill_v1',
    generatorVersion: 1,
    radiusPx: 34,
    resolvedSourcePoint: { x: 0.74, y: 0.33 },
    searchRadiusMultiplier: 2.2,
    seed: 4504,
    status: 'stale',
    targetMaskId: professionalCanvasRetouchTargetMaskId,
  },
  subMasks: [professionalCanvasRetouchMask],
  visible: true,
};

const professionalCanvasBrushSubMask: SubMask = {
  ...createBrushMaskCanvasSubMask(),
  parameters: {
    lines: [
      {
        brushSize: 64,
        feather: 0.45,
        points: [
          { x: 130, y: 142 },
          { x: 182, y: 128 },
          { x: 238, y: 138 },
          { x: 302, y: 164 },
        ],
        tool: ToolType.Brush,
      },
    ],
  },
};

const professionalCanvasProofTransformValues = {
  blackPointCompensation: 'enabled',
  colorManagedTransform: 'relative_colorimetric',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'relative_colorimetric',
  policyStatus: 'ready',
  policyVersion: 'professional-canvas-overlays-v1',
  sourcePrecisionPath: '/validation/professional-canvas-overlays.float.tiff',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:professional-canvas-overlays',
} as const;

const professionalCanvasProofTransform: ExportSoftProofTransformState = professionalCanvasProofTransformValues;

const professionalCanvasGamutOverlay: GamutWarningOverlayPayload = {
  black_point_compensation: professionalCanvasProofTransformValues.blackPointCompensation,
  color_managed_transform: professionalCanvasProofTransformValues.colorManagedTransform,
  coverage_ratio: 0.084,
  effective_color_profile: professionalCanvasProofTransformValues.effectiveColorProfile,
  effective_rendering_intent: professionalCanvasProofTransformValues.effectiveRenderingIntent,
  export_soft_proof_recipe_id: 'professional-canvas-proof',
  height: brushMaskCanvasImageHeight,
  mask_data_url:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgJ/l9l6WQAAAABJRU5ErkJggg==',
  max_channel_value: 255,
  min_channel_value: 0,
  pixel_count: brushMaskCanvasImageWidth * brushMaskCanvasImageHeight,
  policy_status: professionalCanvasProofTransformValues.policyStatus,
  policy_version: professionalCanvasProofTransformValues.policyVersion,
  preview_basis: 'export_preview',
  source_image_path: brushMaskCanvasImage.path,
  source_precision_path: professionalCanvasProofTransformValues.sourcePrecisionPath,
  transform_applied: professionalCanvasProofTransformValues.transformApplied,
  transform_policy_fingerprint: professionalCanvasProofTransformValues.transformPolicyFingerprint,
  warning_pixel_count: 19354,
  width: brushMaskCanvasImageWidth,
};

function ProfessionalCanvasOverlaysVisualSmoke() {
  const [crop, setCropState] = useState<Crop>({ height: 62, unit: '%', width: 66, x: 18, y: 18 });
  const isCompactViewport = typeof window !== 'undefined' && window.innerWidth < 700;
  const cardClassName = 'relative min-h-0 overflow-hidden rounded-md border border-editor-overlay-stroke bg-black';
  const imageRenderSize = { height: 180, offsetX: 0, offsetY: 0, scale: 0.5, width: 320 };
  const cropRenderSize = { height: 270, offsetX: 0, offsetY: 0, scale: 0.75, width: 480 };
  const brushContainer = createBrushMaskCanvasContainer(professionalCanvasBrushSubMask);
  const brushOverlayUrl = buildBrushMaskCanvasOverlayUrl(professionalCanvasBrushSubMask);

  const baseCanvasProps = {
    appSettings: professionalCanvasAppSettings,
    cursorStyle: 'default',
    exportSoftProofRecipeId: null,
    exportSoftProofTransform: null,
    finalPreviewUrl: brushMaskCanvasImageDataUrl,
    gamutWarningOverlay: null,
    handleCropComplete: () => {},
    hasRenderedFirstFrame: true,
    imageRenderSize,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    isMaskControlHovered: false,
    isMaxZoom: false,
    isRotationActive: false,
    isSliderDragging: false,
    isStraightenActive: false,
    liveRotation: null,
    onGenerateAiMask: () => {},
    onQuickErase: () => {},
    onSelectAiSubMask: () => {},
    onSelectMask: () => {},
    onStraighten: () => {},
    selectedImage: brushMaskCanvasImage,
    setAdjustments: () => {},
    setCrop: () => {},
    setIsMaskHovered: () => {},
    setIsMaskTouchInteracting: () => {},
    showOriginal: false,
    transformState: { positionX: 0, positionY: 0, scale: 1.35 },
    transformedOriginalUrl: brushMaskCanvasImageDataUrl,
    uncroppedAdjustedPreviewUrl: brushMaskCanvasImageDataUrl,
    updateSubMask: () => {},
  } satisfies Partial<Parameters<typeof ImageCanvas>[0]>;

  return (
    <main
      className="min-h-screen bg-editor-matte p-3 font-sans text-text-primary"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalCanvasOverlays}
      data-visual-smoke-ready="true"
    >
      <div
        className="grid min-h-0 gap-3 overflow-hidden"
        style={{
          gridTemplateColumns: isCompactViewport ? '1fr' : 'minmax(0,1.35fr) minmax(300px,0.65fr)',
          height: 'calc(100vh - 24px)',
        }}
      >
        <section
          className="grid min-h-0 rounded-lg border border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-canvas-primary"
          style={{ gridTemplateRows: '40px minmax(0,1fr)' }}
        >
          <div className="flex items-center justify-between border-b border-editor-border px-3">
            <h1 className={editorChromeTokens.typography.panelTitle}>{copy.professionalCanvasOverlays}</h1>
            <span className={editorChromeStatusChipClassName('info')}>{copy.professionalCanvasActiveStates}</span>
          </div>
          <div
            className="grid min-h-0 gap-3 p-3"
            style={{ gridTemplateColumns: isCompactViewport ? '1fr' : '1fr 1fr' }}
          >
            <div className={cardClassName} data-visual-smoke-section="professional-canvas-crop">
              <ImageCanvas
                {...baseCanvasProps}
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={null}
                activeMaskId={null}
                adjustments={{ ...INITIAL_ADJUSTMENTS, aspectRatio: 16 / 9 }}
                brushSettings={null}
                crop={crop}
                imageRenderSize={cropRenderSize}
                isAiEditing={false}
                isCropping
                isMasking={false}
                maskOverlayUrl={null}
                overlayMode="phiGrid"
                overlayRotation={1}
                setCrop={(nextCrop: Crop) => {
                  setCropState(nextCrop);
                }}
              />
            </div>
            <div className={cardClassName} data-visual-smoke-section="professional-canvas-mask-brush">
              <ImageCanvas
                {...baseCanvasProps}
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={brushMaskCanvasContainerId}
                activeMaskId={brushMaskCanvasSubMaskId}
                adjustments={{ ...INITIAL_ADJUSTMENTS, masks: [brushContainer] }}
                brushSettings={{ feather: 58, size: 82, tool: ToolType.Brush }}
                crop={null}
                isAiEditing={false}
                isCropping={false}
                isMasking
                maskOverlayUrl={brushOverlayUrl}
              />
            </div>
            <div className={cardClassName} data-visual-smoke-section="professional-canvas-retouch-remove">
              <ImageCanvas
                {...baseCanvasProps}
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={professionalCanvasRetouchLayerId}
                activeMaskId={professionalCanvasRetouchTargetMaskId}
                adjustments={{ ...INITIAL_ADJUSTMENTS, masks: [professionalCanvasRetouchContainer] }}
                brushSettings={null}
                crop={null}
                isAiEditing={false}
                isCropping={false}
                isMasking
                maskOverlayUrl={null}
              />
            </div>
            <div
              className={`${cardClassName} grid place-items-center`}
              data-visual-smoke-section="professional-canvas-prompt-wb"
            >
              <img alt="" className="absolute inset-0 h-full w-full object-cover" src={brushMaskCanvasImageDataUrl} />
              <span
                className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-editor-success"
                style={{
                  boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.58), 0 5px 14px rgba(0, 0, 0, 0.72)',
                  left: '28%',
                  top: '36%',
                }}
              />
              <span
                className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-editor-danger"
                style={{
                  boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.58), 0 5px 14px rgba(0, 0, 0, 0.72)',
                  left: '68%',
                  top: '55%',
                }}
              />
              <span
                className="absolute border-2 border-editor-info bg-editor-info-surface"
                style={{
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.72), 0 8px 24px rgba(0, 0, 0, 0.55)',
                  height: '34%',
                  left: '38%',
                  top: '22%',
                  width: '32%',
                }}
              />
              <span
                className="absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90"
                style={{
                  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.9), 0 8px 22px rgba(0, 0, 0, 0.65)',
                  left: '54%',
                  top: '46%',
                }}
              >
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/90" />
                <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/90" />
              </span>
            </div>
          </div>
        </section>

        <aside
          className="grid min-h-0 rounded-lg border border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-canvas-status"
          style={{ gridTemplateRows: '40px minmax(0,1fr) auto' }}
        >
          <div className="flex items-center justify-between border-b border-editor-border px-3">
            <span className={editorChromeTokens.typography.panelTitle}>{copy.professionalCanvasProofStatus}</span>
            <span className={editorChromeStatusChipClassName('warning')}>{copy.professionalEditorSoftProof}</span>
          </div>
          <div className="min-h-0 p-3">
            <div className={cardClassName}>
              <ImageCanvas
                {...baseCanvasProps}
                activeAiPatchContainerId={null}
                activeAiSubMaskId={null}
                activeMaskContainerId={null}
                activeMaskId={null}
                adjustments={INITIAL_ADJUSTMENTS}
                brushSettings={null}
                crop={null}
                exportSoftProofRecipeId="professional-canvas-proof"
                exportSoftProofTransform={professionalCanvasProofTransform}
                gamutWarningOverlay={professionalCanvasGamutOverlay}
                imageRenderSize={{ height: 252, offsetX: 0, offsetY: 0, scale: 0.7, width: 448 }}
                isAiEditing={false}
                isCropping={false}
                isExportSoftProofEnabled
                isGamutWarningOverlayVisible
                isMasking={false}
                maskOverlayUrl={null}
                transformState={{ positionX: -42, positionY: 18, scale: 1.6 }}
              />
            </div>
          </div>
          <div
            className="sr-only"
            data-canvas-states="crop,brush,mask,retouch,remove,object-prompt,white-balance,soft-proof"
            data-compact-ready={String(isCompactViewport)}
            data-gamut-coverage={professionalCanvasGamutOverlay.coverage_ratio.toFixed(3)}
            data-overlay-token-source="canvasOverlayTokens"
            data-testid="professional-canvas-overlays-proof"
          />
        </aside>
      </div>
    </main>
  );
}

function WorkflowRailVisualSmoke() {
  const [activePanel, setActivePanel] = useState<Panel | null>(Panel.Adjustments);
  const [compactActivePanel, setCompactActivePanel] = useState<Panel | null>(Panel.Adjustments);
  const exportState = { errorMessage: '', progress: { current: 0, total: 0 }, status: Status.Idle };
  const handleDesktopPanelSelect = (panel: Panel) => {
    useUIStore.getState().recordRecentRightPanel(panel);
    setActivePanel(panel);
  };
  const handleCompactPanelSelect = (panel: Panel) => {
    useUIStore.getState().recordRecentRightPanel(panel);
    setCompactActivePanel(panel);
  };

  useEffect(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    useEditorStore.setState({
      adjustments,
      histogram: null,
      history: [adjustments],
      historyIndex: 0,
      isWaveformVisible: false,
      previewScopeStatus: null,
      selectedImage: adjustmentsPanelRetuneRawImage,
      waveform: null,
      waveformHeight: PANEL_SCOPES_HEIGHT.default,
    });
    useUIStore.setState({
      collapsibleSectionsState: { ...DEFAULT_COLLAPSIBLE_SECTIONS_STATE },
      recentRightPanels: [Panel.Adjustments],
    });
  }, []);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail}
    >
      <div className="grid h-screen overflow-hidden bg-[#0f1114]" style={{ gridTemplateRows: '620px 340px' }}>
        <div
          className="grid min-h-0"
          data-testid="workflow-rail-desktop-shell"
          data-visual-smoke-section="workflow-shell"
          style={{ gridTemplateColumns: 'minmax(0, 1fr) 8px 402px' }}
        >
          <section
            className="flex min-w-0 items-center justify-center border-r border-white/10 bg-[#121518] p-10"
            data-testid="workflow-rail-desktop-preview"
          >
            <div className="aspect-[4/3] w-full max-w-4xl rounded-md border border-white/10 bg-gradient-to-br from-[#29333b] via-[#677565] to-[#d7b078] shadow-2xl" />
          </section>

          <div className="bg-transparent" data-testid="workflow-rail-desktop-resizer" />

          <aside
            className="grid min-w-0 overflow-hidden bg-[#171a1f]"
            data-testid="workflow-rail-desktop-inspector"
            data-visual-smoke-section="workflow-rail"
            style={{ gridTemplateColumns: '42px minmax(0, 360px)' }}
          >
            <div data-testid="workflow-rail-desktop-rail">
              <RightPanelSwitcher
                activePanel={activePanel}
                isInstantTransition={true}
                onPanelSelect={handleDesktopPanelSelect}
              />
            </div>
            <div
              className="flex min-h-0 min-w-0 flex-col border-l border-white/10"
              data-testid="workflow-rail-desktop-panel"
            >
              <div className="shrink-0 border-b border-white/10 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{workflowRailDensityTitle}</span>
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
                    {workflowRailRuntime}
                  </span>
                </div>
              </div>
              <div className="space-y-2 p-3 text-xs text-[#aab2bd]">
                <div className="rounded-md border border-white/10 bg-white/5 p-3">{workflowRailTargetProof}</div>
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  {workflowRailActivePanelLabel}: {activePanel ?? workflowRailNoPanelLabel}
                </div>
              </div>

              <div className="min-h-0 flex-1 border-t border-white/10">
                <ContextMenuProvider>
                  <EditorRightPanelHost
                    activeRightPanel={activePanel}
                    appSettings={null}
                    exportState={exportState}
                    handleSettingsChange={() => {}}
                    multiSelectedPaths={[]}
                    onLinkedVariantImported={() => {}}
                    onNavigateToCommunity={() => {}}
                    onOpenTetherCapture={() => {}}
                    renderedRightPanel={activePanel}
                    rootPaths={[]}
                    selectedImage={null}
                    setExportState={() => {}}
                    slideDirection={0}
                  />
                </ContextMenuProvider>
              </div>
            </div>
          </aside>
        </div>

        <section
          className="grid min-h-0 border-t border-white/10 bg-[#101317]"
          data-testid="workflow-rail-compact-portrait"
          data-visual-smoke-section="compact-portrait"
          style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}
        >
          <div
            className="grid min-h-0"
            data-testid="workflow-rail-compact-preview-stack"
            style={{ gridTemplateRows: 'minmax(0, 1fr) 92px' }}
          >
            <div
              className="grid min-h-0 place-items-center border-r border-white/10 bg-[#121518] p-5"
              data-testid="workflow-rail-compact-preview"
            >
              <div
                className="aspect-[3/4] h-full rounded-md border border-white/10 bg-gradient-to-br from-[#26343a] via-[#5c6d68] to-[#cfa66f] shadow-xl"
                style={{ maxHeight: 220 }}
              />
            </div>
            <div
              className="grid grid-cols-4 gap-2 border-r border-t border-white/10 bg-[#181b1f] p-3"
              data-testid="workflow-rail-compact-filmstrip"
            >
              {filmstripFrames.slice(0, 4).map((frame) => (
                <div
                  className="flex min-w-0 items-center gap-2 rounded border border-white/10 bg-[#20252b] p-2"
                  key={frame.name}
                >
                  <div className={`h-10 w-12 shrink-0 rounded bg-gradient-to-br ${frame.tone}`} />
                  <span className="truncate text-xs text-[#dce4ea]">{frame.name}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-[#171a1f]" data-testid="workflow-rail-compact-panel">
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <div className="h-full rounded-md border border-white/10 bg-white/5 p-3">
                <div className="mb-2 text-sm font-semibold">{workflowRailActivePanelLabel}</div>
                <div className="text-xs text-[#aab2bd]" data-testid="workflow-rail-compact-active-panel">
                  {compactActivePanel ?? workflowRailNoPanelLabel}
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t border-white/10" data-testid="workflow-rail-compact-switcher">
              <RightPanelSwitcher
                activePanel={compactActivePanel}
                isInstantTransition={true}
                layout="horizontal"
                onPanelSelect={handleCompactPanelSelect}
              />
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function TetherDiscoveryVisualSmoke() {
  const [openedCapturePath, setOpenedCapturePath] = useState<string | null>(null);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-opened-capture-path={openedCapturePath ?? ''}
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.TetherDiscoveryUi}
    >
      <div className="grid h-screen grid-cols-[1fr_420px] bg-[#0f1114]" data-visual-smoke-section="tether-discovery">
        <section className="flex min-w-0 items-center justify-center border-r border-white/10 bg-[#121518] p-10">
          <div className="aspect-[4/3] w-full max-w-4xl rounded-md border border-white/10 bg-gradient-to-br from-[#22313a] via-[#6a715f] to-[#d6aa71] shadow-2xl" />
        </section>

        <aside className="overflow-y-auto border-l border-white/10 bg-[#171a1f]">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold">{tetherDiscoverySmokeTitle}</div>
          <TetherPanel
            captureFrame={() => Promise.resolve(tetherCaptureMockResponse)}
            closeSession={() => Promise.resolve(tetherClosedSessionMockResponse)}
            discoverCameras={() => Promise.resolve(tetherDiscoveryMockResponse)}
            getSession={() => Promise.resolve(tetherSessionMockResponse)}
            onOpenCapture={setOpenedCapturePath}
            openSession={(request) =>
              Promise.resolve({
                ...tetherSessionMockResponse,
                session:
                  tetherSessionMockResponse.session === null
                    ? null
                    : {
                        ...tetherSessionMockResponse.session,
                        destinationRoot: request.destinationRoot ?? tetherSessionMockResponse.session.destinationRoot,
                      },
              })
            }
            setCameraControl={(request) =>
              Promise.resolve({
                appliedValue: request.value,
                cameraId: request.cameraId,
                controlId: request.controlId,
                requestedValue: request.value,
                status: 'verified',
                verifiedAt: '2026-06-23T00:00:01.000Z',
              })
            }
          />
        </aside>
      </div>
    </main>
  );
}

function AgentChatVisualSmoke() {
  useState(() => {
    const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/_DSC7505.ARW';
    useLibraryStore.getState().setLibrary({
      activeAlbumId: 'album_agent_visual_smoke',
      albumTree: [
        { id: 'album_agent_visual_smoke', images: [selectedPath], name: 'Agent visual smoke', type: 'album' },
      ],
      currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
      filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
      folderTrees: [],
      imageList: [
        {
          exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
          is_edited: false,
          is_virtual_copy: false,
          modified: 1_781_928_505,
          path: selectedPath,
          rating: 4,
          tags: ['agent-visual-smoke'],
        },
      ],
      imageRatings: { [selectedPath]: 4 },
      libraryActivePath: selectedPath,
      multiSelectedPaths: [selectedPath],
      pinnedFolderTrees: [],
      rootPaths: ['/Users/cgas/Pictures/Capture One'],
      sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
    });
    useEditorStore.getState().setEditor({
      adjustments: INITIAL_ADJUSTMENTS,
      finalPreviewUrl: 'blob:rawengine-agent-visual-smoke-before',
      hasRenderedFirstFrame: true,
      histogram: {
        [ActiveChannel.Blue]: { color: '#4D96FF', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Green]: { color: '#6BCB77', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Luma]: { color: '#FFFFFF', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Red]: { color: '#FF6B6B', data: agentVisualSmokeHistogramBins },
      },
      history: [INITIAL_ADJUSTMENTS],
      historyIndex: 0,
      selectedImage: {
        exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
        height: 4000,
        isRaw: true,
        isReady: true,
        originalUrl: 'blob:rawengine-agent-visual-smoke-original',
        path: selectedPath,
        thumbnailUrl: 'blob:rawengine-agent-visual-smoke-thumb',
        width: 6000,
      },
      uncroppedAdjustedPreviewUrl: null,
    });
    return true;
  });

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.AgentChatUi}
    >
      <div className="flex h-screen bg-[#0f1114]" data-visual-smoke-section="agent-chat-ui">
        <div className="flex flex-1 items-center justify-center border-r border-white/10 bg-[#14171a] p-8">
          <div className="aspect-[4/3] w-full max-w-3xl rounded-md border border-white/10 bg-gradient-to-br from-[#25333a] via-[#5f6c5f] to-[#d5b076] shadow-2xl" />
        </div>
        <aside className="w-[420px] overflow-y-auto border-l border-white/10 bg-[#171a1f] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">{agentChatSmokeTitle}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {agentChatSmokeRuntime}
            </span>
          </div>
          <AgentChatShell transcript={agentChatTranscriptFixture} />
        </aside>
      </div>
    </main>
  );
}

const professionalAgentReviewStates = [
  'context blocked',
  'preview ready',
  'approval required',
  'applying',
  'applied',
  'rollback available',
  'failed',
  'export proof available',
] as const;

function ProfessionalAgentReviewVisualSmoke() {
  return (
    <main
      className="h-full min-h-screen bg-editor-matte text-text-primary font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAgentReview}
    >
      <div className="flex min-h-screen bg-editor-matte">
        <section
          className="flex flex-1 items-center justify-center border-r border-white/10 bg-editor-panel p-6"
          data-visual-smoke-section="professional-agent-review-preview"
        >
          <div className="w-full max-w-4xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase text-text-secondary">
                  {copy.professionalAgentReview}
                </p>
                <h1 className="text-lg font-semibold">{copy.professionalAgentReviewProposal}</h1>
              </div>
              <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                {copy.professionalAgentReviewMediumPreview}
              </span>
            </div>
            <div
              className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 shadow-2xl"
              style={{ background: 'linear-gradient(135deg, #1d3036, #6d725f 48%, #f1c778)' }}
            >
              <div className="grid h-full grid-cols-2">
                <div className="border-r border-white/10 bg-black/10 p-3">
                  <span className="rounded bg-black/45 px-2 py-1 text-[11px] font-semibold uppercase">
                    {copy.professionalAgentReviewBefore}
                  </span>
                </div>
                <div className="bg-white/10 p-3">
                  <span className="rounded bg-black/45 px-2 py-1 text-[11px] font-semibold uppercase">
                    {copy.professionalAgentReviewAfter}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]" data-testid="professional-agent-review-state-matrix">
              {professionalAgentReviewStates.map((state) => (
                <span
                  className="rounded border border-white/10 bg-white/5 px-2 py-1 text-text-secondary"
                  data-review-state={state}
                  key={state}
                >
                  {state}
                </span>
              ))}
            </div>
          </div>
        </section>
        <aside
          className="max-h-screen overflow-y-auto border-l border-white/10 bg-editor-panel p-4"
          data-visual-smoke-section="professional-agent-review-panel"
          style={{ width: '24rem' }}
        >
          <AgentChatShell transcript={agentChatTranscriptFixture} />
        </aside>
      </div>
    </main>
  );
}

function ProfessionalAgentReviewWorkspaceVisualSmoke() {
  useEffect(() => {
    useEditorStore.getState().setEditor({
      adjustments: INITIAL_ADJUSTMENTS,
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      hasRenderedFirstFrame: true,
      histogram: {
        [ActiveChannel.Blue]: { color: '#4D96FF', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Green]: { color: '#6BCB77', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Luma]: { color: '#FFFFFF', data: agentVisualSmokeHistogramBins },
        [ActiveChannel.Red]: { color: '#FF6B6B', data: agentVisualSmokeHistogramBins },
      },
      history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.35 }],
      historyIndex: 1,
      lastBasicToneCommand: null,
      selectedImage: {
        exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
        height: 3000,
        isRaw: true,
        isReady: true,
        metadata: null,
        originalUrl: 'blob:rawengine-agent-review-workspace-original',
        path: '/Users/cgas/Pictures/Capture One/DSC_4850.ARW',
        rawDevelopmentReport: null,
        thumbnailUrl: 'data:image/jpeg;base64,AAAA',
        width: 4500,
      },
      uncroppedAdjustedPreviewUrl: null,
    });
  }, []);

  return (
    <main
      className="h-full min-h-screen bg-editor-matte text-text-primary font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalAgentReviewWorkspace}
    >
      <div className="flex min-h-screen bg-editor-matte">
        <section
          className="flex flex-1 items-center justify-center border-r border-editor-border bg-editor-panel p-6"
          data-visual-smoke-section="professional-agent-review-workspace-preview"
        >
          <div className="w-full max-w-4xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase text-text-secondary">
                  {copy.professionalAgentReviewWorkspace}
                </p>
                <h1 className="text-lg font-semibold">{copy.professionalAgentReviewProposal}</h1>
              </div>
              <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                {copy.professionalAgentReviewMediumPreview}
              </span>
            </div>
            <div
              className="aspect-[4/3] overflow-hidden rounded border border-editor-border shadow-2xl"
              style={{ background: 'linear-gradient(135deg, #17252b, #597064 48%, #e5b665)' }}
            >
              <div className="grid h-full grid-cols-2">
                <div className="border-r border-white/10 bg-black/10 p-3">
                  <span className="rounded bg-black/45 px-2 py-1 text-[11px] font-semibold uppercase">
                    {copy.professionalAgentReviewBefore}
                  </span>
                </div>
                <div className="bg-white/10 p-3">
                  <span className="rounded bg-black/45 px-2 py-1 text-[11px] font-semibold uppercase">
                    {copy.professionalAgentReviewAfter}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <aside
          className="h-screen overflow-hidden border-l border-editor-border bg-editor-panel"
          data-visual-smoke-section="professional-agent-review-workspace-panel"
          style={{ width: '360px' }}
        >
          <AgentPanel />
        </aside>
      </div>
    </main>
  );
}

const filmstripFrames = [
  { name: 'DSC_1042.ARW', tone: 'from-emerald-400 to-cyan-500', rating: '5' },
  { name: 'DSC_1043.ARW', tone: 'from-amber-300 to-rose-500', rating: '4' },
  { name: 'DSC_1044.ARW', tone: 'from-sky-300 to-violet-500', rating: '3' },
] as const;

const adjustmentGroups = [
  { label: 'Exposure', value: '+0.35', width: '64%' },
  { label: 'Contrast', value: '+12', width: '58%' },
  { label: 'Color Balance', value: 'warm', width: '72%' },
  { label: 'Film Grain', value: '18', width: '46%' },
] as const;

const filmLookParityProofCases = [
  {
    displayName: 'Warm Print',
    maxDelta: '0',
    previewHash: '9a605fdfa6fd53a9',
  },
  {
    displayName: 'Mono Silver',
    maxDelta: '0',
    previewHash: '7e4b525fd7be754b',
  },
  {
    displayName: 'Punch Color',
    maxDelta: '0',
    previewHash: '942aa1199eb4a1d3',
  },
] as const;
interface LayerWorkflowState {
  blend: LayerWorkflowBlendMode;
  groupId?: string;
  groupName?: string;
  mask: string;
  name: string;
  opacity: number;
  visible: boolean;
}

const layerWorkflowSupportedBlendModes = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft_light',
  'hue',
  'saturation',
] as const;
type LayerWorkflowBlendMode = (typeof layerWorkflowSupportedBlendModes)[number];

const layerWorkflowFallbackLayer: LayerWorkflowState = {
  blend: 'soft_light',
  mask: 'Sky gradient',
  name: 'Sky recovery',
  opacity: 72,
  visible: true,
};
const layerWorkflowInitialStack = [
  { ...layerWorkflowFallbackLayer, groupId: 'group_local_polish', groupName: 'Local polish' },
  {
    blend: 'multiply',
    groupId: 'group_local_polish',
    groupName: 'Local polish',
    mask: 'Subject brush',
    name: 'Portrait burn',
    opacity: 42,
    visible: true,
  },
  { blend: 'screen', mask: 'Window radial', name: 'Window lift', opacity: 36, visible: true },
] satisfies LayerWorkflowState[];
const FILM_LOOK_PARITY_TITLE = 'Rendered parity proof';
const FILM_LOOK_PARITY_FIXTURE_LABEL = 'Synthetic fixture';
const NEGATIVE_LAB_NO_SAVED_PATHS_LABEL = 'No saved positives yet';
const NEGATIVE_LAB_PUBLIC_EXPORT_REVIEW_TITLE = 'Public negative export review';
const NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_LABEL = 'CC0 scan input';
const NEGATIVE_LAB_PUBLIC_EXPORT_OUTPUT_LABEL = 'Rendered positive proof';
const NEGATIVE_LAB_PUBLIC_EXPORT_HANDOFF_LABEL = 'JPEG export handoff';
const NEGATIVE_LAB_PUBLIC_EXPORT_RUNTIME_LABEL = 'Runtime';
const NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_PATH_LABEL = 'Source';
const NEGATIVE_LAB_PUBLIC_EXPORT_PROFILE_LABEL = 'Applied profile';
const NEGATIVE_LAB_PUBLIC_EXPORT_PROFILE_CLAIM_POLICY_LABEL = 'Claim policy';
const NEGATIVE_LAB_REAL_RAW_PRIVATE_REVIEW_TITLE = 'Private RAW negative review';
const NEGATIVE_LAB_REAL_RAW_PRIVATE_OUTPUT_LABEL = 'Private RAW positive proof';
const NEGATIVE_LAB_REAL_RAW_PRIVATE_METRICS_LABEL = 'Runtime metrics';
const NEGATIVE_LAB_REAL_RAW_PRIVATE_CHANGED_PIXELS_LABEL = 'Changed pixels';
const NEGATIVE_LAB_REAL_RAW_PRIVATE_MEAN_DELTA_LABEL = 'Mean delta';
const formatFilmLookParityDelta = (maxDelta: string) => `Delta ${maxDelta}`;
const formatLayerBlend = (blend: string) => blend.replace('_', ' ');
const libraryWorkflowAssets = [
  { color: 'green', file: 'DSC_0001.NEF', rating: 5, status: 'Keeper', tone: 'from-[#6cbf84] to-[#d9b26f]' },
  { color: 'green', file: 'DSC_0002.NEF', rating: 4, status: 'Client pick', tone: 'from-[#4f86c6] to-[#c7d8ff]' },
  { color: 'yellow', file: 'DSC_0003.NEF', rating: 3, status: 'Maybe', tone: 'from-[#d7a84f] to-[#8d6b46]' },
] as const;
const detailReviewBands = [
  { label: 'Fine', value: '+18', width: '72%' },
  { label: 'Medium', value: '+9', width: '54%' },
  { label: 'Coarse', value: '-4', width: '36%' },
] as const;
const detailReviewStages = [
  'scene_linear_denoise',
  'scene_linear_deblur',
  'capture_sharpen',
  'wavelet_luma_detail',
] as const;
const detailOutputComparisonFrames = [
  { label: 'Original', marker: 'source RAW', tone: 'linear-gradient(135deg, #3b4650, #626862, #ad9566)' },
  { label: 'Current', marker: 'baseline render', tone: 'linear-gradient(135deg, #3a4852, #6a7169, #bda976)' },
  { label: 'Recipe', marker: 'denoise + detail', tone: 'linear-gradient(135deg, #33434d, #758579, #d3c18b)' },
] as const;
const detailOutputComparisonMetrics = {
  changedPixelRatio: '92.6%',
  currentToRecipeDelta: '0.015477',
  recipeToExportDelta: '0.000000',
} as const;
const maskOverlayRawProofSourcePath = 'private-fixtures/detail/high-iso-skin-shadow-v1.arw';
const maskOverlayRawProofCopy = {
  fixtureLabel: 'private RAW fixture',
  fixtureTitle: 'High ISO skin shadow mask',
  proofState: 'Proof state',
  runtimeBadge: 'live mask overlay generator',
  runtimeStatus: 'Runtime status: visual smoke RAW overlay control proof',
  title: 'RAW Mask Overlay Review',
} as const;
const formatMaskOverlayProofState = (mode: string, opacity: number, edgeThreshold: number) =>
  `${mode} / opacity ${Math.round(opacity * 100)}% / edge ${Math.round(edgeThreshold * 100)}%`;

function MaskOverlayRawProofVisualSmoke() {
  const [settings, setSettings] = useState<MaskOverlaySettings>({
    edgeThreshold: 0.5,
    mode: 'rubylith',
    opacity: 0.5,
  });
  const [hiddenToggled, setHiddenToggled] = useState(false);
  const overlayEnabled = settings.mode !== 'hidden';
  const proofMode = overlayEnabled ? settings.mode : 'hidden';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.MaskOverlayRawProof}
    >
      <div className="grid h-screen grid-cols-[1fr_380px] overflow-hidden">
        <section className="relative bg-[#0f1114] p-8" data-visual-smoke-section="raw-overlay-preview">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{maskOverlayRawProofCopy.fixtureLabel}</p>
              <h1 className="text-lg font-semibold">{maskOverlayRawProofCopy.title}</h1>
              <p className="mt-1 text-xs text-[#8d97a3]">{maskOverlayRawProofCopy.fixtureTitle}</p>
            </div>
            <span className="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#cbd5df]">
              {maskOverlayRawProofCopy.runtimeBadge}
            </span>
          </div>
          <div className="relative h-[calc(100%-4rem)] overflow-hidden rounded-md border border-white/10 bg-linear-to-br from-[#1c2830] via-[#584038] to-[#d0a56c]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_55%_42%,rgba(255,222,180,0.5),transparent_18%),linear-gradient(135deg,rgba(54,95,112,0.55),rgba(98,69,65,0.35))]" />
            {overlayEnabled && (
              <div
                className="absolute inset-0"
                style={{
                  background:
                    proofMode === 'edges'
                      ? `repeating-linear-gradient(45deg, rgba(255,255,255,${settings.edgeThreshold}), rgba(255,255,255,${settings.edgeThreshold}) 2px, transparent 2px, transparent 14px)`
                      : `rgba(244,63,94,${settings.opacity})`,
                  opacity: proofMode === 'edges' ? settings.opacity : 1,
                }}
              />
            )}
            <div className="absolute bottom-8 left-8 rounded border border-white/10 bg-black/35 px-3 py-2 text-xs text-[#d8dee8]">
              {maskOverlayRawProofSourcePath}
            </div>
          </div>
        </section>

        <aside className="border-l border-white/10 bg-[#15181c] p-4" data-visual-smoke-section="raw-overlay-controls">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">{maskOverlayRawProofCopy.runtimeBadge}</h2>
            <p className="mt-1 text-xs text-[#8d97a3]">{maskOverlayRawProofCopy.runtimeStatus}</p>
          </div>
          <MaskOverlayReviewControls
            settings={settings}
            onChange={(nextSettings) => {
              if (settings.mode !== 'hidden' && nextSettings.mode === 'hidden') setHiddenToggled(true);
              setSettings(nextSettings);
            }}
            onDragStateChange={() => {}}
          />
          <div
            className="mt-4 rounded-md border border-white/10 bg-[#1b2026] p-3 text-xs"
            data-edge-threshold={settings.edgeThreshold.toFixed(2)}
            data-hidden-toggled={String(hiddenToggled)}
            data-mode={proofMode}
            data-opacity={settings.opacity.toFixed(2)}
            data-overlay-source="live_mask_overlay_generator"
            data-source-kind="source_raw_private"
            data-source-path={maskOverlayRawProofSourcePath}
            data-testid="mask-overlay-raw-proof"
            data-validation-mode="visual_smoke_raw_overlay_control_proof"
          >
            <p className="text-[#8d97a3]">{maskOverlayRawProofCopy.proofState}</p>
            <p className="mt-1 text-[#f3f4f1]">
              {formatMaskOverlayProofState(proofMode, settings.opacity, settings.edgeThreshold)}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function DetailDustSpotVisualSmoke() {
  const [adjustments, setAdjustments] = useState<Adjustments>(INITIAL_ADJUSTMENTS);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.DetailDustSpot}
    >
      <div className="grid h-screen grid-cols-[420px_1fr] overflow-hidden">
        <aside
          className="overflow-y-auto border-r border-white/10 bg-[#15181c] p-4"
          data-visual-smoke-section="dust-controls"
        >
          <DetailsPanel
            adjustments={adjustments}
            appSettings={null}
            setAdjustments={(update) => {
              setAdjustments((currentAdjustments) =>
                typeof update === 'function' ? update(currentAdjustments) : { ...currentAdjustments, ...update },
              );
            }}
          />
        </aside>
        <section className="bg-[#0f1114] p-8" data-visual-smoke-section="dust-proof">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{copy.dustSpotVisualization}</p>
              <h1 className="text-lg font-semibold">{copy.dustOverlayInteractionProof}</h1>
            </div>
            <span className="rounded border border-white/10 bg-white/5 px-3 py-1 text-sm">
              {copy.dustUiOverlayContract}
            </span>
          </div>
          <div
            className="relative h-[640px] overflow-hidden rounded-md border border-white/10 bg-linear-to-br from-[#39434a] via-[#69675f] to-[#c3a76f]"
            data-min-radius={String(adjustments.dustSpotMinRadiusPx)}
            data-overlay-enabled={String(adjustments.dustSpotOverlayEnabled)}
            data-sensitivity={String(adjustments.dustSpotSensitivity)}
            data-testid="detail-dust-spot-proof"
          >
            {[14, 27, 43, 58, 72, 83].map((left, index) => (
              <span
                className={`absolute rounded-full border ${
                  adjustments.dustSpotOverlayEnabled
                    ? 'border-editor-danger bg-editor-danger-surface shadow-[0_0_18px_var(--editor-danger-surface)]'
                    : 'border-white/10 bg-white/5'
                }`}
                key={left}
                style={{
                  height: `${Math.max(8, adjustments.dustSpotMinRadiusPx * 6 + index)}px`,
                  left: `${left}%`,
                  top: `${18 + ((index * 11) % 62)}%`,
                  width: `${Math.max(8, adjustments.dustSpotMinRadiusPx * 6 + index)}px`,
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

const copy = {
  brand: 'RapidRAW',
  harness: 'Visual smoke harness',
  library: 'Library',
  importReady: 'Import ready',
  importDescription: 'Startup shell, library navigation, and status surfaces are visible without Tauri APIs.',
  editorPreview: 'Editor Preview',
  editorDescription: 'Browser-safe component story for render capture.',
  screenshotTarget: 'macOS screenshot target',
  adjustments: 'Adjustments',
  layerStack: 'Layer stack',
  activeLayerCount: '3 active',
  brushMaskCanvasUi: 'Brush mask canvas UI',
  brushFeather64: 'Feather 64',
  brushSize96: 'Size 96',
  pointCounts: 'Point counts',
  runtimeProof: 'Runtime proof',
  runtimeOverlay: 'runtime overlay',
  professionalCanvasActiveStates: 'active states',
  professionalCanvasOverlays: 'Professional canvas overlays',
  professionalCanvasProofStatus: 'Proof status',
  professionalCropTransformWorkspace: 'Professional crop transform workspace',
  strokeCount: (count: number) => `${count} strokes`,
  toolOrder: 'Tool order',
  commandPaletteSmoke: 'Command Palette Workflows',
  commandPaletteSelectSource: 'Select source',
  cullingCompareSync: 'Culling compare sync',
  lensCorrectionSession: 'Lens correction session',
  filmLook: 'Film look',
  filmPreset: 'Neutral 400',
  colorRangeLocalAdjustment: 'Color Range Local Adjustment',
  colorRangeWorkspaceLabel: 'Color workspace',
  colorRangeLayerSummary: 'Layer: Oranges local adjustment',
  colorRangeAdjustmentSummary: 'Adjustment: saturation +18, exposure +0.18',
  colorRangeOverlayLabel: 'Overlay:',
  colorRangeOverlayCoverageSuffix: '% proposal coverage',
  colorRangeReceiptTitle: 'Range mask receipt',
  colorRangeReplayReady: 'Replay ready',
  editorParityAdjust: 'Adjust',
  editorParityCatalog: 'Catalog',
  editorParityCoarsePointerTarget: 'Coarse pointer tool target',
  editorParityCollapsedFilmstrip: 'Collapsed filmstrip',
  editorParityCollapsedLeftPanel: 'Collapsed left panel',
  editorParityCollapsedRightPanel: 'Collapsed right panel',
  editorParityColor: 'Color',
  editorParityContractTitle: 'Editor parity contract',
  editorParityDark: 'Dark',
  editorParityDefault: 'Default',
  editorParityDesktopMatrix: '1224 / 1440 desktop matrix',
  editorParityDevelop: 'Develop',
  editorParityDisabledControl: 'Disabled control',
  editorParityEdited: 'Edited',
  editorParityExposure: 'Exposure',
  editorParityFilmstrip: 'Filmstrip',
  editorParityFit: 'Fit',
  editorParityFullSize: '100%',
  editorParityKeyboardFocus: 'Keyboard focus example',
  editorParityLight: 'Light',
  editorParityLoadingImage: 'Loading',
  editorParityNoImage: 'No image',
  editorParityProofWarning: 'Proof warning',
  editorParityReadyImage: 'Ready image',
  editorParityRenderFailed: 'Render failed',
  editorParityReview: 'Review',
  editorParitySaturation: 'Saturation',
  editorParityTools: 'Editor tools',
  editorParityViewerZoom: 'Viewer: Fit / 100%',
  editorParityWorkflow: 'Workflow',
  professionalEditorTokens: 'Professional editor tokens',
  professionalEditorShell: 'Professional editor shell',
  professionalEditorToolbar: 'Professional editor toolbar',
  professionalEditorToolbarDisabled: 'disabled',
  professionalExportProofFooter: 'Export proof footer',
  professionalAgentReview: 'Professional agent review',
  professionalAgentReviewAfter: 'After',
  professionalAgentReviewBefore: 'Before',
  professionalAgentReviewMediumPreview: 'medium preview',
  professionalAgentReviewProposal: 'Reviewable edit proposal',
  professionalAgentReviewWorkspace: 'Professional agent review workspace',
  exportFooterIdle: 'idle',
  exportFooterRunning: 'running',
  exportFooterRetry: 'retry',
  professionalEditorToolbarFullscreen: 'Fullscreen',
  professionalEditorToolbarHistory: 'History',
  professionalEditorToolbarNegativeLab: 'Negative Lab',
  professionalEditorToolbarOriginalCompare: 'Original compare',
  professionalEditorCompactPortrait: 'Professional editor compact portrait',
  professionalEditorMatte: 'matte',
  professionalEditorModeRail: 'Editor mode rail',
  professionalEditorAdjust: 'Adjust',
  professionalEditorAi: 'AI',
  professionalEditorApply: 'Apply',
  professionalEditorHover: 'Hover',
  professionalEditorActive: 'Active',
  professionalEditorControlStates: 'Control states',
  professionalEditorCompact: 'compact',
  professionalEditorFocus: 'focus',
  professionalEditorPreviewReady: 'RAW preview ready',
  professionalEditorReset: 'Reset',
  professionalEditorDisabled: 'Disabled',
  professionalEditorLoading: 'Loading',
  professionalEditorCompactRow: 'Compact inspector row',
  professionalEditorActions: 'Inspector actions',
  professionalEditorCopySettings: 'Copy settings',
  professionalEditorReady: 'ready',
  professionalEditorRailSize: '42 px rail',
  professionalEditorResetInspector: 'Reset inspector',
  professionalEditorSoftProof: 'soft proof',
  professionalEditorValidationError: 'Value must remain within the selected profile range.',
  focusStackSmoke: 'Focus Stack Smoke',
  focusReview: 'Focus review',
  focusDryRunPreview: 'Dry-run preview',
  focusArtifactHandoff: 'Artifact handoff',
  focusApplyTool: getComputationalMergeAppServerRoutePairSummary('focus_stack').applyToolName,
  focusDryRunTool: getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName,
  focusArtifactPath: '/tmp/rawengine-focus-stack-smoke.tif',
  focusDepthMap: 'Depth map',
  focusPrivateRawReview: 'Private RAW focus review',
  focusPrivateRawModalReview: 'Private RAW focus modal review',
  focusPrivateRawRuntime: 'app-server apply proof',
  focusPrivateRawPreview: 'RAW preview',
  focusPrivateRawResult: 'Result review',
  focusPrivateRawExport: 'Export review',
  focusPrivateRawSourceSet: 'focus bracket',
  hdrPrivateRawReview: 'Private RAW HDR review',
  hdrPrivateRawRuntime: 'Private RAW',
  hdrPrivateRawBefore: 'Middle bracket preview',
  hdrPrivateRawAfter: 'Merged result review',
  hdrPrivateRawEditorHandoff: 'Private RAW HDR editor handoff',
  hdrPrivateRawPreview: 'Tone-mapped preview',
  panoramaSmoke: 'Panorama UI Smoke',
  panoramaReview: 'Panorama review',
  panoramaSavedReview: 'Panorama saved review',
  panoramaDryRunCommand: 'Panorama dry-run command',
  panoramaDryRunPreview: 'Dry-run preview',
  panoramaArtifactHandoff: 'Artifact handoff',
  panoramaPrivateRawMissing: 'Missing panorama private RAW proof payload',
  panoramaPrivateRawReview: 'Private RAW panorama review',
  panoramaPrivateRawRuntime: 'Private RAW',
  panoramaPrivateRawResultAlt: 'Panorama private RAW stitched result review',
  panoramaPrivateRawPreviewAlt: 'Panorama private RAW preview',
  panoramaPrivateRawExportAlt: 'Panorama private RAW export review',
  panoramaApplyTool: getComputationalMergeAppServerRoutePairSummary('panorama').applyToolName,
  panoramaDryRunTool: getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName,
  panoramaArtifactPath: '/tmp/panorama.tif',
  panoramaSourceOrder: 'left,center,right,detail,sky',
  superResolutionSmoke: 'Super Resolution Smoke',
  superResolutionReview: 'Super-resolution review',
  superResolutionDryRunPreview: 'Dry-run preview',
  superResolutionArtifactHandoff: 'Artifact handoff',
  superResolutionApplyTool: getComputationalMergeAppServerRoutePairSummary('super_resolution').applyToolName,
  superResolutionDryRunTool: getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName,
  superResolutionArtifactPath: '/tmp/rawengine-super-resolution-smoke.tif',
  superResolutionSourceSet: 'handheld burst x5',
  superResolutionPrivateRawReview: 'Private RAW SR review',
  superResolutionPrivateRawRuntime: 'app-server apply proof',
  superResolutionPrivateRawPreview: 'RAW preview',
  superResolutionPrivateRawResult: 'Result review',
  superResolutionPrivateRawExport: 'Export review',
  missingPrivateRawProofArtifacts: 'Missing private RAW proof artifacts',
  privateRawFrameCount: (count: string) => `${count} RAW frames`,
  colorWorkflow: 'Color Workflow',
  colorBalanceCompare: 'Color balance compare',
  colorBalanceCommandSummary: 'Midtone red/blue balance, preserve luminance',
  colorBefore: 'Before',
  colorAfter: 'After',
  colorGamutWarning: 'No gamut clipping',
  colorCompareReset: 'Reset available',
  cameraProfilePreview: 'Camera profile',
  cameraProfileInputRgb: 'Input camera RGB',
  cameraProfileWorkingRgb: 'Working RGB',
  blackWhiteParity: 'Black & white parity',
  blackWhiteCommandSummary: 'toneColor.setBlackWhiteMixer',
  previewRgb: 'Preview RGB',
  exportRgb: 'Export RGB',
  layerWorkflowTitle: 'Local Adjustment Stack',
  layerMoveDown: 'Move down',
  layerToggle: 'Toggle',
  layerAdd: 'Add layer',
  layerDuplicate: 'Duplicate layer',
  layerRenameProof: 'Rename proof',
  layerOpacity64: 'Opacity 64%',
  layerBlendOverlay: 'Blend overlay',
  layerCopyMask: 'Copy mask',
  layerCollapseGroup: 'Collapse group',
  layerCreateGroup: 'Create group',
  layerGroupCount: (count: number) => `${count} layers`,
  layerGroupingActive: 'Group Local polish / {{count}} layers',
  layerLocalPolish: 'Local polish',
  layeredPreview: 'Layered preview',
  layerWorkflowDescription: 'Mask, blend, opacity, and order state captured in one smoke path.',
  layerVisibleCount: (count: number) => `${count} visible`,
  layerRuntimeEvidence: 'Runtime evidence',
  layerBrushCommandType: 'layerMask.createBrushMask',
  layerBrushLocalAdjustment: 'Brush Local Adjustment',
  layerBrushLocalCommandFlow: 'typed layer command flow',
  layerBrushLocalGraphLabel: 'Graph',
  layerBrushLocalGraphValue: 'rollback layer_brush_local_initial',
  layerBrushLocalLayerLabel: 'Layer',
  layerBrushLocalLayerValue: 'Brush Local Adjustment 1',
  layerBrushLocalMaskLabel: 'Brush mask',
  layerBrushLocalMaskValue: '2 strokes / rubylith overlay',
  layerBrushLocalReceipt: 'Receipt',
  layerBrushLocalReplayLabel: 'Replay',
  layerBrushLocalReplayReady: 'undo/replay ready',
  layerBrushLocalReplayValue: 'create layer -> brush mask -> scoped tone',
  layerBrushLocalToneSummary: 'Local exposure +0.35 / shadows +16 / contrast +14',
  layerMaskPrivateRawReview: 'Private RAW layer mask review',
  layerMaskPrivateRawRuntime: 'Private RAW runtime',
  layerMaskPrivateRawUnmasked: 'Unmasked RAW preview',
  layerMaskPrivateRawUnrefined: 'Unrefined mask preview',
  layerMaskPrivateRawRefined: 'Refined mask preview',
  layerMaskPrivateRawExport: 'TIFF export handoff',
  layerMaskPrivateRawChangedPixels: 'Changed pixels',
  layerMaskPrivateRawMetricCount: (count: string) => `${count} metrics`,
  layerMaskPrivateRawStaleInvalidation: 'Stale invalidation',
  objectPromptBoxReady: 'Box ready',
  objectPromptClear: 'Clear',
  objectPromptControlsTitle: 'Object prompt masks',
  objectPromptEditableLayer: 'Editable mask layer',
  objectPromptGenerate: 'Generate mask',
  objectPromptModeBackground: 'Background',
  objectPromptModeBox: 'Box',
  objectPromptModeForeground: 'Foreground',
  objectPromptProposal: 'SAM proposal',
  objectPromptOverlayOpacityPercent: '72%',
  objectPromptVisualProof: 'Object prompt visual proof',
  professionalLayersActiveCount: '4 active',
  professionalLayersAdjustmentLabels: ['Exposure +0.35', 'Contrast +14', 'Color range ready'],
  professionalLayersAssistedMaskStates: 'Assisted mask states',
  professionalLayersCompact: 'Professional layers compact',
  professionalLayersDisabled: 'disabled',
  professionalLayersDustRemove: 'Dust remove',
  professionalLayersError: 'error',
  professionalLayersLoading: 'loading',
  professionalLayersLocalAdjustment: 'Local adjustment',
  professionalLayersMaskComponents: 'Mask components',
  professionalLayersReady: 'ready',
  professionalLayersStale: 'stale',
  professionalLayersTitle: 'Layers',
  selectedLayer: 'Selected layer',
  maskBlendOpacity: 'Mask / blend / opacity',
  comparePreviewExport: 'Compare preview/export',
  previewExportParity: 'Preview/export parity',
  readyForHeadlessReplay: 'Ready for headless replay',
  pending: 'Pending',
  frameStatus: (rating: string) => `Rating ${rating} / RAW / edited`,
  cullSession: 'Cull Session',
  weddingKeepers: 'Wedding keepers',
  libraryKeepers: 'Keepers',
  libraryKeepersCriteria: '4+ / green',
  librarySurvey: 'Survey',
  createBwProofCopy: 'Create B&W proof copy',
  editSelectedPick: 'Edit selected pick',
  editorHandoffReady: 'Editor handoff ready',
  exportQueued: 'Export queued',
  exportSelectedPick: 'Queue selected export',
  compareReady: 'A/B compare ready',
  compareSource: 'Source',
  compareSourceFile: 'DSC_0002.NEF',
  compareSourceProof: 'Exposure +0.15 / color sidecar',
  compareVariant: 'Virtual copy',
  compareVariantFile: 'DSC_0002.NEF / VC',
  compareVariantProof: 'Exposure -0.30 / B&W sidecar',
  compareVirtualCopy: 'Compare virtual copy',
  virtualCopyShort: 'VC',
  hdrReview: 'HDR review',
  hdrSavedOutputEditorPath: 'HDR saved output editor path',
  negativeLabEditorLayerHandoff: 'Negative Lab editor handoff',
  negativeLabEditablePositive: 'Editable positive',
  negativeLabLayer: 'Layer',
  negativeLabOpacity: 'Opacity',
  negativeLabProvenance: 'Provenance',
  negativeLabReport: 'Report',
  negativeLabRoll: 'Roll',
  negativeLabSource: 'Source',
  hdrDryRunPreview: 'Dry-run preview',
  hdrArtifactHandoff: 'Artifact handoff',
  hdrApplyTool: getComputationalMergeAppServerRoutePairSummary('hdr').applyToolName,
  hdrDryRunTool: getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName,
  hdrArtifactPath: '/tmp/rawengine-hdr-smoke.tif',
  hdrSourceSet: 'HDR bracket',
  libraryRating: (rating: number) => `Rating ${rating}`,
  libraryStars: (rating: number) => `${rating} stars`,
  libraryStackBadge: (kind: string, count: number) => `${kind} ${count}`,
  libraryStackCollapsed: 'Auto stack collapsed',
  libraryStackExpanded: 'Auto stack expanded',
  libraryStackToggle: 'Toggle burst stack',
  libraryColorLabel: (label: string) => `Color label ${label}`,
  selectionState: 'Selection State',
  filter: 'Filter',
  virtualCopy: 'Virtual copy',
  repeatableProof: 'Repeatable proof',
  editorHandoff: 'Editor handoff',
  exportQueue: 'Export queue',
  allSessionFiles: 'All session files',
  editorHandoffSummary: 'DSC_0002.NEF opened in editor with survey selection context.',
  exportQueueSummary: '1 queued / TIFF 16-bit / current edit state',
  keeperFilterSummary: 'Keepers: rating 4+, green label',
  replayProofSummary: 'Fixture cull, filter, survey, and virtual-copy state are captured in one replay.',
  selectedCount: (count: number) => `${count} selected`,
  detailReview: 'Detail Review',
  detailWorkspace: 'Zoom detail workspace',
  detailRuntimeStatus: 'Fixture runtime paths',
  dustOverlayInteractionProof: 'Overlay interaction proof',
  dustSpotVisualization: 'Dust Spot Visualization',
  dustUiOverlayContract: 'UI overlay contract',
  detailZoom100: '100% crop',
  splitCompare: 'Split compare',
  lumaDetail: 'Luma detail',
  applyDetailRecipe: 'Apply recipe',
  detailBefore: 'Before',
  detailAfter: 'After',
  detailCurrent: 'Current',
  detailCurrentRecipeDelta: 'Current/recipe delta',
  detailExportArtifact: 'Export artifact',
  detailOriginal: 'Original',
  detailOutputComparison: 'Denoise + detail output compare',
  detailDeblurControl: 'Deblur strength',
  detailDenoiseControl: 'Denoise luma',
  detailRecipe: 'Recipe',
  detailRecipeChangedPixels: 'Changed pixels',
  detailRecipeExportHash: 'Recipe export hash differs from disabled',
  detailRecipeExportParity: 'Recipe preview/export delta 0.000000',
  detailWavelet: 'Wavelet',
  detailWarningTitle: 'Artifact warning',
  detailRingingReview: 'Ringing review',
  detailDryRunTool: 'detail.deblur.dry_run_command',
  detailStageOrder: 'Stage order',
  detailProofSummary: '100% crop, split comparison, warning, recipe apply, and export artifact state are captured.',
} as const;

const scopes = [
  ['Luma', '71'],
  ['R', '64'],
  ['G', '69'],
  ['B', '73'],
] as const;

function DetailWorkspaceVisualSmoke() {
  const [deblurStrength, setDeblurStrength] = useState(0);
  const [denoiseLuma, setDenoiseLuma] = useState(0);
  const [zoom, setZoom] = useState('100');
  const [previewMode, setPreviewMode] = useState<'single' | 'split'>('single');
  const [waveletMode, setWaveletMode] = useState<'off' | 'luma_detail'>('off');
  const [recipeApplied, setRecipeApplied] = useState(false);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.DetailWorkspace}
    >
      <div className="grid h-screen grid-cols-[300px_1fr_360px] overflow-hidden">
        <aside className="border-r border-white/10 bg-[#15181c] p-4" data-visual-smoke-section="detail-controls">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold">{copy.detailReview}</h1>
              <p className="text-xs text-[#9ba6b2]">{copy.detailRuntimeStatus}</p>
            </div>
            <SlidersHorizontal size={18} className="text-[#6da7d8]" />
          </div>
          <div
            className="space-y-3"
            data-artifact-warning="ringing_review"
            data-comparison-mode={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.comparisonMode}
            data-crop-clipped={String(DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.cropClipped)}
            data-crop-zoom-percent={String(DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.cropZoomPercent)}
            data-deblur-command={copy.detailDryRunTool}
            data-deblur-enabled={String(deblurStrength > 0)}
            data-deblur-strength={deblurStrength}
            data-denoise-luma={denoiseLuma}
            data-denoise-stage="scene_linear_denoise"
            data-export-artifact-path={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.exportArtifactPath}
            data-fixture-id={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.fixtureId}
            data-preview-mode={previewMode}
            data-recipe-applied={String(recipeApplied)}
            data-recipe-id={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.recipeId}
            data-render-fallback={String(DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.renderFallback)}
            data-runtime-status={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.runtimeStatus}
            data-testid="detail-workspace-proof"
            data-wavelet-mode={waveletMode}
            data-warning-codes={DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.warningCodes.join(',')}
            data-zoom={zoom}
          >
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setZoom('100');
              }}
              type="button"
            >
              <span>{copy.detailZoom100}</span>
              <span className="text-xs text-[#aab2bd]">{zoom}%</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setPreviewMode('split');
              }}
              type="button"
            >
              <span>{copy.splitCompare}</span>
              <span className="text-xs text-[#aab2bd]">{previewMode}</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setDenoiseLuma(58);
              }}
              type="button"
            >
              <span>{copy.detailDenoiseControl}</span>
              <span className="text-xs text-[#aab2bd]">{denoiseLuma}%</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setDeblurStrength(70);
              }}
              type="button"
            >
              <span>{copy.detailDeblurControl}</span>
              <span className="text-xs text-[#aab2bd]">{deblurStrength}%</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#6da7d8]/40 bg-[#1d2b35] px-3 py-2 text-left text-sm hover:bg-[#243746]"
              onClick={() => {
                setDeblurStrength(70);
                setDenoiseLuma(58);
                setWaveletMode('luma_detail');
                setRecipeApplied(true);
              }}
              type="button"
            >
              <span>{copy.applyDetailRecipe}</span>
              <Sparkles size={14} className="text-[#9ac5eb]" />
            </button>
          </div>
        </aside>
        <section className="min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="detail-preview">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{copy.detailWorkspace}</p>
              <h2 className="text-lg font-semibold">{copy.detailOutputComparison}</h2>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-3 py-1 text-sm">{zoom}%</div>
          </div>
          <div className="grid h-[680px] grid-cols-3 gap-3 overflow-hidden rounded-md border border-white/10 bg-[#11161b] p-3">
            {detailOutputComparisonFrames.map((frame, index) => (
              <div className="relative overflow-hidden rounded" key={frame.label} style={{ background: frame.tone }}>
                <div className="absolute left-4 top-4 rounded bg-black/50 px-2 py-1 text-xs text-white">
                  {frame.label}
                </div>
                <div className="absolute right-4 top-4 rounded bg-black/45 px-2 py-1 text-[11px] text-white/80">
                  {frame.marker}
                </div>
                <div
                  className="absolute inset-x-8 top-28 h-px bg-white/55"
                  style={{ opacity: index === 2 && recipeApplied ? 0.85 : 0.45 }}
                />
                <div
                  className="absolute inset-y-24 left-28 w-px bg-white/45"
                  style={{ opacity: index === 2 && recipeApplied ? 0.7 : 0.36 }}
                />
                <div className="absolute bottom-8 left-8 right-8 h-20 rounded bg-black/20" />
                {index === 2 && recipeApplied && (
                  <div className="absolute bottom-8 right-8 rounded border border-[#6da7d8]/50 bg-[#162632]/85 px-2 py-1 text-xs text-[#d4ecff]">
                    {copy.detailRecipe}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#181b20] p-4" data-visual-smoke-section="detail-review">
          <h2 className="mb-4 text-sm font-semibold">{copy.detailStageOrder}</h2>
          <div className="space-y-3 text-sm">
            {detailReviewStages.map((stage) => (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2" key={stage}>
                {stage}
              </div>
            ))}
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="mb-2 text-xs text-[#9ba6b2]">{copy.detailWavelet}</p>
              {detailReviewBands.map((band) => (
                <div className="mb-2" key={band.label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{band.label}</span>
                    <span>{band.value}</span>
                  </div>
                  <div className="h-1.5 rounded bg-white/10">
                    <div className="h-1.5 rounded" style={{ backgroundColor: '#6da7d8', width: band.width }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-[#d8a24d]/40 bg-[#2c2418] p-3" data-testid="detail-warning">
              <p className="text-xs text-[#d8b36f]">{copy.detailWarningTitle}</p>
              <p>{copy.detailRingingReview}</p>
              <p className="mt-1 text-xs text-[#d8b36f]">
                {DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.warningCodes.join(' / ')}
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[#9ba6b2]">{copy.detailExportArtifact}</p>
              <p className="break-all text-xs">{DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF.exportArtifactPath}</p>
              <p className="mt-2 text-xs text-[#9ba6b2]">{copy.detailRecipeExportHash}</p>
              <p className="text-xs">{copy.detailRecipeExportParity}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs">
              <p>{copy.detailProofSummary}</p>
              <p className="mt-2 text-[#9ba6b2]">
                {copy.detailCurrentRecipeDelta} {detailOutputComparisonMetrics.currentToRecipeDelta}
              </p>
              <p className="text-[#9ba6b2]">
                {copy.detailRecipeChangedPixels} {detailOutputComparisonMetrics.changedPixelRatio}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LibraryWorkflowVisualSmoke() {
  const [filterMode, setFilterMode] = useState<'all' | 'keepers'>('all');
  const [isAutoStackExpanded, setIsAutoStackExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'compare' | 'survey'>('compare');
  const [virtualCopyId, setVirtualCopyId] = useState('pending');
  const [isCompareReady, setIsCompareReady] = useState(false);
  const [openedEditorPath, setOpenedEditorPath] = useState('');
  const [queuedExportId, setQueuedExportId] = useState('');
  const visibleAssets =
    filterMode === 'keepers' ? libraryWorkflowAssets.filter((asset) => asset.rating >= 4) : libraryWorkflowAssets;
  const activeAsset = libraryWorkflowAssets[1];
  const selectedCount = visibleAssets.filter((asset) => asset.rating >= 4).length;
  const editorHandoffReady = openedEditorPath === '/proof-roll/DSC_0002.NEF';
  const exportQueued = queuedExportId === 'export-dsc-0002-current-edit-tiff16';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LibraryWorkflow}
    >
      <div className="grid h-screen grid-cols-[300px_1fr_360px] overflow-hidden">
        <aside className="border-r border-white/10 bg-[#16191d] p-4" data-visual-smoke-section="library-filters">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold">{copy.cullSession}</h1>
              <p className="text-xs text-[#9ba6b2]">{copy.weddingKeepers}</p>
            </div>
            <FolderOpen size={18} className="text-[#d7a84f]" />
          </div>
          <div
            className="space-y-3"
            data-active-asset={activeAsset.file}
            data-color-label={activeAsset.color}
            data-filter-mode={filterMode}
            data-opened-editor-path={openedEditorPath}
            data-minimum-rating={filterMode === 'keepers' ? '4' : '0'}
            data-auto-stack-expanded={String(isAutoStackExpanded)}
            data-auto-stack-kind="burst"
            data-auto-stack-visible-count={String(isAutoStackExpanded ? 3 : 1)}
            data-queued-export-id={queuedExportId}
            data-selected-count={String(selectedCount)}
            data-sidecar-separation={isCompareReady ? 'independent' : 'pending'}
            data-survey-pick-export-queued={String(exportQueued)}
            data-survey-pick-opened-editor={String(editorHandoffReady)}
            data-testid="library-workflow-proof"
            data-view-mode={viewMode}
            data-virtual-compare-ready={isCompareReady ? 'true' : 'false'}
            data-virtual-copy-id={virtualCopyId}
            data-virtual-copy-source-path="/proof-roll/DSC_0002.NEF"
            data-virtual-copy-variant-path="/proof-roll/DSC_0002.NEF?vc=vc-dsc-0002-bw-proof"
          >
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setFilterMode('keepers');
              }}
              type="button"
            >
              <span>{copy.libraryKeepers}</span>
              <span className="text-xs text-[#aab2bd]">{copy.libraryKeepersCriteria}</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setViewMode('survey');
              }}
              type="button"
            >
              <span>{copy.librarySurvey}</span>
              <span className="text-xs text-[#aab2bd]">{copy.selectedCount(selectedCount)}</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#8bb8ff]/40 bg-[#1c2a42] px-3 py-2 text-left text-sm hover:bg-[#263755]"
              onClick={() => {
                setIsAutoStackExpanded((current) => !current);
              }}
              type="button"
            >
              <span>{copy.libraryStackToggle}</span>
              <span className="text-xs text-[#b7cdf9]">
                {isAutoStackExpanded ? copy.libraryStackExpanded : copy.libraryStackCollapsed}
              </span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#d7a84f]/40 bg-[#302b20] px-3 py-2 text-left text-sm hover:bg-[#3b3323]"
              onClick={() => {
                setVirtualCopyId('vc-dsc-0002-bw-proof');
              }}
              type="button"
            >
              <span>{copy.createBwProofCopy}</span>
              <span className="text-xs text-[#e0c985]">{copy.virtualCopyShort}</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#6cbf84]/40 bg-[#213427] px-3 py-2 text-left text-sm hover:bg-[#294331]"
              onClick={() => {
                setIsCompareReady(true);
                setViewMode('compare');
              }}
              type="button"
            >
              <span>{copy.compareVirtualCopy}</span>
              <span className="text-xs text-[#95d7a7]">{copy.compareReady}</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#6da7d8]/40 bg-[#1e2e3d] px-3 py-2 text-left text-sm hover:bg-[#27394b]"
              disabled={viewMode !== 'survey'}
              onClick={() => {
                setOpenedEditorPath('/proof-roll/DSC_0002.NEF');
              }}
              type="button"
            >
              <span>{copy.editSelectedPick}</span>
              <span className="text-xs text-[#9cc9ee]">
                {editorHandoffReady ? copy.editorHandoffReady : activeAsset.file}
              </span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-md border border-[#c9a958]/40 bg-[#332c1a] px-3 py-2 text-left text-sm hover:bg-[#403620]"
              disabled={!editorHandoffReady}
              onClick={() => {
                setQueuedExportId('export-dsc-0002-current-edit-tiff16');
              }}
              type="button"
            >
              <span>{copy.exportSelectedPick}</span>
              <span className="text-xs text-[#e5cf88]">{exportQueued ? copy.exportQueued : copy.pending}</span>
            </button>
          </div>
        </aside>
        <section className="min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="library-survey">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{viewMode}</p>
              <h2 className="text-lg font-semibold">{activeAsset.file}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#d8dee7]">
              <CircleGauge size={16} />
              <span>{copy.libraryRating(activeAsset.rating)}</span>
            </div>
          </div>
          <div className="grid h-[680px] grid-cols-2 gap-4">
            {visibleAssets.map((asset) => (
              <div
                className={`flex min-h-0 flex-col justify-between rounded-md border border-white/10 bg-gradient-to-br ${asset.tone} p-4 text-[#121416] shadow-2xl`}
                key={asset.file}
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{asset.file}</span>
                  <div className="flex items-center gap-2">
                    {asset.file === 'DSC_0001.NEF' && (
                      <span className="rounded-full bg-black/50 px-2 py-1 text-[10px] uppercase text-white">
                        {copy.libraryStackBadge('Burst', 3)}
                      </span>
                    )}
                    <span>{copy.libraryStars(asset.rating)}</span>
                  </div>
                </div>
                {asset.file === 'DSC_0001.NEF' && (
                  <div className="rounded bg-black/25 px-3 py-2 text-xs text-white">
                    {isAutoStackExpanded ? copy.libraryStackExpanded : copy.libraryStackCollapsed}
                  </div>
                )}
                <div className="rounded bg-white/70 p-3">
                  <p className="text-sm font-semibold">{asset.status}</p>
                  <p className="text-xs">{copy.libraryColorLabel(asset.color)}</p>
                </div>
              </div>
            ))}
          </div>
          {isCompareReady && (
            <div
              className="mt-4 grid grid-cols-2 gap-3 rounded-md border border-white/10 bg-white/5 p-3"
              data-testid="library-virtual-copy-compare-proof"
            >
              <div className="rounded bg-gradient-to-br from-[#4f86c6] to-[#c7d8ff] p-3 text-[#111316]">
                <p className="text-xs font-semibold uppercase">{copy.compareSource}</p>
                <p className="text-sm font-semibold">{copy.compareSourceFile}</p>
                <p className="text-xs">{copy.compareSourceProof}</p>
              </div>
              <div className="rounded bg-gradient-to-br from-[#d7d7d7] to-[#2f3338] p-3 text-[#111316]">
                <p className="text-xs font-semibold uppercase">{copy.compareVariant}</p>
                <p className="text-sm font-semibold">{copy.compareVariantFile}</p>
                <p className="text-xs">{copy.compareVariantProof}</p>
              </div>
            </div>
          )}
        </section>
        <aside className="border-l border-white/10 bg-[#181b20] p-4" data-visual-smoke-section="library-sidecar">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{copy.selectionState}</h2>
            <Camera size={18} className="text-[#6cbf84]" />
          </div>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[#9ba6b2]">{copy.filter}</p>
              <p>{filterMode === 'keepers' ? copy.keeperFilterSummary : copy.allSessionFiles}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3" data-testid="library-virtual-copy">
              <p className="text-xs text-[#9ba6b2]">{copy.virtualCopy}</p>
              <p>{virtualCopyId}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[#9ba6b2]">{copy.repeatableProof}</p>
              <p>{copy.replayProofSummary}</p>
            </div>
            <div
              className="rounded-md border border-[#6da7d8]/30 bg-[#172231] p-3"
              data-testid="library-editor-handoff-proof"
            >
              <p className="text-xs text-[#9ba6b2]">{copy.editorHandoff}</p>
              <p>{editorHandoffReady ? copy.editorHandoffSummary : copy.pending}</p>
            </div>
            <div
              className="rounded-md border border-[#c9a958]/30 bg-[#2d2718] p-3"
              data-testid="library-export-queue-proof"
            >
              <p className="text-xs text-[#9ba6b2]">{copy.exportQueue}</p>
              <p>{exportQueued ? copy.exportQueueSummary : copy.pending}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ProfessionalLayersCompactVisualSmoke() {
  const { t } = useTranslation();
  const hierarchyRows = [
    {
      count: '2 masks',
      name: 'Local polish',
      state: 'mixed',
      summary: 'group / 2 layers / 78%',
      tone: 'border-editor-warning bg-editor-warning-surface',
    },
    {
      count: 'Brush + range',
      name: 'Sky recovery',
      state: 'selected',
      summary: 'screen / 64% / visible',
      tone: 'border-editor-focus-ring bg-editor-selected-quiet',
    },
    {
      count: 'Radial target',
      name: 'Heal highlight',
      state: 'ready',
      summary: 'normal / clone ready / visible',
      tone: 'border-editor-border bg-editor-panel',
    },
    {
      count: 'Remove region',
      name: 'Dust remove',
      state: 'stale',
      summary: 'needs regeneration / seed 42',
      tone: 'border-editor-warning bg-editor-warning-surface',
    },
  ];
  const subMasks = [
    { mode: '+', name: 'Subject brush', state: 'ready' },
    { mode: '-', name: 'Window subtract', state: 'disabled' },
    { mode: 'x', name: 'Warm skin range', state: 'loading' },
  ];

  return (
    <main
      className="min-h-screen bg-editor-matte p-4 text-text-primary font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ProfessionalLayersCompact}
    >
      <h1 className="sr-only">{copy.professionalLayersCompact}</h1>
      <div className="mx-auto flex h-screen max-w-6xl overflow-hidden rounded-md border border-editor-border bg-editor-panel shadow-2xl">
        <aside
          className="w-80 border-r border-editor-border bg-editor-panel"
          data-visual-smoke-section="compact-layer-stack"
        >
          <div className="flex min-h-9 items-center justify-between border-b border-editor-border px-3">
            <span className="flex min-w-0 items-center gap-2">
              <Layers3 size={16} className="text-editor-warning" />
              <span className="truncate text-sm font-semibold">{copy.professionalLayersTitle}</span>
            </span>
            <span className={editorChromeStatusChipClassName('neutral')}>{copy.professionalLayersActiveCount}</span>
          </div>
          <div className="space-y-1 p-2" data-testid="professional-layers-stack-proof">
            {hierarchyRows.map((row) => (
              <button
                className={`grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1 text-left transition-colors ${row.tone}`}
                data-layer-state={row.state}
                key={row.name}
                type="button"
              >
                <span className="h-2 w-2 rounded-full bg-editor-primary-active" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium leading-4">{row.name}</span>
                  <span className="block truncate text-[11px] leading-4 text-text-secondary">{row.summary}</span>
                </span>
                <span className="truncate rounded bg-editor-panel-well px-1.5 py-0.5 text-[10px] uppercase text-text-secondary">
                  {row.count}
                </span>
              </button>
            ))}
          </div>
          <div
            className="flex items-center justify-between gap-2 border-t border-editor-border px-2 py-1.5"
            data-testid="professional-layer-mask-creation-proof"
          >
            <div className="flex items-center gap-0.5">
              <span className="mr-1 text-[10px] font-semibold uppercase text-text-tertiary">
                {t('editor.layers.title')}
              </span>
              {[Plus, Brush, Sparkles].map((Icon, index) => (
                <button
                  aria-label={['Create layer', 'Create brush layer', 'Create healing layer'][index]}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary"
                  key={index}
                  type="button"
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 border-l border-editor-border pl-2">
              <span className="mr-1 text-[10px] font-semibold uppercase text-text-tertiary">
                {t('editor.masks.masksTitle')}
              </span>
              {[Brush, TriangleRight, Circle, Sparkles, Plus].map((Icon, index) => (
                <button
                  aria-label={['Add brush', 'Add gradient', 'Add radial', 'Select subject', 'Add mask'][index]}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary"
                  key={index}
                  type="button"
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-editor-border p-2" data-visual-smoke-section="compact-submask-hierarchy">
            <p className="mb-1 text-[11px] font-semibold uppercase text-text-secondary">
              {copy.professionalLayersMaskComponents}
            </p>
            <div className="space-y-1 border-l border-editor-border pl-2" data-testid="professional-submask-row-proof">
              {subMasks.map((subMask) => (
                <div
                  className="grid min-h-8 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded bg-editor-panel-well px-2 py-1"
                  data-submask-state={subMask.state}
                  key={subMask.name}
                >
                  <span className="text-center text-[11px] text-editor-primary-active">{subMask.mode}</span>
                  <span className="truncate text-[12px]">{subMask.name}</span>
                  <span className={editorChromeStatusChipClassName(subMask.state === 'ready' ? 'success' : 'warning')}>
                    {subMask.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="relative flex-1 bg-editor-matte p-5" data-visual-smoke-section="compact-preview">
          <div className="grid h-full place-items-center rounded-md border border-editor-border bg-editor-panel">
            <div
              className="relative h-3/4 w-3/4 overflow-hidden rounded-md border border-editor-border"
              data-testid="professional-layers-nonblank-preview"
              style={{ background: 'linear-gradient(135deg, #27465a, #3c3445 48%, #756344)' }}
            >
              <div className="absolute inset-x-0 top-0 h-28 bg-editor-info-surface mix-blend-screen" />
              <div className="absolute bottom-8 left-12 h-24 w-48 rounded-full bg-editor-warning-surface blur-xl" />
              <div className="absolute right-12 bottom-12 h-28 w-36 rounded-md border border-editor-border bg-editor-matte" />
            </div>
          </div>
        </section>

        <aside
          className="w-80 border-l border-editor-border bg-editor-panel p-2"
          data-visual-smoke-section="compact-mask-inspector"
        >
          <div
            className="rounded-md border border-editor-border bg-editor-panel-well p-2"
            data-testid="professional-local-adjustment-proof"
          >
            <p className="text-[11px] font-semibold uppercase text-text-secondary">
              {copy.professionalLayersLocalAdjustment}
            </p>
            {copy.professionalLayersAdjustmentLabels.map((label) => (
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2" key={label}>
                <span className="truncate text-[12px] text-text-secondary">{label}</span>
                <span className="h-1 rounded bg-editor-primary-active" />
              </div>
            ))}
          </div>
          <div
            className="mt-2 rounded-md border border-editor-border bg-editor-panel-well p-2"
            data-testid="professional-mask-overlay-proof"
          >
            <MaskOverlayReviewControls
              settings={{ edgeThreshold: 0.5, mode: 'rubylith', opacity: 0.5 }}
              onChange={() => {}}
              onDragStateChange={() => {}}
              hotkeyHint="Shift+O"
            />
          </div>
          <div
            className="mt-2 flex items-center justify-between gap-2 rounded-md border border-editor-warning bg-editor-warning-surface px-2 py-1.5"
            data-testid="professional-mask-status-proof"
          >
            <span className="truncate text-[12px] font-medium">{copy.professionalLayersDustRemove}</span>
            <span className={editorChromeStatusChipClassName('warning')}>{copy.professionalLayersStale}</span>
          </div>
          <div
            className="mt-2 rounded-md border border-editor-border bg-editor-panel-well p-2"
            data-testid="professional-assisted-mask-proof"
          >
            <p className="mb-1 text-[11px] font-semibold uppercase text-text-secondary">
              {copy.professionalLayersAssistedMaskStates}
            </p>
            <div className="grid grid-cols-2 gap-1">
              <span className={editorChromeStatusChipClassName('success')}>{copy.professionalLayersReady}</span>
              <span className={editorChromeStatusChipClassName('info')}>{copy.professionalLayersLoading}</span>
              <span className={editorChromeStatusChipClassName('warning')}>{copy.professionalLayersStale}</span>
              <span className={editorChromeStatusChipClassName('danger')}>{copy.professionalLayersError}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LayerStackWorkflowVisualSmoke() {
  const [layers, setLayers] = useState<LayerWorkflowState[]>(() => [...layerWorkflowInitialStack]);
  const [selectedLayer, setSelectedLayer] = useState<string>(layerWorkflowFallbackLayer.name);
  const [exportParity, setExportParity] = useState('pending');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const [copyMaskApplied, setCopyMaskApplied] = useState(false);
  const [blendModeHistory, setBlendModeHistory] = useState<Array<LayerWorkflowBlendMode>>([]);

  const addLayer = () => {
    const newLayer: LayerWorkflowState = {
      blend: 'screen',
      mask: 'Brush',
      name: 'Local dodge',
      opacity: 50,
      visible: true,
    };
    setLayers((currentLayers) => [...currentLayers, newLayer]);
    setSelectedLayer(newLayer.name);
  };
  const duplicateSelectedLayer = () => {
    const selected = layers.find((layer) => layer.name === selectedLayer);
    if (selected === undefined) return;
    const duplicate = { ...selected, name: `${selected.name} copy` };
    setLayers((currentLayers) => [...currentLayers, duplicate]);
    setSelectedLayer(duplicate.name);
  };
  const updateSelectedLayer = (update: Partial<LayerWorkflowState>) => {
    setLayers((currentLayers) =>
      currentLayers.map((layer) => (layer.name === selectedLayer ? { ...layer, ...update } : layer)),
    );
    if (update.name !== undefined) setSelectedLayer(update.name);
  };
  const selectBlendMode = (blend: LayerWorkflowBlendMode) => {
    updateSelectedLayer({ blend });
    setBlendModeHistory((currentHistory) => [...currentHistory, blend]);
  };
  const moveSelectedLayerDown = () => {
    setLayers((currentLayers) => {
      const selectedIndex = currentLayers.findIndex((layer) => layer.name === selectedLayer);
      if (selectedIndex < 0 || selectedIndex === currentLayers.length - 1) return currentLayers;
      const nextLayers = [...currentLayers];
      const selected = nextLayers[selectedIndex];
      const next = nextLayers[selectedIndex + 1];
      if (selected === undefined || next === undefined) return currentLayers;
      nextLayers[selectedIndex] = next;
      nextLayers[selectedIndex + 1] = selected;
      return nextLayers;
    });
  };
  const toggleSelectedLayer = () => {
    setLayers((currentLayers) =>
      currentLayers.map((layer) => (layer.name === selectedLayer ? { ...layer, visible: !layer.visible } : layer)),
    );
  };
  const copySkyMaskToSelectedLayer = () => {
    setLayers((currentLayers) => {
      const sourceLayer = currentLayers.find((layer) => layer.name === 'Sky recovery');
      if (sourceLayer === undefined) return currentLayers;

      return currentLayers.map((layer) =>
        layer.name === selectedLayer
          ? {
              ...layer,
              mask: `${sourceLayer.mask} copy`,
              visible: sourceLayer.visible,
            }
          : layer,
      );
    });
    setCopyMaskApplied(true);
  };
  const createLocalPolishGroup = () => {
    setLayers((currentLayers) =>
      currentLayers.map((layer, index) =>
        index < 2 ? { ...layer, groupId: 'group_local_polish', groupName: 'Local polish' } : layer,
      ),
    );
    setSelectedLayer('Sky recovery');
  };
  const toggleLocalPolishCollapsed = () => {
    setCollapsedGroupIds((currentGroupIds) =>
      currentGroupIds.includes('group_local_polish') ? [] : ['group_local_polish'],
    );
  };

  const visibleLayerCount = layers.filter((layer) => layer.visible).length;
  const selectedLayerState = layers.find((layer) => layer.name === selectedLayer) ?? layerWorkflowFallbackLayer;
  const groupedLayerCount = layers.filter((layer) => layer.groupId === 'group_local_polish').length;
  const localPolishCollapsed = collapsedGroupIds.includes('group_local_polish');
  const localPolishLayers = layers.filter((layer) => layer.groupId === 'group_local_polish');
  const localPolishVisibleCount = localPolishLayers.filter((layer) => layer.visible).length;
  const localPolishVisibleState =
    localPolishVisibleCount === 0
      ? 'hidden'
      : localPolishVisibleCount === localPolishLayers.length
        ? 'visible'
        : 'mixed';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LayerStackWorkflow}
    >
      <div className="grid h-screen grid-cols-[280px_1fr_360px] overflow-hidden">
        <aside className="border-r border-white/10 bg-[#15181c] p-4" data-visual-smoke-section="layer-actions">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-sm font-semibold">{copy.layerWorkflowTitle}</h1>
            <Layers3 size={18} className="text-[#f2be4e]" />
          </div>
          <div
            className="space-y-2"
            data-active-layer={selectedLayerState.name}
            data-blend-mode={selectedLayerState.blend}
            data-blend-mode-history={blendModeHistory.join(',')}
            data-collapsed-group-count={String(collapsedGroupIds.length)}
            data-copied-mask-editable={String(copyMaskApplied)}
            data-copied-mask-visible={String(copyMaskApplied && selectedLayerState.visible)}
            data-copy-mask-applied={String(copyMaskApplied)}
            data-copy-mask-source-layer="Sky recovery"
            data-copy-mask-target-layer={selectedLayerState.name}
            data-grouping-state={groupedLayerCount > 0 ? 'active' : 'ungrouped'}
            data-grouped-layer-count={String(groupedLayerCount)}
            data-hidden-group-count={localPolishVisibleState === 'hidden' ? '1' : '0'}
            data-layer-count={String(layers.length)}
            data-mask={selectedLayerState.mask}
            data-mixed-group-count={localPolishVisibleState === 'mixed' ? '1' : '0'}
            data-opacity={String(selectedLayerState.opacity)}
            data-supported-blend-mode-count={String(layerWorkflowSupportedBlendModes.length)}
            data-supported-blend-modes={layerWorkflowSupportedBlendModes.join(',')}
            data-testid="layer-stack-workflow-proof"
            data-visible-group-count={localPolishVisibleState === 'visible' ? '1' : '0'}
            data-visible-count={String(visibleLayerCount)}
          >
            {groupedLayerCount > 0 && (
              <button
                className="w-full rounded-md border border-[#f2be4e]/40 bg-[#2c2a20] px-3 py-2 text-left text-sm text-white"
                data-collapsed={String(localPolishCollapsed)}
                data-visible-state={localPolishVisibleState}
                data-testid="layer-stack-visual-group-row"
                onClick={toggleLocalPolishCollapsed}
                type="button"
              >
                <span className="flex items-center justify-between">
                  <span>{copy.layerLocalPolish}</span>
                  <span className="text-xs text-[#d7c37f]">{copy.layerGroupCount(groupedLayerCount)}</span>
                </span>
              </button>
            )}
            {layers.map((layer, index) => {
              if (layer.groupId === 'group_local_polish' && localPolishCollapsed) return null;
              return (
                <button
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selectedLayer === layer.name
                      ? 'border-[#78d4ff] bg-[#24303a] text-white'
                      : 'border-white/10 bg-[#1b2026] text-[#cbd5df]'
                  }`}
                  data-group-id={layer.groupId ?? ''}
                  data-testid={`layer-stack-visual-layer-row-${index}`}
                  key={layer.name}
                  onClick={() => {
                    setSelectedLayer(layer.name);
                  }}
                  type="button"
                >
                  <span className="flex items-center justify-between">
                    <span>{layer.name}</span>
                    <span className="text-xs text-[#8d97a3]">#{index + 1}</span>
                  </span>
                  <span className="mt-1 block text-xs text-[#8d97a3]">
                    {layer.mask} / {formatLayerBlend(layer.blend)} / {layer.opacity}%
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={addLayer}
              type="button"
            >
              {copy.layerAdd}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={duplicateSelectedLayer}
              type="button"
            >
              {copy.layerDuplicate}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={() => {
                updateSelectedLayer({ name: 'Proof polish' });
              }}
              type="button"
            >
              {copy.layerRenameProof}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={() => {
                updateSelectedLayer({ opacity: 64 });
              }}
              type="button"
            >
              {copy.layerOpacity64}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={() => {
                selectBlendMode('overlay');
              }}
              type="button"
            >
              {copy.layerBlendOverlay}
            </button>
            <div className="col-span-2 grid grid-cols-3 gap-1" data-testid="layer-stack-blend-mode-picker">
              {layerWorkflowSupportedBlendModes.map((blend) => (
                <button
                  className={`rounded-md border px-1.5 py-2 text-[11px] ${
                    selectedLayerState.blend === blend
                      ? 'border-[#78d4ff] bg-[#24303a] text-white'
                      : 'border-white/10 bg-[#20252b] text-[#cbd5df]'
                  }`}
                  key={blend}
                  onClick={() => {
                    selectBlendMode(blend);
                  }}
                  type="button"
                >
                  {formatLayerBlend(blend)}
                </button>
              ))}
            </div>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={copySkyMaskToSelectedLayer}
              type="button"
            >
              {copy.layerCopyMask}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={createLocalPolishGroup}
              type="button"
            >
              {copy.layerCreateGroup}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={toggleLocalPolishCollapsed}
              type="button"
            >
              {copy.layerCollapseGroup}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={moveSelectedLayerDown}
              type="button"
            >
              {copy.layerMoveDown}
            </button>
            <button
              className="rounded-md border border-white/10 bg-[#20252b] px-3 py-2 text-sm"
              onClick={toggleSelectedLayer}
              type="button"
            >
              {copy.layerToggle}
            </button>
          </div>
          <div
            className="mt-3 rounded-md border border-white/10 bg-[#1b2026] px-3 py-2 text-xs text-[#aab2bd]"
            data-collapsed-group-ids={collapsedGroupIds.join(',')}
            data-local-polish-visible-count={String(localPolishVisibleCount)}
            data-local-polish-visible-state={localPolishVisibleState}
            data-testid="layer-stack-visual-group-proof"
          >
            {copy.layerGroupingActive.replace('{{count}}', String(groupedLayerCount))}
          </div>
        </aside>

        <section className="relative bg-[#0f1114] p-5" data-visual-smoke-section="layer-preview">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{copy.layeredPreview}</h2>
              <p className="text-sm text-[#8d97a3]">{copy.layerWorkflowDescription}</p>
            </div>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[#cbd5df]">
              {copy.layerVisibleCount(visibleLayerCount)}
            </span>
          </div>
          <div className="grid h-[calc(100%-4rem)] place-items-center rounded-md border border-white/10 bg-[#171a1f]">
            <div className="relative h-[70%] w-[72%] overflow-hidden rounded-md border border-white/10 bg-gradient-to-br from-[#243b4a] via-[#382f3f] to-[#67513a] shadow-2xl">
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#9ccfff]/50 to-transparent mix-blend-screen" />
              <div className="absolute bottom-0 left-0 h-40 w-full bg-[#2c201c]/60 mix-blend-multiply" />
              <div className="absolute right-16 top-20 h-52 w-40 rounded-full bg-[#f6d48a]/45 mix-blend-soft-light blur-xl" />
              <div className="absolute bottom-14 left-16 right-16 h-20 rounded-md border border-white/10 bg-black/30" />
            </div>
          </div>
        </section>

        <aside className="border-l border-white/10 bg-[#15181c] p-4" data-visual-smoke-section="layer-runtime">
          <h2 className="mb-3 text-sm font-semibold">{copy.layerRuntimeEvidence}</h2>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-white/10 bg-[#1b2026] p-3">
              <p className="text-xs text-[#8d97a3]">{copy.selectedLayer}</p>
              <p className="mt-1 font-medium">{selectedLayerState.name}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-[#1b2026] p-3">
              <p className="text-xs text-[#8d97a3]">{copy.maskBlendOpacity}</p>
              <p className="mt-1 font-medium">
                {selectedLayerState.mask} / {formatLayerBlend(selectedLayerState.blend)} / {selectedLayerState.opacity}%
              </p>
            </div>
            <button
              className="w-full rounded-md border border-[#78d4ff]/40 bg-[#1b3442] px-3 py-2 text-left"
              onClick={() => {
                setExportParity('ready');
              }}
              type="button"
            >
              {copy.comparePreviewExport}
            </button>
            <div
              className="rounded-md border border-white/10 bg-[#1b2026] p-3"
              data-export-parity={exportParity}
              data-testid="layer-stack-export-parity-proof"
            >
              <p className="text-xs text-[#8d97a3]">{copy.previewExportParity}</p>
              <p className="mt-1 font-medium">
                {exportParity === 'ready' ? copy.readyForHeadlessReplay : copy.pending}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

const panoramaPreviewSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#8fd5ff"/>
      <stop offset="0.5" stop-color="#f7d08c"/>
      <stop offset="1" stop-color="#9c7be8"/>
    </linearGradient>
  </defs>
  <rect width="960" height="640" fill="url(#sky)"/>
  <path d="M0 430 C160 380 290 410 430 350 C590 285 730 340 960 250 L960 640 L0 640 Z" fill="#293841"/>
  <path d="M0 510 C180 470 320 520 480 465 C660 405 800 430 960 370 L960 640 L0 640 Z" fill="#16252b"/>
  <rect x="80" y="120" width="220" height="330" rx="18" fill="#ffffff" opacity="0.12"/>
  <rect x="370" y="90" width="220" height="360" rx="18" fill="#ffffff" opacity="0.16"/>
  <rect x="660" y="130" width="220" height="320" rx="18" fill="#ffffff" opacity="0.12"/>
</svg>`);

const panoramaPreviewUrl = `data:image/svg+xml,${panoramaPreviewSvg}`;
const panoramaRuntimePlanFixture: PanoramaRuntimePlan = {
  dry_run: true,
  family: 'panorama',
  output_dimensions: { height: 3200, width: 9024 },
  preflight: {
    blocked_reasons: [],
    engine_capabilities: {
      full_frame_legacy: false,
      max_preview_dimension_px: 8192,
      plan_only: true,
      tile_backed_render: true,
    },
    execution_mode: 'tile_backed_render',
    geometry_estimate: {
      output_pixel_count: 28_876_800,
      projected_bounds: { height: 3200, width: 9024, x: 0, y: 0 },
      source_count: 5,
      source_pixel_count: 22_500_000,
    },
    memory_budget_bytes: 6_442_450_944,
    memory_budget_ratio: 0.42,
    memory_components: {
      low_detail_mask_bytes: 22_500_000,
      output_canvas_bytes: 368_640_000,
      output_mask_bytes: 30_720_000,
      overhead_bytes: 63_864_000,
      preview_bytes: 73_728_000,
      seam_workspace_bytes: 122_880_000,
      source_decode_bytes: 270_000_000,
      total_estimated_peak_bytes: 952_332_000,
    },
    source_geometry: {
      blocked_reasons: [],
      column_count_estimate: 5,
      connected_component_count: 1,
      graph_connectivity: {
        connected_source_count: 5,
        disconnected_source_count: 0,
        edge_count: 4,
        is_connected: true,
      },
      horizontal_span_px: 480,
      layout: 'single_row',
      layout_confidence: {
        column_confidence: 0.88,
        overall_confidence: 0.91,
        row_confidence: 0.95,
      },
      selected_component: {
        source_count: 5,
        source_indices: [0, 1, 2, 3, 4],
      },
      row_count_estimate: 1,
      support: 'implemented_current_engine',
      vertical_span_px: 3,
      warning_codes: [],
    },
    status: 'accepted',
    tile_count: 18,
    warning_codes: ['geometry_estimate_low_confidence'],
  },
  source_image_refs: Array.from({ length: 5 }, (_, sourceIndex) => ({
    height: 3000,
    image_path: `/synthetic/panorama/source-${sourceIndex}.dng`,
    raw_defaults_applied: true,
    role: 'panorama_tile',
    source_index: sourceIndex,
    width: 4500,
  })),
  warnings: ['Panorama dry-run uses conservative source-dimension bounds before feature matching.'],
};
const panoramaRenderedReviewFixture: PanoramaRenderedReview = {
  boundary: {
    crop: {
      height: 3200,
      mode: 'coverage_bounds',
      preCropHeight: 3400,
      preCropWidth: 9224,
      width: 9024,
      x: 100,
      y: 80,
    },
    effective: 'auto_crop',
    requested: 'auto_crop',
  },
  capabilityLevel: 'runtime_apply_capable',
  outputDimensions: { height: 3200, width: 9024 },
  projection: { effective: 'cylindrical', requested: 'cylindrical' },
  seamReview: {
    contributionMapArtifactId: 'artifact_visual_panorama_contribution_map',
    overlapConfidence: {
      edgeCount: 4,
      level: 'medium',
      meanConfidenceScore: 0.72,
      minimumConfidenceScore: 0.58,
      minimumOverlapRatio: 0.24,
      weakEdgeCount: 0,
    },
    policy: 'adaptive_dp_feather_v1',
    reviewStatus: 'requires_review',
    seamCount: 4,
    seamMaskArtifactId: 'artifact_visual_panorama_seam_mask',
    seams: [
      { confidence: 'high', featherWidthPx: 100, fromSourceIndex: 0, p95ErrorPx: 1.2, toSourceIndex: 1 },
      { confidence: 'medium', featherWidthPx: 100, fromSourceIndex: 1, p95ErrorPx: 2.4, toSourceIndex: 2 },
      { confidence: 'medium', featherWidthPx: 100, fromSourceIndex: 2, p95ErrorPx: 3.1, toSourceIndex: 3 },
      { confidence: 'high', featherWidthPx: 100, fromSourceIndex: 3, p95ErrorPx: 1.6, toSourceIndex: 4 },
    ],
    seamWarningState: {
      parallaxRisk: 'medium',
      state: 'warning',
      warningCodes: ['geometry_estimate_low_confidence'],
    },
  },
  sourceGeometry: {
    blockedReasons: [],
    columnCountEstimate: 5,
    connectedComponentCount: 1,
    graphConnectivity: {
      connectedSourceCount: 5,
      disconnectedSourceCount: 0,
      edgeCount: 4,
      isConnected: true,
    },
    horizontalSpanPx: 480,
    layout: 'single_row',
    layoutConfidence: {
      columnConfidence: 0.88,
      overallConfidence: 0.91,
      rowConfidence: 0.95,
    },
    selectedComponent: {
      sourceCount: 5,
      sourceIndices: [0, 1, 2, 3, 4],
    },
    rowCountEstimate: 1,
    support: 'implemented_current_engine',
    verticalSpanPx: 3,
    warningCodes: [],
  },
  sources: {
    excludedSourceIndices: [],
    stitchedSourceIndices: [0, 1, 2, 3, 4],
    totalCount: 5,
  },
  sourceContribution: {
    excludedSourceCount: 0,
    regions: [0, 1, 2, 3, 4].map((sourceIndex) => ({
      coverageRatio: 0.2,
      role: 'stitched',
      sourceIndex,
    })),
    stitchedSourceCount: 5,
  },
  exposureNormalizationSummary: {
    appliedGainCount: 2,
    appliedLuminanceGains: [
      { gain: 0.94, sourceIndex: 1 },
      { gain: 1.08, sourceIndex: 3 },
    ],
    compensationStrengthPercent: 85,
    medianLogLuminanceDeltaAfter: 0.031,
    medianLogLuminanceDeltaBefore: 0.214,
    mode: 'scalar_overlap_luminance_gain_v1',
  },
  warningCodes: ['geometry_estimate_low_confidence'],
};
const panoramaSavedReviewSmokeSettings: PanoramaUiSettings = {
  ...DEFAULT_PANORAMA_UI_SETTINGS,
  projection: panoramaRenderedReviewFixture.projection.effective,
};
const hdrPreviewSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640">
  <defs>
    <linearGradient id="hdr" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#101820"/>
      <stop offset="0.45" stop-color="#4f6c73"/>
      <stop offset="1" stop-color="#f7d08c"/>
    </linearGradient>
  </defs>
  <rect width="960" height="640" fill="url(#hdr)"/>
  <circle cx="720" cy="130" r="70" fill="#fff5c4" opacity="0.9"/>
  <rect x="80" y="300" width="800" height="210" rx="18" fill="#15242c" opacity="0.9"/>
  <path d="M110 475 C280 390 390 420 520 345 C660 265 765 330 850 260" fill="none" stroke="#e7d6a1" stroke-width="18" opacity="0.8"/>
</svg>`);
const tinyPreviewDataUrl = `data:image/svg+xml,${hdrPreviewSvg}`;
const hdrVisualSmokeSourceMetadata: HdrBracketPreflightSourceMetadata[] = [
  {
    exif: {
      ExposureTime: '1/250',
      FNumber: '5.6',
      ISO: '100',
      LensModel: 'NIKKOR Z 24-70mm f/2.8 S',
      Make: 'Nikon',
      Model: 'Z8',
    },
    path: '/tmp/rawengine-hdr-under.nef',
  },
  {
    exif: {
      ExposureTime: '1/60',
      FNumber: '5.6',
      ISO: '100',
      LensModel: 'NIKKOR Z 24-70mm f/2.8 S',
      Make: 'Nikon',
      Model: 'Z8',
    },
    path: '/tmp/rawengine-hdr-mid.nef',
  },
  {
    exif: {
      ExposureTime: '1/15',
      FNumber: '5.6',
      ISO: '100',
      LensModel: 'NIKKOR Z 24-70mm f/2.8 S',
      Make: 'Nikon',
      Model: 'Z8',
    },
    path: '/tmp/rawengine-hdr-over.nef',
  },
];
const filmSmokeMetricLabels = {
  contrast: 'Contrast',
  grain: 'Grain',
  highlights: 'Highlights',
  temperature: 'Temp',
} as const;
const formatSmokeMetric = (label: string, value: number | string) => `${label} ${value}`;
const commandPaletteWorkflowSourcePath = '/Users/example/Pictures/CommandPalette/DSC_7853.ARW';

function CommandPaletteWorkflowSmoke() {
  const [isOpen, setIsOpen] = useState(true);
  const focusOpen = useUIStore((state) => state.focusStackModalState.isOpen);
  const hdrOpen = useUIStore((state) => state.hdrModalState.isOpen);
  const negativeOpen = useUIStore((state) => state.negativeModalState.isOpen);
  const panoramaOpen = useUIStore((state) => state.panoramaModalState.isOpen);
  const srOpen = useUIStore((state) => state.superResolutionModalState.isOpen);
  const selectedSourceCount = useLibraryStore((state) => state.multiSelectedPaths.length);
  const setLibrary = useLibraryStore((state) => state.setLibrary);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows}
    >
      <div
        className="h-screen bg-[#0f1114]"
        data-visual-smoke-section={VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows}
      >
        <div
          className="sr-only"
          data-focus-open={focusOpen}
          data-hdr-open={hdrOpen}
          data-negative-open={negativeOpen}
          data-panorama-open={panoramaOpen}
          data-selected-source-count={selectedSourceCount}
          data-sr-open={srOpen}
          data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteWorkflowProof}
        />
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.commandPaletteSmoke}
          </span>
        </div>
        <button
          className="m-6 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteOpen}
          onClick={() => {
            setIsOpen(true);
          }}
          type="button"
        >
          {copy.harness}
        </button>
        <button
          className="m-6 ml-0 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.CommandPaletteSelectSource}
          onClick={() => {
            setLibrary({
              libraryActivePath: commandPaletteWorkflowSourcePath,
              multiSelectedPaths: [commandPaletteWorkflowSourcePath],
            });
          }}
          type="button"
        >
          {copy.commandPaletteSelectSource}
        </button>
        <CommandPaletteModal
          isOpen={isOpen}
          onBackToLibrary={() => {}}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      </div>
    </main>
  );
}

const cullingComparePaths = [
  '/Users/example/Pictures/Burst/DSC_2401.NEF',
  '/Users/example/Pictures/Burst/DSC_2402.NEF',
  '/Users/example/Pictures/Burst/DSC_2403.NEF',
] as const;

function buildCullingThumbnail(label: string, baseColor: string, detailColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${baseColor}"/><path d="M0 354 C116 268 192 306 284 198 C380 94 476 156 640 58 L640 480 L0 480 Z" fill="${detailColor}" opacity="0.82"/><circle cx="332" cy="206" r="92" fill="#f8f0d7" opacity="0.32"/><path d="M32 80 H608 M32 160 H608 M32 240 H608 M32 320 H608 M128 32 V448 M256 32 V448 M384 32 V448 M512 32 V448" stroke="#ffffff" stroke-opacity="0.12" stroke-width="4"/><text x="36" y="430" fill="#f4f1e8" font-family="Arial, sans-serif" font-size="34">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const cullingCompareThumbnails: Record<string, string> = {
  [cullingComparePaths[0]]: buildCullingThumbnail('reference', '#28313d', '#7fc6ff'),
  [cullingComparePaths[1]]: buildCullingThumbnail('candidate A', '#2f3136', '#87d49b'),
  [cullingComparePaths[2]]: buildCullingThumbnail('candidate B', '#352f3c', '#f0b56c'),
};

const cullingCompareSuggestions: CullingSuggestions = {
  blurryImages: [],
  failedPaths: [],
  latencyReport: {
    analysisModeCount: 3,
    averageAnalysisMs: 118,
    failedCount: 0,
    maxAnalysisMs: 176,
    sourceCount: 3,
    successfulCount: 3,
    totalElapsedMs: 394,
  },
  similarGroups: [
    {
      duplicates: [
        {
          centerFocusMetric: 88,
          eyeSharpnessMetric: 126,
          exposureMetric: 0.04,
          faceSharpnessMetric: 112,
          focusConfidence: 0.84,
          focusRegion: 'eye_band_heuristic',
          focusScore: 0.91,
          height: 4024,
          path: cullingComparePaths[1],
          qualityScore: 0.91,
          sharpnessMetric: 184,
          width: 6048,
        },
        {
          centerFocusMetric: 72,
          eyeSharpnessMetric: 81,
          exposureMetric: -0.08,
          faceSharpnessMetric: 84,
          focusConfidence: 0.66,
          focusRegion: 'eye_band_heuristic',
          focusScore: 0.73,
          height: 4024,
          path: cullingComparePaths[2],
          qualityScore: 0.76,
          sharpnessMetric: 143,
          width: 6048,
        },
      ],
      representative: {
        centerFocusMetric: 94,
        eyeSharpnessMetric: 148,
        exposureMetric: 0.02,
        faceSharpnessMetric: 131,
        focusConfidence: 0.92,
        focusRegion: 'eye_band_heuristic',
        focusScore: 0.97,
        height: 4024,
        path: cullingComparePaths[0],
        qualityScore: 0.97,
        sharpnessMetric: 221,
        width: 6048,
      },
    },
  ],
  focusRankings: [
    {
      centerFocusMetric: 94,
      eyeSharpnessMetric: 148,
      exposureMetric: 0.02,
      faceSharpnessMetric: 131,
      focusConfidence: 0.92,
      focusRegion: 'eye_band_heuristic',
      focusScore: 0.97,
      height: 4024,
      path: cullingComparePaths[0],
      qualityScore: 0.97,
      sharpnessMetric: 221,
      width: 6048,
    },
    {
      centerFocusMetric: 88,
      eyeSharpnessMetric: 126,
      exposureMetric: 0.04,
      faceSharpnessMetric: 112,
      focusConfidence: 0.84,
      focusRegion: 'eye_band_heuristic',
      focusScore: 0.91,
      height: 4024,
      path: cullingComparePaths[1],
      qualityScore: 0.91,
      sharpnessMetric: 184,
      width: 6048,
    },
    {
      centerFocusMetric: 72,
      eyeSharpnessMetric: 81,
      exposureMetric: -0.08,
      faceSharpnessMetric: 84,
      focusConfidence: 0.66,
      focusRegion: 'eye_band_heuristic',
      focusScore: 0.73,
      height: 4024,
      path: cullingComparePaths[2],
      qualityScore: 0.76,
      sharpnessMetric: 143,
      width: 6048,
    },
  ],
};

function CullingCompareSyncVisualSmoke() {
  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.CullingCompareSync}
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="culling-compare-sync">
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.cullingCompareSync}
          </span>
        </div>
        <CullingModal
          error={null}
          imagePaths={[...cullingComparePaths]}
          isOpen
          onApply={() => {}}
          onClose={() => {}}
          onError={() => {}}
          progress={null}
          suggestions={cullingCompareSuggestions}
          getThumbnailUrl={(path) => cullingCompareThumbnails[path] ?? null}
        />
      </div>
    </main>
  );
}

function LensCorrectionSessionVisualSmoke() {
  const adjustments: Adjustments = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    lensCorrectionMode: 'manual',
    lensDistortionAmount: 118,
    lensDistortionEnabled: true,
    lensDistortionParams: {
      k1: 0.012,
      k2: -0.004,
      k3: 0,
      model: 1,
      tca_vb: 0.9994,
      tca_vr: 1.0006,
      vig_k1: -0.02,
      vig_k2: 0.004,
      vig_k3: 0,
    },
    lensMaker: 'Sony',
    lensModel: 'FE 35mm F1.8',
    lensTcaEnabled: true,
    lensVignetteEnabled: true,
  };
  const selectedImage: SelectedImage = {
    ...cropTransformSmokeImage,
    exif: {
      ApertureValue: 'f/4',
      FocalLength: '35 mm',
      LensModel: 'FE 35mm F1.8',
      Make: 'Sony',
      SubjectDistance: '8',
    },
    isRaw: true,
    path: '/validation/lens-correction-session.ARW',
  };
  return (
    <main
      className="h-screen bg-[#0f1114] text-[#f3f4f1]"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LensCorrectionSession}
      data-visual-smoke-ready="true"
    >
      <span className="sr-only">{copy.lensCorrectionSession}</span>
      <div className="h-full" data-visual-smoke-section="lens-correction-session">
        <LensCorrectionSession
          currentAdjustments={adjustments}
          isSessionOpen
          onApply={() => {}}
          onClose={() => {}}
          selectedImage={selectedImage}
          show
        />
      </div>
    </main>
  );
}

function FocusStackVisualSmoke() {
  const [settings, setSettings] = useState<FocusStackUiSettings>(DEFAULT_FOCUS_STACK_UI_SETTINGS);
  const outputReview = buildFocusStackOutputReviewWorkflow({
    artifactPath: copy.focusArtifactPath,
    settings,
    sourceCount: 6,
  });

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FocusUi}
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="focus-modal">
        <div
          className="sr-only"
          data-alignment-mode={settings.alignmentMode}
          data-apply-command={copy.focusApplyTool}
          data-artifact-path={copy.focusArtifactPath}
          data-blend-method={settings.blendMethod}
          data-command={copy.focusDryRunTool}
          data-decision={settings.blendMethod === 'depth_map' ? 'preview_only' : 'editable_review_required'}
          data-depth-mode={settings.blendMethod}
          data-estimated-preview-megapixels={Math.round((6 * settings.maxPreviewDimensionPx ** 2) / 1_000_000)}
          data-halo-risk-cell-ratio={outputReview.haloRiskCellRatio}
          data-halo-policy="flattened_preview"
          data-halo-suppression-strength-percent={settings.haloSuppressionStrengthPercent}
          data-low-confidence-cell-ratio={outputReview.lowConfidenceCellRatio}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-proof-level="synthetic_runtime"
          data-quality-preference={settings.qualityPreference}
          data-review-overlay-mode={settings.reviewOverlayMode}
          data-review-overlay-opacity-percent={settings.reviewOverlayOpacityPercent}
          data-retouch-layer-policy={settings.retouchLayerPolicy}
          data-runtime-status="dry_run_preview"
          data-sharpness-coverage-ratio="1"
          data-source-contribution-summary="S1 17% / S2 17% / S3 17% / S4 17% / S5 17% / S6 17%"
          data-source-count="6"
          data-source-coverage-details="6"
          data-source-detail-count="6"
          data-warning-codes={
            settings.blendMethod === 'depth_map'
              ? 'human_review_required,synthetic_runtime_only,transition_halo_risk,depth_map_preview_only'
              : 'human_review_required,synthetic_runtime_only,transition_halo_risk,retouch_layer_deferred'
          }
          data-testid="focus-review-workspace-proof"
        />
        <div
          className="sr-only"
          data-alignment-mode={settings.alignmentMode}
          data-blend-method={settings.blendMethod}
          data-halo-suppression-strength-percent={settings.haloSuppressionStrengthPercent}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-quality-preference={settings.qualityPreference}
          data-review-overlay-mode={settings.reviewOverlayMode}
          data-review-overlay-opacity-percent={settings.reviewOverlayOpacityPercent}
          data-retouch-layer-policy={settings.retouchLayerPolicy}
          data-testid="focus-ui-settings-proof"
        />
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.focusStackSmoke}
          </span>
        </div>
        <FocusStackModal
          isOpen
          lastApplyCommand={{
            acceptedDryRunPlanHash: outputReview.editableHandoff.artifactHash,
            acceptedDryRunPlanId: 'focus_stack_plan_6',
            commandType: 'computationalMerge.createFocusStack',
            dryRun: false,
            sources: 6,
            toolName: getComputationalMergeAppServerRoutePairSummary('focus_stack').applyToolName,
          }}
          lastDryRunCommand={{
            commandType: 'computationalMerge.createFocusStack',
            dryRun: true,
            haloSuppressionStrengthPercent: settings.haloSuppressionStrengthPercent,
            sources: 6,
            toolName: getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName,
          }}
          loadingImageUrl={panoramaPreviewUrl}
          onApplyPlan={() => {}}
          onClose={() => {}}
          onPreviewPlan={() => {}}
          onSettingsChange={setSettings}
          outputReview={outputReview}
          settings={settings}
          sourceCount={6}
        />
        <aside className="fixed right-4 top-14 z-50 w-80 rounded-md border border-white/10 bg-black/75 p-3 text-sm shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{copy.focusReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.focusDryRunPreview}</span>
          </div>
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.focusDryRunTool}</p>
              <p>{settings.alignmentMode}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.focusDepthMap}</p>
              <p>{settings.retouchLayerPolicy}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2" data-testid="focus-artifact-handoff">
              <p className="text-xs text-[#aab2bd]">{copy.focusArtifactHandoff}</p>
              <p>{copy.focusArtifactPath}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LayerMaskPrivateRawVisualSmoke() {
  const proof = window.__RAWENGINE_LAYER_MASK_PRIVATE_RAW_PROOF__;
  const staleParityReceipt =
    proof === undefined
      ? null
      : deriveLayerMaskExportParityReceiptState({
          current: {
            ...proof.exportParityReceipt,
            refinedMaskContentHash: `${proof.exportParityReceipt.refinedMaskContentHash.slice(0, -1)}0`,
            sourceGraphRevision: `${proof.exportParityReceipt.sourceGraphRevision}_stale`,
          },
          receipt: proof.exportParityReceipt,
        });

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi}
    >
      <div
        className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]"
        data-visual-smoke-section="layer-mask-private-raw"
      >
        <section className="grid grid-rows-[44px_1fr] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.layerMaskPrivateRawReview}
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-3 gap-3 p-4">
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawUnmasked}</figcaption>
              <img
                alt={copy.layerMaskPrivateRawUnmasked}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="layer-mask-private-raw-unmasked"
                src={proof.unmaskedPreviewDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawUnrefined}</figcaption>
              <img
                alt={copy.layerMaskPrivateRawUnrefined}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="layer-mask-private-raw-unrefined"
                src={proof.unrefinedPreviewDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawRefined}</figcaption>
              <img
                alt={copy.layerMaskPrivateRawRefined}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="layer-mask-private-raw-refined"
                src={proof.refinedPreviewDataUrl}
              />
            </figure>
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.layerRuntimeEvidence}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.layerMaskPrivateRawRuntime}</span>
          </div>
          <div
            className="sr-only"
            data-changed-pixel-ratio={proof.changedPixelRatio}
            data-export-artifact={proof.exportArtifact}
            data-final-export-hash={proof.finalExportHash}
            data-fixture-id={proof.fixtureId}
            data-brush-command-type={proof.brushCommandType ?? 'layerMask.createBrushMask'}
            data-mask-content-hash={proof.refinedMaskContentHash}
            data-metric-count={proof.metricCount}
            data-parity-receipt-id={proof.exportParityReceipt.receiptId}
            data-parity-status={proof.exportParityReceipt.parityStatus}
            data-refine-command-type={proof.refineCommandType ?? 'layerMask.refineMask'}
            data-refined-preview-artifact={proof.refinedPreviewArtifact}
            data-refined-preview-hash={proof.refinedPreviewHash}
            data-runtime-status="private_raw_tauri_runtime_proof"
            data-source-graph-revision={proof.sourceGraphRevision}
            data-stale-parity-status={staleParityReceipt?.parityStatus ?? ''}
            data-stale-reasons={staleParityReceipt?.staleReasons.join(',') ?? ''}
            data-testid="layer-mask-private-raw-review-proof"
            data-unmasked-preview-artifact={proof.unmaskedPreviewArtifact}
            data-unmasked-preview-hash={proof.unmaskedPreviewHash}
            data-unrefined-preview-artifact={proof.unrefinedPreviewArtifact}
            data-unrefined-preview-hash={proof.unrefinedPreviewHash}
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawRuntime}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.previewExportParity}</p>
              <p>{proof.exportParityReceipt.parityStatus}</p>
              <p className="break-all text-xs text-[#aab2bd]">{proof.exportParityReceipt.receiptId}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.layerRuntimeEvidence}</p>
              <p>{copy.layerMaskPrivateRawMetricCount(proof.metricCount)}</p>
              <p className="text-xs text-[#aab2bd]">
                {copy.layerMaskPrivateRawChangedPixels} {proof.changedPixelRatio}
              </p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="layer-mask-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawExport}</p>
              <p className="break-all">{proof.exportArtifact}</p>
              <p className="break-all text-xs text-[#aab2bd]">{proof.finalExportHash}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawStaleInvalidation}</p>
              <p>{staleParityReceipt?.parityStatus}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LayerBrushLocalAdjustmentVisualSmoke() {
  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.LayerBrushLocalAdjustment}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] overflow-hidden bg-[#0f1114]">
        <section className="relative p-8" data-visual-smoke-section="brush-local-preview">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{copy.layerBrushLocalCommandFlow}</p>
              <h1 className="text-lg font-semibold">{copy.layerBrushLocalAdjustment}</h1>
            </div>
            <span className="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#cbd5df]">
              {copy.layerBrushCommandType}
            </span>
          </div>
          <div className="relative h-[calc(100%-4rem)] overflow-hidden rounded-md border border-white/10 bg-linear-to-br from-[#20303a] via-[#5b4a3e] to-[#d4b276]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_42%_36%,rgba(255,235,196,0.58),transparent_16%),radial-gradient(circle_at_62%_58%,rgba(74,115,151,0.44),transparent_20%)]" />
            <div className="absolute left-[24%] top-[28%] h-[160px] w-[420px] rotate-6 rounded-full bg-rose-500/35 blur-[1px]" />
            <div className="absolute left-[34%] top-[52%] h-[108px] w-[360px] -rotate-3 rounded-full bg-rose-500/30 blur-[1px]" />
            <svg className="absolute inset-0 h-full w-full" role="img" aria-label="Two brush strokes">
              <path
                d="M 190 210 C 280 250, 380 285, 520 310"
                fill="none"
                stroke="rgba(255,244,220,0.85)"
                strokeLinecap="round"
                strokeWidth="30"
              />
              <path
                d="M 255 410 C 360 445, 470 448, 580 430"
                fill="none"
                stroke="rgba(255,244,220,0.7)"
                strokeLinecap="round"
                strokeWidth="24"
              />
            </svg>
            <div className="absolute bottom-8 left-8 rounded border border-white/10 bg-black/35 px-3 py-2 text-xs text-[#d8dee8]">
              {copy.layerBrushLocalToneSummary}
            </div>
          </div>
        </section>
        <aside
          className="border-l border-white/10 bg-[#171a1f] p-4 text-sm"
          data-visual-smoke-section="brush-local-receipt"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.layerBrushLocalReceipt}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.layerBrushLocalReplayReady}</span>
          </div>
          <div
            className="sr-only"
            data-brush-command-type="layerMask.createBrushMask"
            data-before-preview-hash="fnv1a32:2f8bbf62"
            data-after-preview-hash="fnv1a32:9703e842"
            data-brush-content-hash="fnv1a32:54e7b441"
            data-changed-pixel-count="7"
            data-coordinate-space="normalized_image"
            data-layer-command-type="layerMask.createLayer"
            data-mask-id="layer_brush_local_adjustment_mask"
            data-preview-export-parity="matched"
            data-receipt-version="1"
            data-rollback-graph-revision="layer_brush_local_initial"
            data-runtime-status="runtime_apply_capable"
            data-stroke-count="2"
            data-testid="layer-brush-local-adjustment-proof"
            data-tone-command-type="layerMask.applyLayerAdjustment"
          />
          <div className="space-y-2">
            {[
              [copy.layerBrushLocalLayerLabel, copy.layerBrushLocalLayerValue],
              [copy.layerBrushLocalMaskLabel, copy.layerBrushLocalMaskValue],
              [copy.layerBrushLocalGraphLabel, copy.layerBrushLocalGraphValue],
              [copy.layerBrushLocalReplayLabel, copy.layerBrushLocalReplayValue],
            ].map(([label, value]) => (
              <div className="rounded border border-white/10 bg-white/5 p-2" key={label}>
                <p className="text-xs text-[#aab2bd]">{label}</p>
                <p>{value}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ObjectPromptVisualSmoke() {
  const pointPrompts = [
    { label: 'foreground' as const, x: 0.46, y: 0.38 },
    { label: 'foreground' as const, x: 0.52, y: 0.5 },
    { label: 'background' as const, x: 0.22, y: 0.76 },
  ];
  const boxPrompt = { height: 0.34, width: 0.28, x: 0.34, y: 0.24 };
  const commandInput = {
    endPoint: [3720, 2320] as [number, number],
    promptKind: 'box' as const,
    startPoint: [2040, 960] as [number, number],
  };
  const receipt = {
    alphaHash: 'sha256:object-prompt-alpha-visual-smoke-v1',
    boxHeight: boxPrompt.height,
    boxReady: true,
    boxWidth: boxPrompt.width,
    boxX: boxPrompt.x,
    boxY: boxPrompt.y,
    clickToMaskLatencyMs: 221,
    hasRaster: true,
    imageHeight: 4000,
    imageWidth: 6000,
    modelId: 'sam_vit_b_01ec64',
    pointCount: pointPrompts.length,
    promptCount: 4,
    promptKind: 'box' as const,
    providerId: 'rapidraw-sam-vit-b-onnx-v1',
    providerStatus: 'local_sam_proposal_v1',
    receiptVersion: 1 as const,
    sourceImagePath: '/private-fixtures/layers/alaska-layer-mask-v1.arw',
  };
  const editableLayerProof = {
    commandId: 'layer_stack_visual_object_prompt',
    graphRevision: 'visual-smoke-object-prompt-graph-v1',
    layerId: 'visual_object_prompt_layer',
    maskId: 'visual_object_prompt_mask',
    objectPromptHash: 'sha256:object-prompt-visual-smoke-v1',
    overlayOpacity: 72,
  };
  const t = ((key: string, options?: Record<string, unknown>) => {
    const optionText = (name: string, fallback: string): string => {
      const value = options?.[name];
      return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
    };
    if (key === 'editor.masks.objectPrompt.points') return `${optionText('count', '0')} point(s)`;
    if (key === 'editor.masks.objectPrompt.receipt') {
      return `${optionText('provider', 'provider')} ${optionText('promptKind', 'prompt')} ${optionText(
        'latency',
        '0',
      )}ms`;
    }
    const labels: Record<string, string> = {
      'editor.masks.objectPrompt.background': copy.objectPromptModeBackground,
      'editor.masks.objectPrompt.box': copy.objectPromptModeBox,
      'editor.masks.objectPrompt.boxReady': copy.objectPromptBoxReady,
      'editor.masks.objectPrompt.clear': copy.objectPromptClear,
      'editor.masks.objectPrompt.foreground': copy.objectPromptModeForeground,
      'editor.masks.objectPrompt.generate': copy.objectPromptGenerate,
    };
    return labels[key] ?? key;
  }) as Parameters<typeof ObjectPromptControls>[0]['t'];

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ObjectPromptUi}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]">
        <section className="grid grid-rows-[44px_1fr]" data-visual-smoke-section="object-prompt-canvas">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.objectPromptVisualProof}
            </span>
          </div>
          <div className="relative m-5 rounded-md border border-white/10 bg-[#15191e]">
            <div className="absolute inset-[9%] rounded bg-gradient-to-br from-slate-700 via-stone-500 to-zinc-900" />
            {pointPrompts.map((point, index) => (
              <span
                className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${
                  point.label === 'foreground' ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
                data-object-prompt-label={point.label}
                data-testid={`object-prompt-proof-point-${index}`}
                key={`${point.label}-${index}`}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              />
            ))}
            <span
              className="absolute border-2 border-sky-300 bg-sky-300/15 shadow-lg"
              data-testid="object-prompt-proof-box"
              style={{
                height: `${boxPrompt.height * 100}%`,
                left: `${boxPrompt.x * 100}%`,
                top: `${boxPrompt.y * 100}%`,
                width: `${boxPrompt.width * 100}%`,
              }}
            />
            <span
              className="absolute rounded-[42%] border border-fuchsia-200/80 bg-fuchsia-400/35 shadow-[0_0_34px_rgba(232,121,249,0.42)]"
              data-alpha-hash={receipt.alphaHash}
              data-layer-id={editableLayerProof.layerId}
              data-mask-id={editableLayerProof.maskId}
              data-overlay-opacity-percent={editableLayerProof.overlayOpacity}
              data-testid="object-prompt-editable-mask-overlay"
              style={{
                height: '31%',
                left: '37%',
                top: '27%',
                width: '23%',
              }}
            />
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4" data-visual-smoke-section="object-prompt-controls">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.objectPromptControlsTitle}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.objectPromptProposal}</span>
          </div>
          <ObjectPromptControls
            commandInput={commandInput}
            isGenerating={false}
            onClear={() => undefined}
            onGenerate={() => undefined}
            onModeChange={() => undefined}
            providerStatusText="local_sam_proposal_v1"
            replayReceipt={receipt}
            selectedImagePath="/private-fixtures/layers/alaska-layer-mask-v1.arw"
            state={{ boxPrompt, mode: 'box', pendingBoxAnchor: null, pointPrompts }}
            t={t}
          />
          <div
            className="mt-3 rounded border border-fuchsia-300/40 bg-fuchsia-400/10 p-2 text-xs"
            data-alpha-hash={receipt.alphaHash}
            data-command-id={editableLayerProof.commandId}
            data-graph-revision={editableLayerProof.graphRevision}
            data-layer-id={editableLayerProof.layerId}
            data-mask-dimensions="6000x4000"
            data-mask-editable="true"
            data-mask-id={editableLayerProof.maskId}
            data-object-prompt-hash={editableLayerProof.objectPromptHash}
            data-overlay-opacity-percent={editableLayerProof.overlayOpacity}
            data-source-image-path={receipt.sourceImagePath}
            data-testid="object-prompt-editable-layer-receipt"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold">{copy.objectPromptEditableLayer}</span>
              <span className="rounded bg-fuchsia-300/20 px-1.5 py-0.5">{copy.objectPromptOverlayOpacityPercent}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-8 w-12 rounded border border-white/20 bg-[radial-gradient(circle_at_48%_45%,rgba(232,121,249,0.9)_0_38%,rgba(232,121,249,0.28)_39_62%,transparent_63%)]" />
              <span className="min-w-0 truncate">{editableLayerProof.maskId}</span>
            </div>
          </div>
          <div
            className="sr-only"
            data-alpha-hash={receipt.alphaHash}
            data-box-ready="true"
            data-command-id={editableLayerProof.commandId}
            data-fixture-id="validation.object-prompt.alaska-local-selection.v1"
            data-graph-revision={editableLayerProof.graphRevision}
            data-has-raster="true"
            data-layer-id={editableLayerProof.layerId}
            data-mask-dimensions="6000x4000"
            data-mask-editable="true"
            data-mask-id={editableLayerProof.maskId}
            data-model-id={receipt.modelId}
            data-object-prompt-hash={editableLayerProof.objectPromptHash}
            data-overlay-opacity-percent={editableLayerProof.overlayOpacity}
            data-point-count={pointPrompts.length}
            data-prompt-kind={commandInput.promptKind}
            data-provider-status={receipt.providerStatus}
            data-source-image-path={receipt.sourceImagePath}
            data-testid="object-prompt-visual-proof"
          />
        </aside>
      </div>
    </main>
  );
}

function FocusPrivateRawVisualSmoke() {
  const proof = window.__RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__;

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]" data-visual-smoke-section="focus-private-raw">
        <div className="flex min-w-0 flex-col gap-3 p-5">
          <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.focusPrivateRawReview}
            </span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] gap-3">
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.focusPrivateRawPreview}</figcaption>
              <img
                alt={copy.focusPrivateRawPreview}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="focus-private-raw-preview"
                src={proof.previewDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.focusPrivateRawResult}</figcaption>
              <img
                alt={copy.focusPrivateRawResult}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="focus-private-raw-result"
                src={proof.resultReviewDataUrl}
              />
            </figure>
          </div>
          <figure className="h-56 rounded-md border border-white/10 bg-[#15191e] p-3">
            <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.focusPrivateRawExport}</figcaption>
            <img
              alt={copy.focusPrivateRawExport}
              className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
              data-testid="focus-private-raw-export"
              src={proof.exportReviewDataUrl}
            />
          </figure>
        </div>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.focusReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.focusPrivateRawRuntime}</span>
          </div>
          <div
            className="sr-only"
            data-apply-command={copy.focusApplyTool}
            data-artifact-path={proof.stackPath}
            data-command={copy.focusDryRunTool}
            data-export-review-artifact={proof.exportReviewArtifact}
            data-fixture-id={proof.fixtureId}
            data-focus-coverage-ratio={proof.focusCoverageRatio}
            data-halo-risk-cell-ratio={proof.haloRiskCellRatio}
            data-low-confidence-cell-ratio={proof.lowConfidenceCellRatio}
            data-output-pixel-count={proof.outputPixelCount}
            data-preview-artifact={proof.previewArtifact}
            data-result-review-artifact={proof.resultReviewArtifact}
            data-runtime-status="private_raw_app_server_apply"
            data-sharpness-gain-ratio={proof.sharpnessGainRatio}
            data-source-count={proof.sourceCount}
            data-source-coverage-ratio={proof.sourceCoverageRatio}
            data-source-winner-distribution={proof.sourceWinnerDistribution}
            data-transition-artifact-score={proof.transitionArtifactScore}
            data-winner-source-count={proof.winnerSourceCount}
            data-testid="focus-private-raw-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.focusDryRunTool}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="focus-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.focusArtifactHandoff}</p>
              <p className="break-all">{proof.stackPath}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.focusPrivateRawSourceSet}</p>
              <p>{copy.privateRawFrameCount(proof.sourceCount)}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function FocusPrivateRawModalReviewSmoke() {
  const proof = window.__RAWENGINE_FOCUS_PRIVATE_RAW_PROOF__;
  const [settings, setSettings] = useState<FocusStackUiSettings>(DEFAULT_FOCUS_STACK_UI_SETTINGS);
  const [previewRequested, setPreviewRequested] = useState(false);

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }
  const sourceCount = Number.parseInt(proof.sourceCount, 10);
  const lowConfidenceCellRatio = Number.parseFloat(proof.lowConfidenceCellRatio);
  const haloRiskCellRatio = Number.parseFloat(proof.haloRiskCellRatio);
  const sharpnessCoverageRatio = Number.parseFloat(proof.focusCoverageRatio);
  const sourceContributionSummary = proof.sourceWinnerDistribution.split(',').map((entry) => {
    const [sourceIndexValue, winnerCellRatioValue] = entry.split(':');
    return {
      sourceIndex: Number.parseInt(sourceIndexValue ?? '0', 10),
      winnerCellRatio: Number.parseFloat(winnerCellRatioValue ?? '0'),
    };
  });
  const outputReview: FocusStackOutputReviewWorkflow = {
    alignmentMode: settings.alignmentMode,
    artifactPath: proof.stackPath,
    applyReceipt: {
      alignment: {
        mode: settings.alignmentMode,
        status: settings.alignmentMode === 'none' ? 'not_requested' : 'planned',
      },
      artifactHandle: {
        artifactId: proof.stackPath,
        contentHash: proof.stackHash,
        dimensions: {
          height: settings.maxPreviewDimensionPx,
          width: settings.maxPreviewDimensionPx,
        },
        kind: 'merge_output',
        storage: 'sidecar_artifact',
      },
      artifactPath: proof.stackPath,
      outputPreviewDimensions: {
        height: settings.maxPreviewDimensionPx,
        width: settings.maxPreviewDimensionPx,
      },
      receiptId: `focus_stack_apply_visual_${sourceCount}`,
      sharpnessQualitySummary: {
        lowConfidenceCellRatio,
        qualityPreference: settings.qualityPreference,
        sharpnessCoverageRatio,
      },
      sourceCount,
      status: 'review_required',
      warnings: ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'retouch_layer_deferred'],
    },
    blendMethod: settings.blendMethod,
    decision: 'editable_review_required',
    editableHandoff: {
      artifactHash: proof.stackHash,
      artifactId: proof.stackPath,
      exportReviewArtifactId: proof.exportReviewArtifact,
      status: 'review_required',
    },
    haloRiskCellRatio,
    haloReview: {
      artifactId: `${proof.stackPath}:halo-review`,
      reviewStatus: 'review_required',
      transitionRiskRegions: sourceContributionSummary.map((source, sourceIndex) => ({
        cellCount: Math.max(1, Math.round(source.winnerCellRatio * 12)),
        regionId: `focus-private-runtime-${sourceIndex + 1}`,
        risk:
          sourceIndex === 0
            ? 'stable'
            : sourceIndex === 1 && lowConfidenceCellRatio > 0
              ? 'low_confidence'
              : 'halo_risk',
        sourceIndex: source.sourceIndex,
      })),
    },
    lowConfidenceCellRatio,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    retouchLayerPolicy: settings.retouchLayerPolicy,
    reviewOverlay: {
      confidenceMarginThreshold: 0.12,
      mode: settings.reviewOverlayMode,
      opacityPercent: settings.reviewOverlayOpacityPercent,
      sourceContributionDetails: sourceContributionSummary.map((source, sourceIndex) => ({
        artifactId: `artifact_focus_private_source_${source.sourceIndex + 1}_contribution`,
        confidencePercent: Math.max(62, Math.round((1 - lowConfidenceCellRatio) * 100 - sourceIndex * 6)),
        contributionRatio: source.winnerCellRatio,
        coverageCellCount: Math.max(1, Math.round(source.winnerCellRatio * 12)),
        sourceId: `S${source.sourceIndex + 1}`,
        sourceIndex: source.sourceIndex,
        warningState:
          sourceIndex === 0 && lowConfidenceCellRatio === 0 && haloRiskCellRatio === 0
            ? 'clear'
            : 'artifact_review_required',
      })),
      sourceContributionSummary,
    },
    sharpnessCoverageRatio,
    sourceCount,
    sourceRefs: sourceContributionSummary.map((source) => ({
      contentHash: `fnv1a32:focus-private-source-${source.sourceIndex}`,
      graphRevision: `focus_private_source_${source.sourceIndex}`,
      path: `${proof.stackPath}:source-${source.sourceIndex}`,
      sourceIndex: source.sourceIndex,
    })),
    warningCodes: ['human_review_required', 'synthetic_runtime_only', 'transition_halo_risk', 'retouch_layer_deferred'],
  };

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="focus-private-raw-modal-review" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.focusPrivateRawModalReview}
      </div>
      <div
        className="sr-only"
        data-focus-coverage-ratio={proof.focusCoverageRatio}
        data-fixture-id={proof.fixtureId}
        data-halo-risk-cell-ratio={proof.haloRiskCellRatio}
        data-low-confidence-cell-ratio={proof.lowConfidenceCellRatio}
        data-output-pixel-count={proof.outputPixelCount}
        data-preview-requested={String(previewRequested)}
        data-sharpness-gain-ratio={proof.sharpnessGainRatio}
        data-source-count={proof.sourceCount}
        data-source-coverage-ratio={proof.sourceCoverageRatio}
        data-source-winner-distribution={proof.sourceWinnerDistribution}
        data-stack-hash={proof.stackHash}
        data-stack-path={proof.stackPath}
        data-transition-artifact-score={proof.transitionArtifactScore}
        data-winner-source-count={proof.winnerSourceCount}
        data-testid="focus-private-raw-modal-review-proof"
      />
      <FocusStackModal
        isOpen
        loadingImageUrl={proof.previewDataUrl}
        onApplyPlan={() => {}}
        onClose={() => {}}
        onPreviewPlan={() => {
          setPreviewRequested(true);
        }}
        onSettingsChange={setSettings}
        outputReview={outputReview}
        outputReviewArtifactPath={proof.stackPath}
        settings={settings}
        sourceCount={sourceCount}
        sourcePaths={outputReview.sourceRefs.map((source) => source.path)}
      />
    </main>
  );
}

function HdrPrivateRawVisualSmoke() {
  const proof = window.__RAWENGINE_HDR_PRIVATE_RAW_PROOF__;

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]" data-visual-smoke-section="hdr-private-raw">
        <section className="grid grid-rows-[44px_1fr_220px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.hdrPrivateRawReview}
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-3 p-4">
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.hdrPrivateRawBefore}</figcaption>
              <img
                alt={copy.hdrPrivateRawBefore}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="hdr-private-raw-before"
                src={proof.beforeDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.hdrPrivateRawAfter}</figcaption>
              <img
                alt={copy.hdrPrivateRawAfter}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="hdr-private-raw-after"
                src={proof.afterDataUrl}
              />
            </figure>
          </div>
          <figure className="m-4 mt-0 overflow-hidden rounded-md border border-white/10 bg-[#15191e] p-3">
            <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.hdrPrivateRawPreview}</figcaption>
            <img
              alt={copy.hdrPrivateRawPreview}
              className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
              data-testid="hdr-private-raw-preview"
              src={proof.previewDataUrl}
            />
          </figure>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.hdrReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.hdrPrivateRawRuntime}</span>
          </div>
          <div
            className="sr-only"
            data-after-artifact={proof.afterArtifact}
            data-before-artifact={proof.beforeArtifact}
            data-export-artifact={proof.exportArtifact}
            data-fixture-id={proof.fixtureId}
            data-merge-artifact={proof.mergeArtifact}
            data-preview-artifact={proof.previewArtifact}
            data-runtime-status="private_raw_app_server_apply"
            data-source-count={proof.sourceCount}
            data-testid="hdr-private-raw-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.hdrPrivateRawRuntime}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="hdr-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.hdrArtifactHandoff}</p>
              <p className="break-all">{proof.mergeArtifact}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.hdrSourceSet}</p>
              <p>{copy.privateRawFrameCount(proof.sourceCount)}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function SuperResolutionVisualSmoke() {
  const [settings, setSettings] = useState<SuperResolutionUiSettings>(DEFAULT_SUPER_RESOLUTION_UI_SETTINGS);
  const sourcePreflightMetadata: SuperResolutionSourcePreflightMetadata[] = Array.from({ length: 5 }, (_, index) => ({
    exif: {
      ExifImageHeight: '6336',
      ExifImageWidth: '9504',
      ISO: '100',
      LensModel: 'FE 50mm F1.4 GM',
      Make: 'Sony',
      Model: 'ILCE-7RM5',
    },
    height: 6336,
    imagePath: `/private/alaska/sr_dx-${index % 2}_dy-${Math.floor(index / 2)}_${index}.ARW`,
    sourceIndex: index,
    width: 9504,
  }));
  const reviewArtifactPreviewUrls = {
    baseline_review_crop: buildSrReviewPreviewDataUrl('#2f3a42', '#596675', 'Baseline'),
    reconstruction_preview: buildSrReviewPreviewDataUrl('#22384d', '#d6b46e', 'Preview'),
    reconstruction_review_crop: buildSrReviewPreviewDataUrl('#273f38', '#93c47d', 'Crop'),
  };
  const outputReview = buildSuperResolutionOutputReviewWorkflow({
    artifactPath: '/tmp/rawengine-super-resolution-preview-plan-5.tif',
    settings,
    sourceCount: 5,
    sourcePaths: sourcePreflightMetadata.map((source) => source.imagePath),
  });

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.SrUi}
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="sr-modal">
        <div
          className="sr-only"
          data-alignment-mode={settings.alignmentMode}
          data-apply-command={copy.superResolutionApplyTool}
          data-artifact-path={copy.superResolutionArtifactPath}
          data-command={copy.superResolutionDryRunTool}
          data-decision={settings.detailPolicy === 'aggressive_preview_only' ? 'preview_only' : 'human_review_required'}
          data-detail-policy={settings.detailPolicy}
          data-detail-gain-ratio="1.21"
          data-detail-review-highlight-count="3"
          data-detail-review-mean-improvement-ratio="1.18"
          data-detail-review-status="accepted"
          data-estimated-preview-megapixels={Math.round((5 * settings.maxPreviewDimensionPx ** 2) / 1_000_000)}
          data-mode={settings.detailPolicy === 'aggressive_preview_only' ? 'aggressive' : 'conservative'}
          data-mode-policy-version="1"
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-output-scale={settings.outputScale}
          data-proof-level="synthetic_runtime"
          data-quality-preference={settings.qualityPreference}
          data-reconstruction-mode={settings.reconstructionMode}
          data-review-crop-count="4"
          data-review-packet-path="docs/validation/proofs/super-resolution/sr-synthetic-output-artifact-proof-2026-06-20.json"
          data-runtime-status="dry_run_preview"
          data-source-preflight-effective-scale="2"
          data-source-preflight-status="ready"
          data-source-count="5"
          data-warning-codes={
            settings.detailPolicy === 'aggressive_preview_only'
              ? 'human_review_required,synthetic_runtime_only,texture_risk,aggressive_preview_only'
              : 'human_review_required,synthetic_runtime_only,texture_risk'
          }
          data-testid="sr-review-workspace-proof"
        />
        <div
          className="sr-only"
          data-alignment-mode={settings.alignmentMode}
          data-detail-policy={settings.detailPolicy}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-output-scale={settings.outputScale}
          data-quality-preference={settings.qualityPreference}
          data-reconstruction-mode={settings.reconstructionMode}
          data-testid="sr-ui-settings-proof"
        />
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.superResolutionSmoke}
          </span>
        </div>
        <SuperResolutionModal
          isOpen
          lastApplyCommand={{
            acceptedDryRunPlanHash: outputReview.outputArtifactHash,
            acceptedDryRunPlanId: 'super_resolution_plan_5',
            commandType: 'computationalMerge.createSuperResolution',
            dryRun: false,
            sources: 5,
            toolName: getComputationalMergeAppServerRoutePairSummary('super_resolution').applyToolName,
          }}
          lastDryRunCommand={{
            commandType: 'computationalMerge.createSuperResolution',
            dryRun: true,
            sources: 5,
            toolName: getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName,
          }}
          loadingImageUrl={panoramaPreviewUrl}
          onApplyPlan={() => {}}
          onClose={() => {}}
          onPreviewPlan={() => {}}
          outputReview={outputReview}
          reviewArtifactPreviewUrls={reviewArtifactPreviewUrls}
          onSettingsChange={setSettings}
          settings={settings}
          sourcePreflightMetadata={sourcePreflightMetadata}
          sourceCount={5}
        />
        <aside className="fixed right-4 top-14 z-50 w-80 rounded-md border border-white/10 bg-black/75 p-3 text-sm shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{copy.superResolutionReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.superResolutionDryRunPreview}</span>
          </div>
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionDryRunTool}</p>
              <p>{settings.alignmentMode}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionSourceSet}</p>
              <p>{settings.detailPolicy}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2" data-testid="sr-artifact-handoff">
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionArtifactHandoff}</p>
              <p>{copy.superResolutionArtifactPath}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function buildSrReviewPreviewDataUrl(baseColor: string, detailColor: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="${baseColor}"/><path d="M0 188 C58 142 96 167 142 111 C190 54 238 83 320 32 L320 240 L0 240 Z" fill="${detailColor}" opacity="0.78"/><path d="M16 40 H304 M16 80 H304 M16 120 H304 M16 160 H304 M64 16 V224 M128 16 V224 M192 16 V224 M256 16 V224" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/><text x="20" y="220" fill="#f4f1e8" font-family="Arial, sans-serif" font-size="24">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function SuperResolutionPrivateRawVisualSmoke() {
  const proof = window.__RAWENGINE_SR_PRIVATE_RAW_PROOF__;

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]" data-visual-smoke-section="sr-private-raw">
        <div className="flex min-w-0 flex-col gap-3 p-5">
          <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.superResolutionPrivateRawReview}
            </span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] gap-3">
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.superResolutionPrivateRawPreview}</figcaption>
              <img
                alt={copy.superResolutionPrivateRawPreview}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="sr-private-raw-preview"
                src={proof.previewDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.superResolutionPrivateRawResult}</figcaption>
              <img
                alt={copy.superResolutionPrivateRawResult}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="sr-private-raw-result"
                src={proof.resultReviewDataUrl}
              />
            </figure>
          </div>
          <figure className="h-56 rounded-md border border-white/10 bg-[#15191e] p-3">
            <figcaption className="mb-2 text-xs text-[#aab2bd]">{copy.superResolutionPrivateRawExport}</figcaption>
            <img
              alt={copy.superResolutionPrivateRawExport}
              className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
              data-testid="sr-private-raw-export"
              src={proof.exportReviewDataUrl}
            />
          </figure>
        </div>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.superResolutionReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.superResolutionPrivateRawRuntime}</span>
          </div>
          <div
            className="sr-only"
            data-apply-command={copy.superResolutionApplyTool}
            data-artifact-path={proof.reconstructionPath}
            data-command={copy.superResolutionDryRunTool}
            data-detail-gain-ratio={proof.detailGainRatio}
            data-export-review-artifact={proof.exportReviewArtifact}
            data-fixture-id={proof.fixtureId}
            data-output-artifact-score={proof.outputArtifactScore}
            data-output-pixel-count={proof.outputPixelCount}
            data-preview-artifact={proof.previewArtifact}
            data-result-review-artifact={proof.resultReviewArtifact}
            data-runtime-status="private_raw_app_server_apply"
            data-source-coverage-ratio={proof.sourceCoverageRatio}
            data-source-count={proof.sourceCount}
            data-testid="sr-private-raw-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionDryRunTool}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="sr-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionArtifactHandoff}</p>
              <p className="break-all">{proof.reconstructionPath}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.superResolutionSourceSet}</p>
              <p>{copy.privateRawFrameCount(proof.sourceCount)}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function SuperResolutionPrivateRawModalReviewSmoke() {
  const proof = window.__RAWENGINE_SR_PRIVATE_RAW_PROOF__;
  const [settings, setSettings] = useState<SuperResolutionUiSettings>(DEFAULT_SUPER_RESOLUTION_UI_SETTINGS);
  const [previewRequested, setPreviewRequested] = useState(false);

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  const sourceCount = Number.parseInt(proof.sourceCount, 10);
  const outputHeight = Number.parseInt(proof.outputHeight, 10);
  const outputScale = Number.parseFloat(proof.outputScale);
  const outputWidth = Number.parseInt(proof.outputWidth, 10);
  const detailGainRatio = Number.parseFloat(proof.detailGainRatio);
  const sourceCoverageRatio = Number.parseFloat(proof.sourceCoverageRatio);
  const sourcePaths = proof.sourcePaths.split(',');
  const sourceHashes = proof.sourceHashes.split(',');
  const sourceGraphRevision = ['sr_private', proof.fixtureId].join('_');
  const sourceWidths = proof.sourceWidths.split(',').map((width) => Number.parseInt(width, 10));
  const sourceHeights = proof.sourceHeights.split(',').map((height) => Number.parseInt(height, 10));
  const outputReview = {
    alignmentConfidence: null,
    alignmentMode: settings.alignmentMode,
    artifactPath: proof.reconstructionPath,
    cropMetrics: {
      outputHeight,
      outputWidth,
      overlapCoverageRatio: null,
      reviewCropCount: 1,
    },
    downscaleReconstructionError: null,
    decision: 'human_review_required',
    detailGainRatio,
    detailPolicy: settings.detailPolicy,
    detailReview: {
      artifactId: `${proof.reconstructionPath}:detail-review`,
      baselineArtifactId: proof.previewArtifact,
      improvementHighlightCount: 3,
      meanImprovementRatio: detailGainRatio,
      reconstructedArtifactId: proof.reconstructionPath,
      regions: [
        {
          baselineSharpnessScore: 0.55,
          improvementRatio: 1.22,
          label: 'center microcontrast',
          reconstructedSharpnessScore: 0.67,
          regionId: 'center-microcontrast',
          reviewStatus: 'accepted',
        },
        {
          baselineSharpnessScore: 0.47,
          improvementRatio: 1.14,
          label: 'fine edge texture',
          reconstructedSharpnessScore: 0.54,
          regionId: 'fine-edge-texture',
          reviewStatus: 'needs_review',
        },
        {
          baselineSharpnessScore: 0.41,
          improvementRatio: 1.11,
          label: 'low-contrast detail',
          reconstructedSharpnessScore: 0.46,
          regionId: 'low-contrast-detail',
          reviewStatus: 'needs_review',
        },
      ],
      reviewStatus: 'needs_review',
    },
    editableGate: 'blocked_review_required',
    falseDetailRisk: 'unknown',
    falseDetailRiskScore: null,
    humanReviewStatus: 'pending',
    mode: 'conservative',
    modePolicyVersion: 1,
    outputArtifactHash: proof.reconstructionHash,
    outputArtifactId: proof.reconstructionPath,
    outputHeight,
    outputScale,
    outputWidth,
    overlapCoverageRatio: null,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    reconstructionMode: settings.reconstructionMode,
    registrationMetrics: null,
    reviewArtifacts: [
      {
        contentHash: proof.resultReviewHash,
        kind: 'reconstruction_preview',
        path: proof.resultReviewArtifact,
        publicRepoAllowed: false,
      },
    ],
    reviewCropCount: 1,
    reviewPacketPath: proof.privateRunReportPath,
    sourceCount,
    sourceRefs: sourcePaths.map((path, sourceIndex) => ({
      contentHash: sourceHashes[sourceIndex] ?? `fnv1a32:sr-private-${sourceIndex}`,
      graphRevision: sourceGraphRevision,
      path,
      sourceIndex,
    })),
    staleState: 'current',
    supportMap: {
      artifactId: `${proof.reconstructionPath}:support-map`,
      coverageRatio: sourceCoverageRatio,
      downgradeReason: 'effective_scale_downgraded',
      effectiveScale: 1.5,
      regions: [
        {
          coverageRatio: 0.82,
          label: 'center detail',
          regionId: 'center-detail',
          risk: 'supported',
        },
        {
          coverageRatio: 0.61,
          label: 'edge texture',
          regionId: 'edge-texture',
          risk: 'weak_support',
        },
        {
          coverageRatio: 0.38,
          label: 'moving water',
          regionId: 'moving-water',
          risk: 'motion_rejected',
        },
        {
          coverageRatio: 0.44,
          label: 'frame edge',
          regionId: 'frame-edge',
          risk: 'edge_risk',
        },
      ],
      requestedScale: outputScale,
      reviewStatus: 'review_required',
      weakSupportRatio: 0.26,
    },
    warningCodes: ['human_review_required', 'synthetic_runtime_only', 'texture_risk', 'effective_scale_downgraded'],
  } satisfies SuperResolutionOutputReviewWorkflow;
  const sourcePreflightMetadata: SuperResolutionSourcePreflightMetadata[] = sourcePaths.map((imagePath, index) => ({
    exif: {
      ExifImageHeight: proof.sourceHeights.split(',')[index] ?? '',
      ExifImageWidth: proof.sourceWidths.split(',')[index] ?? '',
      ISO: '100',
      LensModel: 'FE 50mm F1.4 GM',
      Make: 'Sony',
      Model: 'ILCE-7RM5',
    },
    height: sourceHeights[index],
    imagePath,
    sourceIndex: index,
    width: sourceWidths[index],
  }));
  const reviewArtifactPreviewUrls = {
    reconstruction_preview: proof.resultReviewDataUrl,
  };

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="sr-private-raw-modal-review" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.superResolutionPrivateRawReview}
      </div>
      <div
        className="sr-only"
        data-fixture-id={proof.fixtureId}
        data-detail-gain-ratio={proof.detailGainRatio}
        data-output-artifact-score={proof.outputArtifactScore}
        data-output-height={proof.outputHeight}
        data-output-pixel-count={proof.outputPixelCount}
        data-output-scale={proof.outputScale}
        data-output-width={proof.outputWidth}
        data-preview-requested={String(previewRequested)}
        data-private-run-report-path={proof.privateRunReportPath}
        data-reconstruction-hash={proof.reconstructionHash}
        data-reconstruction-path={proof.reconstructionPath}
        data-source-coverage-ratio={proof.sourceCoverageRatio}
        data-source-count={proof.sourceCount}
        data-source-hashes={proof.sourceHashes}
        data-source-paths={proof.sourcePaths}
        data-testid="sr-private-raw-modal-review-proof"
      />
      <SuperResolutionModal
        isOpen
        loadingImageUrl={proof.previewDataUrl}
        onApplyPlan={() => {}}
        onClose={() => {}}
        onPreviewPlan={() => {
          setPreviewRequested(true);
        }}
        onSettingsChange={setSettings}
        outputReview={outputReview}
        reviewArtifactPreviewUrls={reviewArtifactPreviewUrls}
        settings={settings}
        sourceCount={sourceCount}
        sourcePreflightMetadata={sourcePreflightMetadata}
      />
    </main>
  );
}

function PanoramaVisualSmoke() {
  const [settings, setSettings] = useState<PanoramaUiSettings>(DEFAULT_PANORAMA_UI_SETTINGS);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.PanoramaUi}
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="panorama-modal">
        <div
          className="sr-only"
          data-apply-command={copy.panoramaApplyTool}
          data-artifact-path={copy.panoramaArtifactPath}
          data-blend-mode={settings.blendMode}
          data-boundary-mode={settings.boundaryMode}
          data-command={copy.panoramaDryRunTool}
          data-estimated-preview-megapixels={Math.round((5 * settings.maxPreviewDimensionPx ** 2) / 1_000_000)}
          data-exposure-mode={settings.exposureMode}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-plan-memory-mb={Math.round(
            panoramaRuntimePlanFixture.preflight.memory_components.total_estimated_peak_bytes / 1_000_000,
          )}
          data-plan-scope="tile_runtime_output"
          data-plan-status={panoramaRuntimePlanFixture.preflight.status}
          data-plan-width={panoramaRuntimePlanFixture.output_dimensions.width}
          data-projection={settings.projection}
          data-quality-preference={settings.qualityPreference}
          data-source-geometry-column-count-estimate={
            panoramaRuntimePlanFixture.preflight.source_geometry?.column_count_estimate
          }
          data-source-geometry-connected-label={
            panoramaRuntimePlanFixture.preflight.source_geometry?.graph_connectivity.is_connected
              ? 'connected'
              : 'disconnected'
          }
          data-source-geometry-layout={panoramaRuntimePlanFixture.preflight.source_geometry?.layout}
          data-source-geometry-row-confidence={
            panoramaRuntimePlanFixture.preflight.source_geometry?.layout_confidence.row_confidence
          }
          data-source-geometry-support={panoramaRuntimePlanFixture.preflight.source_geometry?.support}
          data-source-row-count-estimate={panoramaRuntimePlanFixture.preflight.source_geometry?.row_count_estimate}
          data-runtime-status="dry_run_preview"
          data-seam-exposure-compensation-percent={settings.seamExposureCompensationPercent}
          data-seam-count="4"
          data-source-contribution-count="5"
          data-source-count="5"
          data-source-order={copy.panoramaSourceOrder}
          data-testid="panorama-review-workspace-proof"
        />
        <div
          className="sr-only"
          data-blend-mode={settings.blendMode}
          data-boundary-mode={settings.boundaryMode}
          data-exposure-mode={settings.exposureMode}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-projection={settings.projection}
          data-quality-preference={settings.qualityPreference}
          data-seam-exposure-compensation-percent={settings.seamExposureCompensationPercent}
          data-testid="panorama-ui-settings-proof"
        />
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.panoramaSmoke}
          </span>
        </div>
        <PanoramaModal
          error={null}
          finalImageBase64={null}
          imageCount={5}
          isOpen
          isProcessing={false}
          lastApplyCommand={null}
          lastDryRunCommand={null}
          loadingImageUrl={panoramaPreviewUrl}
          onClose={() => {}}
          onOpenFile={() => {}}
          onSave={() => Promise.resolve('/tmp/panorama.tif')}
          onSettingsChange={setSettings}
          onStitch={() => {}}
          progressMessage={null}
          renderedReview={panoramaRenderedReviewFixture}
          runtimePlan={panoramaRuntimePlanFixture}
          settings={settings}
        />
        <aside className="fixed right-4 top-14 z-50 w-80 rounded-md border border-white/10 bg-black/75 p-3 text-sm shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{copy.panoramaReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.panoramaDryRunPreview}</span>
          </div>
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.panoramaDryRunTool}</p>
              <p>{settings.projection}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.panoramaSourceOrder}</p>
              <p>{settings.blendMode}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2" data-testid="panorama-artifact-handoff">
              <p className="text-xs text-[#aab2bd]">{copy.panoramaArtifactHandoff}</p>
              <p>{copy.panoramaArtifactPath}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function PanoramaSavedReviewVisualSmoke() {
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const outputPath = '/tmp/panorama.tif';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.PanoramaSavedReview}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="panorama-saved-review" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.panoramaSavedReview}
      </div>
      <div className="sr-only" data-opened-path={openedPath ?? ''} data-testid="panorama-saved-review-open-proof" />
      <PanoramaModal
        error={null}
        finalImageBase64={panoramaPreviewUrl}
        imageCount={5}
        isOpen
        isProcessing={false}
        lastApplyCommand={{
          acceptedDryRunPlanHash: 'sha256:panorama-visual-smoke',
          acceptedDryRunPlanId: 'panorama_plan_5',
          commandType: 'computationalMerge.createPanorama',
          dryRun: false,
          sourceCount: 5,
          toolName: getComputationalMergeAppServerRoutePairSummary('panorama').applyToolName,
        }}
        lastDryRunCommand={null}
        loadingImageUrl={panoramaPreviewUrl}
        onClose={() => {}}
        onOpenFile={setOpenedPath}
        onSave={() => Promise.resolve(outputPath)}
        onSettingsChange={() => {}}
        onStitch={() => {}}
        progressMessage={null}
        renderedReview={panoramaRenderedReviewFixture}
        runtimePlan={panoramaRuntimePlanFixture}
        settings={panoramaSavedReviewSmokeSettings}
      />
    </main>
  );
}

function PanoramaProcessingCommandVisualSmoke() {
  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.PanoramaProcessingCommand}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="panorama-processing-command" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.panoramaDryRunCommand}
      </div>
      <PanoramaModal
        error={null}
        finalImageBase64={null}
        imageCount={3}
        isOpen
        isProcessing
        lastApplyCommand={null}
        lastDryRunCommand={{
          appServerToolName: getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName,
          boundaryMode: 'auto_crop',
          commandType: 'computationalMerge.createPanorama',
          dryRun: true,
          maxPreviewDimensionPx: 8192,
          projection: 'rectilinear',
          sourceCount: 3,
        }}
        loadingImageUrl={panoramaPreviewUrl}
        onClose={() => {}}
        onOpenFile={() => {}}
        onSave={() => Promise.resolve('/tmp/panorama.tif')}
        onSettingsChange={() => {}}
        onStitch={() => {}}
        progressMessage="Panorama preflight complete."
        renderedReview={null}
        runtimePlan={panoramaRuntimePlanFixture}
        settings={panoramaSavedReviewSmokeSettings}
      />
    </main>
  );
}

function PanoramaPrivateRawVisualSmoke() {
  const proof = window.__RAWENGINE_PANORAMA_PRIVATE_RAW_PROOF__;
  if (!proof) {
    return (
      <main
        className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi}
      >
        <div className="flex h-screen items-center justify-center">{copy.panoramaPrivateRawMissing}</div>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi}
    >
      <div
        className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]"
        data-visual-smoke-section="panorama-private-raw"
      >
        <section className="grid grid-rows-[44px_1fr_260px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {copy.panoramaPrivateRawReview}
            </span>
          </div>
          <figure className="relative min-h-0 overflow-hidden border-b border-white/10 bg-black">
            <img
              alt={copy.panoramaPrivateRawResultAlt}
              className="h-full w-full object-contain"
              data-testid="panorama-private-raw-result"
              src={proof.resultReviewDataUrl}
            />
            <figcaption className="absolute left-4 top-4 rounded bg-black/75 px-3 py-1 text-xs text-[#d7dce2]">
              {proof.fixtureId}
            </figcaption>
          </figure>
          <div className="grid grid-cols-2 gap-3 p-3">
            <figure className="overflow-hidden rounded border border-white/10 bg-black">
              <img
                alt={copy.panoramaPrivateRawPreviewAlt}
                className="h-full w-full object-contain"
                data-testid="panorama-private-raw-preview"
                src={proof.previewDataUrl}
              />
            </figure>
            <figure className="overflow-hidden rounded border border-white/10 bg-black">
              <img
                alt={copy.panoramaPrivateRawExportAlt}
                className="h-full w-full object-contain"
                data-testid="panorama-private-raw-export"
                src={proof.exportReviewDataUrl}
              />
            </figure>
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.panoramaReview}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.panoramaPrivateRawRuntime}</span>
          </div>
          <div
            className="sr-only"
            data-apply-command={copy.panoramaApplyTool}
            data-artifact-path={proof.panoramaPath}
            data-command={copy.panoramaDryRunTool}
            data-export-review-artifact={proof.exportReviewArtifact}
            data-fixture-id={proof.fixtureId}
            data-preview-artifact={proof.previewArtifact}
            data-result-review-artifact={proof.resultReviewArtifact}
            data-runtime-status="private_raw_app_server_apply"
            data-source-count={proof.sourceCount}
            data-testid="panorama-private-raw-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.panoramaDryRunTool}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="panorama-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.panoramaArtifactHandoff}</p>
              <p className="break-all">{proof.panoramaPath}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.panoramaSourceOrder}</p>
              <p>{copy.privateRawFrameCount(proof.sourceCount)}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function HdrVisualSmoke() {
  const [hdrSettings, setHdrSettings] = useState<HdrMergeUiSettings>(DEFAULT_HDR_MERGE_UI_SETTINGS);
  const bracketPreflight = buildHdrBracketPreflight(hdrVisualSmokeSourceMetadata);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrUi}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="hdr-modal" />
      <div
        className="sr-only"
        data-apply-command={copy.hdrApplyTool}
        data-artifact-path={copy.hdrArtifactPath}
        data-bracket-accepted={bracketPreflight ? String(bracketPreflight.accepted) : ''}
        data-bracket-confidence={bracketPreflight?.detectionConfidence ?? ''}
        data-bracket-method={bracketPreflight?.detectionMethod ?? ''}
        data-bracket-span-ev={bracketPreflight?.bracketSpanEv ?? ''}
        data-bracket-validation={hdrSettings.bracketValidation}
        data-command={copy.hdrDryRunTool}
        data-deghost-confidence-map-visible={String(hdrSettings.deghostConfidenceMapVisible)}
        data-deghost-region-intensity-percent={hdrSettings.deghostRegionIntensityPercent}
        data-deghosting={hdrSettings.deghosting}
        data-estimated-preview-megapixels={Math.round(
          (hdrSettings.selectedSourceIndexes.length * hdrSettings.maxPreviewDimensionPx ** 2) / 1_000_000,
        )}
        data-exposure-weighting-mode={hdrSettings.exposureWeightingMode}
        data-max-preview-dimension-px={hdrSettings.maxPreviewDimensionPx}
        data-merge-strategy={hdrSettings.mergeStrategy}
        data-quality-preference={hdrSettings.qualityPreference}
        data-runtime-status="dry_run_preview"
        data-source-count={hdrSettings.selectedSourceIndexes.length}
        data-testid="hdr-review-workspace-proof"
        data-tone-mapping-preset={hdrSettings.toneMappingPreset}
      />
      <div
        className="sr-only"
        data-deghosting={hdrSettings.deghosting}
        data-deghost-confidence-map-visible={String(hdrSettings.deghostConfidenceMapVisible)}
        data-deghost-region-intensity-percent={hdrSettings.deghostRegionIntensityPercent}
        data-exposure-weighting-mode={hdrSettings.exposureWeightingMode}
        data-max-preview-dimension-px={hdrSettings.maxPreviewDimensionPx}
        data-merge-strategy={hdrSettings.mergeStrategy}
        data-quality-preference={hdrSettings.qualityPreference}
        data-testid="hdr-ui-settings-proof"
        data-tone-map-preview={hdrSettings.toneMapPreview}
        data-tone-mapping-preset={hdrSettings.toneMappingPreset}
      />
      <HdrModal
        error={null}
        finalImageBase64={null}
        imageCount={3}
        isOpen
        isProcessing={false}
        loadingImageUrl={null}
        onClose={() => {}}
        onMerge={() => {}}
        onOpenFile={() => {}}
        onSave={() => Promise.resolve('/tmp/rawengine-hdr-smoke.tif')}
        onSettingsChange={setHdrSettings}
        progressMessage={null}
        settings={hdrSettings}
        sourceMetadata={hdrVisualSmokeSourceMetadata}
      />
      <aside className="fixed right-4 top-14 z-50 w-72 rounded-md border border-white/10 bg-black/75 p-3 text-sm shadow-lg">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">{copy.hdrReview}</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.hdrDryRunPreview}</span>
        </div>
        <div className="space-y-2">
          <div className="rounded border border-white/10 bg-white/5 p-2">
            <p className="text-xs text-[#aab2bd]">{copy.hdrDryRunTool}</p>
            <p>{hdrSettings.deghosting}</p>
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-2" data-testid="hdr-artifact-handoff">
            <p className="text-xs text-[#aab2bd]">{copy.hdrArtifactHandoff}</p>
            <p>{copy.hdrArtifactPath}</p>
          </div>
        </div>
      </aside>
    </main>
  );
}

function HdrSavedOutputEditorPathVisualSmoke() {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const expectedPath = '/tmp/rawengine-hdr-smoke.tif';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrSavedOutputEditorPath}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="hdr-saved-output-editor-path" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.hdrSavedOutputEditorPath}
      </div>
      <div
        className="sr-only"
        data-entered-normal-editor-path={String(openedPath === expectedPath)}
        data-open-callback="handleImageSelect"
        data-opened-path={openedPath ?? ''}
        data-saved-path={savedPath ?? ''}
        data-testid="hdr-saved-output-editor-path-proof"
      />
      <HdrModal
        error={null}
        finalImageBase64={tinyPreviewDataUrl}
        imageCount={3}
        isOpen
        isProcessing={false}
        loadingImageUrl={null}
        onClose={() => {}}
        onMerge={() => {}}
        onOpenFile={setOpenedPath}
        onSave={() => {
          setSavedPath(expectedPath);
          return Promise.resolve(expectedPath);
        }}
        onSettingsChange={() => {}}
        progressMessage={null}
        settings={DEFAULT_HDR_MERGE_UI_SETTINGS}
        sourcePaths={['/proof-roll/DSC_1001.NEF', '/proof-roll/DSC_1002.NEF', '/proof-roll/DSC_1003.NEF']}
      />
    </main>
  );
}

function HdrPrivateRawEditorHandoffVisualSmoke() {
  const proof = window.__RAWENGINE_HDR_PRIVATE_RAW_PROOF__;
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [openedPath, setOpenedPath] = useState<string | null>(null);

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="hdr-private-raw-editor-handoff" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.hdrPrivateRawEditorHandoff}
      </div>
      <div
        className="sr-only"
        data-entered-normal-editor-path={String(openedPath === proof.mergeArtifact)}
        data-fixture-id={proof.fixtureId}
        data-merge-artifact={proof.mergeArtifact}
        data-open-callback="handleImageSelect"
        data-opened-path={openedPath ?? ''}
        data-saved-path={savedPath ?? ''}
        data-source-count={proof.sourceCount}
        data-testid="hdr-private-raw-editor-handoff-proof"
      />
      <HdrModal
        error={null}
        finalImageBase64={proof.previewDataUrl}
        imageCount={Number.parseInt(proof.sourceCount, 10)}
        isOpen
        isProcessing={false}
        loadingImageUrl={null}
        onClose={() => {}}
        onMerge={() => {}}
        onOpenFile={setOpenedPath}
        onSave={() => {
          setSavedPath(proof.mergeArtifact);
          return Promise.resolve(proof.mergeArtifact);
        }}
        onSettingsChange={() => {}}
        progressMessage={null}
        settings={DEFAULT_HDR_MERGE_UI_SETTINGS}
        sourcePaths={[proof.beforeArtifact, proof.afterArtifact, proof.previewArtifact]}
      />
    </main>
  );
}

function NegativeLabVisualSmoke() {
  const [savedPaths, setSavedPaths] = useState<Array<string>>([]);
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const [handoffOrder, setHandoffOrder] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const [thumbnailRequestPath, setThumbnailRequestPath] = useState<string | null>(null);
  const [optOutOpenedPath, setOptOutOpenedPath] = useState<string | null>(null);
  const [optOutRefreshCount, setOptOutRefreshCount] = useState(0);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabWorkspace}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="negative-lab-modal" />
      <NegativeConversionModal
        isOpen
        onClose={() => {}}
        onSave={(nextSavedPaths, handoff) => {
          setSavedPaths(nextSavedPaths);
          void (async () => {
            const defaultOnEvents: string[] = [];
            await handleNegativeConversionEditorHandoff({
              handleImageSelect: (path) => {
                defaultOnEvents.push(`select:${path}`);
                setOpenedPath(path);
              },
              handoff,
              refreshImageList: async () => {
                await Promise.resolve();
                defaultOnEvents.push('refresh');
                setRefreshCount((currentCount) => currentCount + 1);
              },
              requestThumbnails: (paths) => {
                setThumbnailRequestPath(paths[0] ?? null);
              },
              savedPaths: nextSavedPaths,
            });
            setHandoffOrder(defaultOnEvents.join('>'));

            await handleNegativeConversionEditorHandoff({
              handleImageSelect: (path) => {
                setOptOutOpenedPath(path);
              },
              handoff: { openInEditor: false },
              refreshImageList: async () => {
                await Promise.resolve();
                setOptOutRefreshCount((currentCount) => currentCount + 1);
              },
              savedPaths: nextSavedPaths,
            });
          })();
        }}
        targetPaths={[
          '/fixtures/negative-lab/synthetic-color-negative-001.tif',
          '/fixtures/negative-lab/lab-processed-proof-negative-002.jpg',
        ]}
      />
      <div
        className="absolute bottom-4 left-4 z-30 rounded-md border border-white/10 bg-black/70 px-3 py-2 text-xs text-[#f3f4f1]"
        data-handoff-order={handoffOrder}
        data-opened-path={openedPath ?? ''}
        data-opened-positive-in-editor={openedPath !== null && openedPath === savedPaths[0] ? 'true' : 'false'}
        data-opt-out-opened-path={optOutOpenedPath ?? ''}
        data-opt-out-refreshed={optOutRefreshCount > 0 ? 'true' : 'false'}
        data-refresh-before-open={handoffOrder === `refresh>select:${savedPaths[0] ?? ''}` ? 'true' : 'false'}
        data-refresh-count={String(refreshCount)}
        data-started-from-non-target-editor-image="true"
        data-thumbnail-requested={
          thumbnailRequestPath !== null && thumbnailRequestPath === savedPaths[0] ? 'true' : 'false'
        }
        data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof}
      >
        {savedPaths.length > 0 ? savedPaths.join(', ') : NEGATIVE_LAB_NO_SAVED_PATHS_LABEL}
      </div>
    </main>
  );
}

function NegativeLabEditorLayerHandoffVisualSmoke() {
  const savedPositivePath = '/proof-roll/negative-lab/frame_001_Positive.tiff';
  const sourceNegativePath = '/proof-roll/negative-lab/frame_001.CR3';
  const rollSessionId = 'roll_session_negative_lab_visual_smoke';
  const conversionReportId = 'negative_lab_conversion_report_visual_smoke';
  const layer: MaskContainer = {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: 'normal',
    id: 'negative-lab-print-grade',
    invert: false,
    name: 'Print grade',
    opacity: 82,
    subMasks: [],
    visible: true,
  };
  const applied = applyLayerStackCommandBridgeOperation(
    [],
    { layer, type: 'create' },
    {
      graphRevision: 'graph_negative_lab_positive_variant_visual_smoke',
      imagePath: savedPositivePath,
      operationId: 'negative_lab_editor_layer_handoff_visual_smoke',
      sessionId: 'negative_lab_editor_layer_handoff_visual_smoke_session',
    },
  );
  const openedPath = savedPositivePath;
  const layerCreated = applied.sidecar.layers.some((sidecarLayer) => sidecarLayer.id === layer.id);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabEditorLayerHandoff}
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="negative-lab-editor-layer-handoff" />
      <div className="fixed left-4 top-4 z-50 rounded-md border border-white/10 bg-black/75 px-3 py-2 text-sm font-semibold">
        {copy.negativeLabEditorLayerHandoff}
      </div>
      <section className="relative z-10 mx-auto flex min-h-screen max-w-5xl items-center gap-6 px-8">
        <div className="aspect-[4/3] flex-1 overflow-hidden rounded-md border border-white/10 bg-gradient-to-br from-[#342016] via-[#ba8658] to-[#f2ddbf] shadow-2xl">
          <div className="h-full w-full bg-[radial-gradient(circle_at_70%_28%,rgba(255,255,255,0.48),transparent_18%),linear-gradient(120deg,rgba(35,24,18,0.58),transparent_42%)]" />
        </div>
        <aside className="w-80 rounded-md border border-white/10 bg-[#181b20] p-4">
          <p className="text-sm font-semibold text-[#f3f4f1]">{copy.negativeLabEditablePositive}</p>
          <p className="mt-2 break-words text-xs text-[#b8b9b3]">{savedPositivePath}</p>
          <div className="mt-4 rounded border border-white/10 bg-black/30 p-3 text-xs">
            <div className="flex justify-between">
              <span>{copy.negativeLabLayer}</span>
              <span>{layer.name}</span>
            </div>
            <div className="mt-2 flex justify-between">
              <span>{copy.negativeLabOpacity}</span>
              <span>{layer.opacity}%</span>
            </div>
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/30 p-3 text-xs">
            <p className="font-semibold text-[#f3f4f1]">{copy.negativeLabProvenance}</p>
            <div className="mt-2 flex justify-between gap-3">
              <span>{copy.negativeLabSource}</span>
              <span className="break-all text-right">{sourceNegativePath}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>{copy.negativeLabRoll}</span>
              <span className="break-all text-right">{rollSessionId}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>{copy.negativeLabReport}</span>
              <span className="break-all text-right">{conversionReportId}</span>
            </div>
          </div>
        </aside>
      </section>
      <div
        className="sr-only"
        data-conversion-report-id={conversionReportId}
        data-entered-normal-editor-path="true"
        data-layer-command-type={applied.command.commandType}
        data-layer-created={String(layerCreated)}
        data-open-callback="handleImageSelect"
        data-opened-path={openedPath}
        data-roll-session-id={rollSessionId}
        data-saved-path={savedPositivePath}
        data-sidecar-source-image-path={applied.sidecar.sourceImagePath}
        data-source-negative-path={sourceNegativePath}
        data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabEditorLayerHandoffProof}
      />
    </main>
  );
}

function NegativeLabPublicExportReviewSmoke() {
  const proof = window.__RAWENGINE_NEGATIVE_LAB_PUBLIC_EXPORT_PROOF__;

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview}
    >
      <div
        className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]"
        data-visual-smoke-section="negative-lab-public-export-review"
      >
        <section className="grid grid-rows-[44px_1fr] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {NEGATIVE_LAB_PUBLIC_EXPORT_REVIEW_TITLE}
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-3 p-4">
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_LABEL}</figcaption>
              <img
                alt={NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_LABEL}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="negative-lab-public-export-source"
                src={proof.sourceDataUrl}
              />
            </figure>
            <figure className="min-h-0 rounded-md border border-white/10 bg-[#15191e] p-3">
              <figcaption className="mb-2 text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_OUTPUT_LABEL}</figcaption>
              <img
                alt={NEGATIVE_LAB_PUBLIC_EXPORT_OUTPUT_LABEL}
                className="h-[calc(100%-1.5rem)] w-full rounded object-contain"
                data-testid="negative-lab-public-export-output"
                src={proof.outputDataUrl}
              />
            </figure>
          </div>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{NEGATIVE_LAB_PUBLIC_EXPORT_HANDOFF_LABEL}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{proof.outputFormat}</span>
          </div>
          <div
            className="sr-only"
            data-base-fog-sample={proof.baseFogSample}
            data-base-fog-strength={proof.baseFogStrength}
            data-changed-pixel-ratio={proof.changedPixelRatio}
            data-density-weights={proof.densityWeights}
            data-export-plan-id={proof.exportPlanId}
            data-fixture-id={proof.fixtureId}
            data-output-format={proof.outputFormat}
            data-output-path={proof.outputPath}
            data-profile-claim-policy={proof.appliedProfileClaimPolicy}
            data-profile-display-name={proof.appliedProfileDisplayName}
            data-profile-preset-id={proof.appliedProfilePresetId}
            data-profile-provenance-hash={proof.appliedProfileProvenanceHash}
            data-runtime-status={proof.runtimeStatus}
            data-source-path={proof.sourcePath}
            data-testid="negative-lab-public-export-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_RUNTIME_LABEL}</p>
              <p>{proof.runtimeStatus}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_PROFILE_LABEL}</p>
              <p>{proof.appliedProfileDisplayName}</p>
              <p className="mt-1 break-all text-xs text-[#aab2bd]">{proof.appliedProfilePresetId}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_PROFILE_CLAIM_POLICY_LABEL}</p>
              <p>{proof.appliedProfileClaimPolicy}</p>
              <p className="mt-1 break-all text-xs text-[#aab2bd]">{proof.appliedProfileProvenanceHash}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_PATH_LABEL}</p>
              <p className="break-all">{proof.sourcePath}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="negative-lab-public-export-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_HANDOFF_LABEL}</p>
              <p className="break-all">{proof.outputPath}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function NegativeLabRealRawPrivateReviewSmoke() {
  const proof = window.__RAWENGINE_NEGATIVE_LAB_REAL_RAW_PRIVATE_PROOF__;

  if (!proof) {
    return (
      <main
        className="grid h-full min-h-screen place-items-center bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview}
      >
        <p>{copy.missingPrivateRawProofArtifacts}</p>
      </main>
    );
  }

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview}
    >
      <div
        className="grid h-screen grid-cols-[1fr_380px] bg-[#0f1114]"
        data-visual-smoke-section="negative-lab-real-raw-private-review"
      >
        <section className="grid grid-rows-[44px_1fr] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {NEGATIVE_LAB_REAL_RAW_PRIVATE_REVIEW_TITLE}
            </span>
          </div>
          <figure className="min-h-0 p-4">
            <figcaption className="mb-2 text-xs text-[#aab2bd]">
              {NEGATIVE_LAB_REAL_RAW_PRIVATE_OUTPUT_LABEL}
            </figcaption>
            <img
              alt={NEGATIVE_LAB_REAL_RAW_PRIVATE_OUTPUT_LABEL}
              className="h-[calc(100%-1.5rem)] w-full rounded border border-white/10 bg-[#15191e] object-contain p-3"
              data-testid="negative-lab-real-raw-private-output"
              src={proof.outputDataUrl}
            />
          </figure>
        </section>
        <aside className="border-l border-white/10 bg-[#171a1f] p-4 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{NEGATIVE_LAB_REAL_RAW_PRIVATE_REVIEW_TITLE}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{proof.outputFormat}</span>
          </div>
          <div
            className="sr-only"
            data-changed-pixel-ratio={proof.changedPixelRatio}
            data-fixture-id={proof.fixtureId}
            data-input-to-output-mean-abs-delta={proof.inputToOutputMeanAbsDelta}
            data-output-format={proof.outputFormat}
            data-output-path={proof.outputPath}
            data-proof-boundary={proof.proofBoundary}
            data-proof-status={proof.proofStatus}
            data-source-is-raw={proof.sourceIsRaw}
            data-source-path={proof.sourcePath}
            data-testid="negative-lab-real-raw-private-review-proof"
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_RUNTIME_LABEL}</p>
              <p>{proof.proofStatus}</p>
              <p className="mt-1 text-xs text-[#aab2bd]">{proof.proofBoundary}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_REAL_RAW_PRIVATE_METRICS_LABEL}</p>
              <p>
                {NEGATIVE_LAB_REAL_RAW_PRIVATE_CHANGED_PIXELS_LABEL} {proof.changedPixelRatio}
              </p>
              <p>
                {NEGATIVE_LAB_REAL_RAW_PRIVATE_MEAN_DELTA_LABEL} {proof.inputToOutputMeanAbsDelta}
              </p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_SOURCE_PATH_LABEL}</p>
              <p className="break-all">{proof.sourcePath}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="negative-lab-real-raw-private-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{NEGATIVE_LAB_PUBLIC_EXPORT_HANDOFF_LABEL}</p>
              <p className="break-all">{proof.outputPath}</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function FilmLookVisualSmoke() {
  const [adjustments, setAdjustments] = useState<Adjustments>(() => structuredClone(INITIAL_ADJUSTMENTS));
  const handleAdjustmentsChange = (update: Partial<Adjustments> | ((current: Adjustments) => Adjustments)) => {
    setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
  };

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.FilmLookBrowser}
    >
      <div className="grid h-screen grid-cols-[1fr_380px] overflow-hidden">
        <section className="relative min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="film-look-preview">
          <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-5">
            <div className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-gradient-to-br from-[#293c42] via-[#52645f] to-[#d4b173] shadow-2xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_42%_35%,rgba(255,244,215,0.45),transparent_22%),linear-gradient(170deg,transparent_42%,rgba(12,31,37,0.72)_43%)]" />
            </div>
            <div
              className="grid grid-cols-5 gap-2 rounded-md border border-white/10 bg-black/45 p-3 text-sm"
              data-testid="film-look-adjustment-proof"
            >
              <span>{formatSmokeMetric(filmSmokeMetricLabels.temperature, adjustments.temperature)}</span>
              <span>{formatSmokeMetric(filmSmokeMetricLabels.contrast, adjustments.contrast)}</span>
              <span>{formatSmokeMetric(filmSmokeMetricLabels.highlights, adjustments.highlights)}</span>
              <span>{formatSmokeMetric(filmSmokeMetricLabels.grain, adjustments.grainAmount)}</span>
            </div>
            <div
              className="rounded-md border border-white/10 bg-black/45 p-3 text-xs text-[#cdd4cc]"
              data-testid="film-look-rendered-proof"
            >
              <div className="mb-2 flex items-center justify-between gap-3 text-[#f3f4f1]">
                <span className="font-medium">{FILM_LOOK_PARITY_TITLE}</span>
                <span>{FILM_LOOK_PARITY_FIXTURE_LABEL}</span>
              </div>
              <div className="grid gap-1">
                {filmLookParityProofCases.map((proofCase) => (
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2" key={proofCase.displayName}>
                    <span>{proofCase.displayName}</span>
                    <span>{formatFilmLookParityDelta(proofCase.maxDelta)}</span>
                    <span>{proofCase.previewHash}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <aside
          className="overflow-y-auto border-l border-white/10 bg-[#15181c] p-3"
          data-visual-smoke-section="film-look-browser"
        >
          <EffectsPanel
            adjustments={adjustments}
            appSettings={null}
            handleLutSelect={() => {}}
            isForMask={false}
            setAdjustments={handleAdjustmentsChange}
          />
        </aside>
      </div>
    </main>
  );
}

function ColorRangeLocalAdjustmentVisualSmoke() {
  const receipt = {
    afterPreviewHash: 'fnv1a32:5b448470',
    beforePreviewHash: 'fnv1a32:0d18f3b4',
    colorMath: 'encoded_rgb_hsv_rec709_luma_v1',
    commandType: 'layerMask.createRangeMask',
    contentHash: 'fnv1a32:7ad02c1e',
    graphRevision: 'history_0_layer_stack_color_range_local',
    maskCoverage: 0.46875,
    maskId: 'color_range_orange_mask',
    range: 'oranges',
  };

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ColorRangeLocalAdjustment}
    >
      <div className="grid h-screen grid-cols-[1fr_380px] overflow-hidden bg-[#0f1114]">
        <section className="relative p-8" data-visual-smoke-section="color-range-local-preview">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-[#9ba6b2]">{copy.colorRangeWorkspaceLabel}</p>
              <h1 className="text-lg font-semibold">{copy.colorRangeLocalAdjustment}</h1>
            </div>
            <span className="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#cbd5df]">
              {receipt.commandType}
            </span>
          </div>
          <div className="relative h-[calc(100%-4rem)] overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,#172125,#31504d_38%,#b77734_70%,#f3d0a2)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_34%,rgba(255,222,176,0.75),transparent_16%),radial-gradient(circle_at_66%_52%,rgba(244,129,45,0.58),transparent_18%),linear-gradient(110deg,transparent_50%,rgba(19,38,45,0.52)_51%)]" />
            <div className="absolute left-[48%] top-[22%] h-[330px] w-[230px] rotate-6 rounded-full border border-orange-200/50 bg-orange-400/25 shadow-[0_0_0_999px_rgba(11,14,18,0.22)]" />
            <div className="absolute left-[52%] top-[30%] h-[230px] w-[150px] rotate-6 rounded-full bg-orange-300/35 blur-[2px]" />
            <div className="absolute bottom-8 left-8 grid gap-1 rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-[#d8dee8]">
              <span>{copy.colorRangeLayerSummary}</span>
              <span>{copy.colorRangeAdjustmentSummary}</span>
              <span>
                {copy.colorRangeOverlayLabel} {Math.round(receipt.maskCoverage * 100)}
                {copy.colorRangeOverlayCoverageSuffix}
              </span>
            </div>
          </div>
        </section>
        <aside
          className="border-l border-white/10 bg-[#171a1f] p-4 text-sm"
          data-visual-smoke-section="color-range-local-receipt"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.colorRangeReceiptTitle}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.colorRangeReplayReady}</span>
          </div>
          <div
            className="sr-only"
            data-after-preview-hash={receipt.afterPreviewHash}
            data-before-preview-hash={receipt.beforePreviewHash}
            data-color-math={receipt.colorMath}
            data-command-type={receipt.commandType}
            data-content-hash={receipt.contentHash}
            data-graph-revision={receipt.graphRevision}
            data-mask-coverage={receipt.maskCoverage}
            data-mask-id={receipt.maskId}
            data-range={receipt.range}
            data-testid="color-range-local-adjustment-proof"
          />
          <div className="space-y-2">
            {[
              ['Source range', receipt.range],
              ['Mask content hash', receipt.contentHash],
              ['Graph revision', receipt.graphRevision],
              ['Preview hashes', `${receipt.beforePreviewHash} -> ${receipt.afterPreviewHash}`],
            ].map(([label, value]) => (
              <div className="rounded border border-white/10 bg-white/5 p-2" key={label}>
                <p className="text-xs text-[#aab2bd]">{label}</p>
                <p className="break-all">{value}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ColorWorkflowVisualSmoke() {
  const [adjustments, setAdjustments] = useState<Adjustments>(() => ({
    ...structuredClone(INITIAL_ADJUSTMENTS),
    saturation: -6,
    temperature: 18,
    tint: -9,
    vibrance: 14,
  }));
  const [isWbPickerActive, setIsWbPickerActive] = useState(false);
  const isCompactViewport = typeof window !== 'undefined' && window.innerWidth < 700;
  const handleAdjustmentsChange = (update: Partial<Adjustments> | ((current: Adjustments) => Adjustments)) => {
    setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
  };
  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ColorWorkflow}
    >
      <div
        className="grid h-screen overflow-hidden"
        style={{ gridTemplateColumns: isCompactViewport ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 280px' }}
      >
        <section
          className={cx('relative min-w-0 bg-[#0f1114] p-6', isCompactViewport && 'hidden')}
          data-visual-smoke-section="color-workflow-preview"
        >
          <div className="mx-auto flex h-full max-w-4xl flex-col justify-center">
            <div className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,#182629,#435b5a_42%,#c79c63_72%,#f4d6a1)] shadow-2xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_38%_32%,rgba(255,246,219,0.48),transparent_20%),linear-gradient(170deg,transparent_45%,rgba(24,43,50,0.72)_46%)]" />
            </div>
          </div>
        </section>
        <aside
          className={cx('min-w-0 overflow-y-auto bg-[#15181c] p-3', !isCompactViewport && 'border-l border-white/10')}
          data-visual-smoke-section="color-workflow-panel"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">{copy.colorWorkflow}</span>
          </div>
          <ColorPanel
            adjustments={adjustments}
            appSettings={null}
            isWbPickerActive={isWbPickerActive}
            setAdjustments={handleAdjustmentsChange}
            toggleWbPicker={() => {
              setIsWbPickerActive((isActive) => !isActive);
            }}
          />
        </aside>
      </div>
    </main>
  );
}

function VisualSmokeApp({ mode }: VisualSmokeAppProps) {
  if (isVisualSmokeComponentMode(mode)) {
    const ScenarioComponent = visualSmokeComponents[mode];
    return <ScenarioComponent />;
  }

  const scenario = mode === VISUAL_SMOKE_SCENARIO_IDS.EmptyLibrary ? 'Empty Library Startup' : 'Editor Shell Smoke';

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={mode}
    >
      <div className="grid h-screen grid-rows-[44px_1fr_104px] overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-2" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-[#ef6a5b]" />
              <span className="h-3 w-3 rounded-full bg-[#f2be4e]" />
              <span className="h-3 w-3 rounded-full bg-[#57c96f]" />
            </div>
            <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
              {scenario}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#aab2bd]">
            <CircleGauge size={15} />
            <span>{copy.harness}</span>
          </div>
        </header>

        <section className="grid min-h-0 grid-cols-[260px_1fr_316px]" data-visual-smoke-section="workspace">
          <aside className="border-r border-white/10 bg-[#15181c] p-3">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-sm font-semibold">{copy.library}</h1>
              <FolderOpen size={16} className="text-[#78d4ff]" />
            </div>
            <div className="space-y-2 text-sm">
              {['Macintosh HD / Pictures', 'Client Selects', 'Film Tests', 'Panorama Sets'].map((folder, index) => (
                <div
                  className={`flex items-center justify-between rounded-md px-3 py-2 ${
                    index === 1 ? 'bg-[#24303a] text-white' : 'text-[#aab2bd] hover:bg-white/5'
                  }`}
                  key={folder}
                >
                  <span>{folder}</span>
                  <span className="text-xs text-[#6f7a86]">{index === 1 ? '42' : '0'}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-md border border-dashed border-[#3b4754] bg-[#101317] p-4 text-sm text-[#aab2bd]">
              <p className="font-medium text-[#f3f4f1]">{copy.importReady}</p>
              <p className="mt-1 text-xs leading-5">{copy.importDescription}</p>
            </div>
          </aside>

          <section className="relative min-w-0 bg-[#0f1114] p-5" data-visual-smoke-section="viewer">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{copy.editorPreview}</h2>
                <p className="text-sm text-[#8d97a3]">{copy.editorDescription}</p>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#cbd5df]">
                <Camera size={15} />
                <span>{copy.screenshotTarget}</span>
              </div>
            </div>

            <div className="grid h-[calc(100%-4rem)] place-items-center rounded-md border border-white/10 bg-[#171a1f]">
              <div className="relative h-[66%] w-[72%] overflow-hidden rounded-md border border-white/10 bg-gradient-to-br from-[#1d2b2f] via-[#25323d] to-[#4c3244] shadow-2xl">
                <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/18 to-transparent" />
                <div className="absolute bottom-8 left-10 h-28 w-40 rounded-full bg-[#e8d08a]/60 blur-2xl" />
                <div className="absolute right-12 top-16 h-48 w-24 rounded-full bg-[#78d4ff]/35 blur-2xl" />
                <div className="absolute inset-x-8 bottom-8 h-20 rounded bg-black/20" />
                <div className="absolute bottom-12 left-12 right-12 grid grid-cols-4 gap-3">
                  {scopes.map(([label, value]) => (
                    <div className="rounded bg-black/35 px-3 py-2" key={label}>
                      <p className="text-xs text-[#aab2bd]">{label}</p>
                      <p className="text-lg font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <aside className="border-l border-white/10 bg-[#15181c] p-3" data-visual-smoke-section="adjustments">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{copy.adjustments}</h2>
              <SlidersHorizontal size={16} className="text-[#c7f36d]" />
            </div>
            <div className="space-y-3">
              {adjustmentGroups.map((group) => (
                <div className="rounded-md border border-white/10 bg-[#1b2026] p-3" key={group.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span>{group.label}</span>
                    <span className="text-[#aab2bd]">{group.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-black/30">
                    <div className="h-full rounded bg-[#78d4ff]" style={{ width: group.width }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-white/10 bg-[#20252b] p-3">
                <Layers3 size={16} className="mb-2 text-[#f2be4e]" />
                <p className="text-sm font-medium">{copy.layerStack}</p>
                <p className="text-xs text-[#8d97a3]">{copy.activeLayerCount}</p>
              </div>
              <div className="rounded-md border border-white/10 bg-[#20252b] p-3">
                <Sparkles size={16} className="mb-2 text-[#ff91c8]" />
                <p className="text-sm font-medium">{copy.filmLook}</p>
                <p className="text-xs text-[#8d97a3]">{copy.filmPreset}</p>
              </div>
            </div>
          </aside>
        </section>

        <footer
          className="grid grid-cols-3 gap-3 border-t border-white/10 bg-[#181b1f] p-3"
          data-visual-smoke-section="filmstrip"
        >
          {filmstripFrames.map((frame) => (
            <div
              className="flex min-w-0 items-center gap-3 rounded-md border border-white/10 bg-[#20252b] p-2"
              key={frame.name}
            >
              <div className={`h-16 w-20 shrink-0 rounded bg-gradient-to-br ${frame.tone}`} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{frame.name}</p>
                <p className="text-xs text-[#8d97a3]">{copy.frameStatus(frame.rating)}</p>
              </div>
            </div>
          ))}
        </footer>
      </div>
    </main>
  );
}

export default VisualSmokeApp;
