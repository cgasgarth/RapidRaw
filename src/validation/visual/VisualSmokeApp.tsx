import { Camera, CircleGauge, FolderOpen, Layers3, SlidersHorizontal, Sparkles } from 'lucide-react';
import { type ReactElement, useState } from 'react';

import { VISUAL_SMOKE_PROOF_TEST_IDS, VISUAL_SMOKE_SCENARIO_IDS, type VisualSmokeMode } from './visualSmokeScenarios';
import ColorPanel from '../../components/adjustments/Color';
import DetailsPanel from '../../components/adjustments/Details';
import EffectsPanel from '../../components/adjustments/Effects';
import CommandPaletteModal from '../../components/modals/CommandPaletteModal';
import FocusStackModal from '../../components/modals/FocusStackModal';
import HdrModal from '../../components/modals/HdrModal';
import { NegativeConversionModal } from '../../components/modals/NegativeConversionModal';
import PanoramaModal from '../../components/modals/PanoramaModal';
import SuperResolutionModal from '../../components/modals/SuperResolutionModal';
import ImageCanvas from '../../components/panel/editor/ImageCanvas';
import AgentChatShell from '../../components/panel/right/AgentChatShell';
import { MaskOverlayReviewControls } from '../../components/panel/right/MaskOverlayReviewControls';
import { Mask, SubMaskMode, ToolType, type SubMask } from '../../components/panel/right/Masks';
import RightPanelSwitcher from '../../components/panel/right/RightPanelSwitcher';
import { Panel, type BrushSettings, type SelectedImage } from '../../components/ui/AppProperties';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS, type FocusStackUiSettings } from '../../schemas/focusStackUiSchemas';
import { DEFAULT_HDR_MERGE_UI_SETTINGS, type HdrMergeUiSettings } from '../../schemas/hdrMergeUiSchemas';
import {
  DEFAULT_PANORAMA_UI_SETTINGS,
  type PanoramaRuntimePlan,
  type PanoramaUiSettings,
} from '../../schemas/panoramaUiSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../../schemas/superResolutionUiSchemas';
import { useUIStore } from '../../store/useUIStore';
import { INITIAL_ADJUSTMENTS, type Adjustments, type MaskContainer } from '../../utils/adjustments';
import { agentChatTranscriptFixture } from '../../utils/agentChatTranscriptFixture';
import { applyColorBalanceRgbToPixel } from '../../utils/colorBalanceRgbRuntime';
import { getComputationalMergeAppServerRoutePairSummary } from '../../utils/computationalMergeAppServerRoutePairs';
import { DETAIL_OUTPUT_COMPARISON_VISUAL_PROOF } from '../../utils/detailOutputComparisonProof';
import { buildHdrBracketPreflight, type HdrBracketPreflightSourceMetadata } from '../../utils/hdrBracketPreflight';
import { applySkinToneUniformityToRgbPixel } from '../../utils/skinToneUniformity';

import type { FocusStackOutputReviewWorkflow } from '../../schemas/focusStackOutputReviewSchemas';
import type { MaskOverlaySettings } from '../../schemas/maskOverlaySchemas';
import type { SuperResolutionOutputReviewWorkflow } from '../../schemas/superResolutionOutputReviewSchemas';
import type { SuperResolutionSourcePreflightMetadata } from '../../utils/superResolutionSourcePreflight';

interface VisualSmokeAppProps {
  mode: string;
}

interface SrPrivateRawVisualProof {
  exportReviewArtifact: string;
  exportReviewDataUrl: string;
  exportReviewHash: string;
  fixtureId: string;
  outputHeight: string;
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
  previewArtifact: string;
  previewDataUrl: string;
  resultReviewArtifact: string;
  resultReviewDataUrl: string;
  sourceCount: string;
  stackHash: string;
  stackPath: string;
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
  exportArtifact: string;
  fixtureId: string;
  metricCount: string;
  refineCommandType?: string;
  refinedPreviewArtifact: string;
  refinedPreviewDataUrl: string;
  unmaskedPreviewArtifact: string;
  unmaskedPreviewDataUrl: string;
  unrefinedPreviewArtifact: string;
  unrefinedPreviewDataUrl: string;
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

const visualSmokeComponents = {
  [VISUAL_SMOKE_SCENARIO_IDS.AgentChatUi]: AgentChatVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.BrushMaskCanvasUi]: BrushMaskCanvasVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.ColorWorkflow]: ColorWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.CommandPaletteWorkflows]: CommandPaletteWorkflowSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.DetailDustSpot]: DetailDustSpotVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.DetailWorkspace]: DetailWorkspaceVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FilmLookBrowser]: FilmLookVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawModalReview]: FocusPrivateRawModalReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusPrivateRawUi]: FocusPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.FocusUi]: FocusStackVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawEditorHandoff]: HdrPrivateRawEditorHandoffVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrPrivateRawUi]: HdrPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrSavedOutputEditorPath]: HdrSavedOutputEditorPathVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.HdrUi]: HdrVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LayerMaskPrivateRawUi]: LayerMaskPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LayerStackWorkflow]: LayerStackWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.LibraryWorkflow]: LibraryWorkflowVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.MaskOverlayRawProof]: MaskOverlayRawProofVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabPublicExportReview]: NegativeLabPublicExportReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabRealRawPrivateReview]: NegativeLabRealRawPrivateReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.NegativeLabWorkspace]: NegativeLabVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaPrivateRawUi]: PanoramaPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaSavedReview]: PanoramaSavedReviewVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.PanoramaUi]: PanoramaVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawModalReview]: SuperResolutionPrivateRawModalReviewSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrPrivateRawUi]: SuperResolutionPrivateRawVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.SrUi]: SuperResolutionVisualSmoke,
  [VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail]: WorkflowRailVisualSmoke,
} satisfies Partial<Record<VisualSmokeMode, () => ReactElement>>;
type VisualSmokeComponentMode = keyof typeof visualSmokeComponents;

const isVisualSmokeComponentMode = (mode: string): mode is VisualSmokeComponentMode => mode in visualSmokeComponents;

const agentChatSmokeTitle = 'Agent chat UI smoke';
const agentChatSmokeRuntime = 'UI-only';
const workflowRailDensityTitle = 'Workflow rail density';
const workflowRailRuntime = 'UI polish';
const workflowRailTargetProof = 'Fixed 36px icon targets keep the rail compact without changing panel order.';
const workflowRailActivePanelLabel = 'Active panel';
const workflowRailNoPanelLabel = 'none';

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
                brushSettings={brushMaskCanvasBrushSettings}
                crop={null}
                cursorStyle="crosshair"
                finalPreviewUrl={brushMaskCanvasImageDataUrl}
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
                isMaskControlHovered={false}
                isMasking
                isMaxZoom={false}
                isRotationActive={false}
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
            data-stroke-count={lines.length}
            data-testid="brush-mask-canvas-ui-proof"
            data-tool-order={toolOrder}
          />
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">{copy.runtimeProof}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{copy.strokeCount(lines.length)}</span>
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

function WorkflowRailVisualSmoke() {
  const [activePanel, setActivePanel] = useState<Panel | null>(Panel.Adjustments);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.WorkflowRail}
    >
      <div className="grid h-screen grid-cols-[1fr_360px] bg-[#0f1114]" data-visual-smoke-section="workflow-shell">
        <section className="flex min-w-0 items-center justify-center border-r border-white/10 bg-[#121518] p-10">
          <div className="aspect-[4/3] w-full max-w-4xl rounded-md border border-white/10 bg-gradient-to-br from-[#29333b] via-[#677565] to-[#d7b078] shadow-2xl" />
        </section>

        <aside className="grid grid-cols-[42px_1fr] bg-[#171a1f]" data-visual-smoke-section="workflow-rail">
          <RightPanelSwitcher activePanel={activePanel} isInstantTransition={true} onPanelSelect={setActivePanel} />
          <div className="border-l border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">{workflowRailDensityTitle}</span>
              <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
                {workflowRailRuntime}
              </span>
            </div>
            <div className="space-y-2 text-xs text-[#aab2bd]">
              <div className="rounded-md border border-white/10 bg-white/5 p-3">{workflowRailTargetProof}</div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                {workflowRailActivePanelLabel}: {activePanel ?? workflowRailNoPanelLabel}
              </div>
            </div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <RightPanelSwitcher
                activePanel={activePanel}
                isInstantTransition={true}
                layout="horizontal"
                onPanelSelect={setActivePanel}
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function AgentChatVisualSmoke() {
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
    previewHash: 'ce1b5b9dfc974109',
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
  blend: string;
  groupId?: string;
  groupName?: string;
  mask: string;
  name: string;
  opacity: number;
  visible: boolean;
}

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
                    ? 'border-red-200 bg-red-500/25 shadow-[0_0_18px_rgba(248,113,113,0.55)]'
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
  pointCounts: 'Point counts',
  runtimeProof: 'Runtime proof',
  strokeCount: (count: number) => `${count} strokes`,
  toolOrder: 'Tool order',
  commandPaletteSmoke: 'Command Palette Workflows',
  filmLook: 'Film look',
  filmPreset: 'Neutral 400',
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
  layerWorkflowTitle: 'Local Adjustment Stack',
  layerMoveDown: 'Move down',
  layerToggle: 'Toggle',
  layerAdd: 'Add layer',
  layerDuplicate: 'Duplicate layer',
  layerRenameProof: 'Rename proof',
  layerOpacity64: 'Opacity 64%',
  layerBlendOverlay: 'Blend overlay',
  layerCollapseGroup: 'Collapse group',
  layerCreateGroup: 'Create group',
  layerGroupCount: (count: number) => `${count} layers`,
  layerGroupingActive: 'Group Local polish / {{count}} layers',
  layerLocalPolish: 'Local polish',
  layeredPreview: 'Layered preview',
  layerWorkflowDescription: 'Mask, blend, opacity, and order state captured in one smoke path.',
  layerVisibleCount: (count: number) => `${count} visible`,
  layerRuntimeEvidence: 'Runtime evidence',
  layerMaskPrivateRawReview: 'Private RAW layer mask review',
  layerMaskPrivateRawRuntime: 'Private RAW runtime',
  layerMaskPrivateRawUnmasked: 'Unmasked RAW preview',
  layerMaskPrivateRawUnrefined: 'Unrefined mask preview',
  layerMaskPrivateRawRefined: 'Refined mask preview',
  layerMaskPrivateRawExport: 'TIFF export handoff',
  layerMaskPrivateRawMetricCount: (count: string) => `${count} metrics`,
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
  hdrDryRunPreview: 'Dry-run preview',
  hdrArtifactHandoff: 'Artifact handoff',
  hdrApplyTool: getComputationalMergeAppServerRoutePairSummary('hdr').applyToolName,
  hdrDryRunTool: getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName,
  hdrArtifactPath: '/tmp/rawengine-hdr-smoke.tif',
  hdrSourceSet: 'HDR bracket',
  libraryRating: (rating: number) => `Rating ${rating}`,
  libraryStars: (rating: number) => `${rating} stars`,
  libraryColorLabel: (label: string) => `Color label ${label}`,
  selectionState: 'Selection State',
  filter: 'Filter',
  virtualCopy: 'Virtual copy',
  repeatableProof: 'Repeatable proof',
  allSessionFiles: 'All session files',
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
              className="flex w-full items-center justify-between rounded-md border border-[#6da7d8]/40 bg-[#1d2b35] px-3 py-2 text-left text-sm hover:bg-[#243746]"
              onClick={() => {
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
  const [viewMode, setViewMode] = useState<'compare' | 'survey'>('compare');
  const [virtualCopyId, setVirtualCopyId] = useState('pending');
  const [isCompareReady, setIsCompareReady] = useState(false);
  const visibleAssets =
    filterMode === 'keepers' ? libraryWorkflowAssets.filter((asset) => asset.rating >= 4) : libraryWorkflowAssets;
  const activeAsset = libraryWorkflowAssets[1];
  const selectedCount = visibleAssets.filter((asset) => asset.rating >= 4).length;

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
            data-minimum-rating={filterMode === 'keepers' ? '4' : '0'}
            data-selected-count={String(selectedCount)}
            data-sidecar-separation={isCompareReady ? 'independent' : 'pending'}
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
                  <span>{copy.libraryStars(asset.rating)}</span>
                </div>
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
            data-collapsed-group-count={String(collapsedGroupIds.length)}
            data-grouping-state={groupedLayerCount > 0 ? 'active' : 'ungrouped'}
            data-grouped-layer-count={String(groupedLayerCount)}
            data-layer-count={String(layers.length)}
            data-mask={selectedLayerState.mask}
            data-opacity={String(selectedLayerState.opacity)}
            data-testid="layer-stack-workflow-proof"
            data-visible-count={String(visibleLayerCount)}
          >
            {groupedLayerCount > 0 && (
              <button
                className="w-full rounded-md border border-[#f2be4e]/40 bg-[#2c2a20] px-3 py-2 text-left text-sm text-white"
                data-collapsed={String(localPolishCollapsed)}
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
                updateSelectedLayer({ blend: 'overlay' });
              }}
              type="button"
            >
              {copy.layerBlendOverlay}
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
  output_dimensions: { height: 3200, width: 9600 },
  preflight: {
    blocked_reasons: [],
    engine_capabilities: {
      full_frame_legacy: true,
      max_preview_dimension_px: 8192,
      plan_only: true,
      tile_backed_render: false,
    },
    execution_mode: 'full_frame_legacy',
    geometry_estimate: {
      output_pixel_count: 30_720_000,
      projected_bounds: { height: 3200, width: 9600, x: 0, y: 0 },
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
    status: 'accepted',
    tile_count: 1,
    warning_codes: ['geometry_estimate_low_confidence', 'legacy_full_frame_render'],
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
const formatRgbTriplet = ({ blue, green, red }: { blue: number; green: number; red: number }) =>
  `R ${Math.round(red * 255)} / G ${Math.round(green * 255)} / B ${Math.round(blue * 255)}`;
const colorSmokeMetricLabels = {
  channelMixer: 'CM',
  colorBalance: 'CB',
  saturation: 'Sat',
  skinTone: 'Skin',
  temperature: 'Temp',
} as const;
const skinToneProof = applySkinToneUniformityToRgbPixel(
  { blue: 0.34, green: 0.45, red: 0.72 },
  {
    hueUniformity: 0.5,
    luminanceUniformity: 0.4,
    saturationUniformity: 0.5,
    targetHueDegrees: 20,
    targetLuminance: 0.61,
    targetSaturation: 0.34,
  },
);
const skinToneOutputRed = skinToneProof.outputRgb.red.toFixed(3);

function CommandPaletteWorkflowSmoke() {
  const [isOpen, setIsOpen] = useState(true);
  const focusOpen = useUIStore((state) => state.focusStackModalState.isOpen);
  const hdrOpen = useUIStore((state) => state.hdrModalState.isOpen);
  const negativeOpen = useUIStore((state) => state.negativeModalState.isOpen);
  const panoramaOpen = useUIStore((state) => state.panoramaModalState.isOpen);
  const srOpen = useUIStore((state) => state.superResolutionModalState.isOpen);

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

function FocusStackVisualSmoke() {
  const [settings, setSettings] = useState<FocusStackUiSettings>(DEFAULT_FOCUS_STACK_UI_SETTINGS);

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
          data-halo-risk-cell-ratio="0.14"
          data-halo-policy="flattened_preview"
          data-low-confidence-cell-ratio="0.08"
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
          loadingImageUrl={panoramaPreviewUrl}
          onClose={() => {}}
          onPreviewPlan={() => {}}
          onSettingsChange={setSettings}
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
            data-export-artifact={proof.exportArtifact}
            data-fixture-id={proof.fixtureId}
            data-brush-command-type={proof.brushCommandType ?? 'layerMask.createBrushMask'}
            data-metric-count={proof.metricCount}
            data-refine-command-type={proof.refineCommandType ?? 'layerMask.refineMask'}
            data-refined-preview-artifact={proof.refinedPreviewArtifact}
            data-runtime-status="private_raw_tauri_runtime_proof"
            data-testid="layer-mask-private-raw-review-proof"
            data-unmasked-preview-artifact={proof.unmaskedPreviewArtifact}
            data-unrefined-preview-artifact={proof.unrefinedPreviewArtifact}
          />
          <div className="space-y-2">
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawRuntime}</p>
              <p>{proof.fixtureId}</p>
            </div>
            <div className="rounded border border-white/10 bg-white/5 p-2">
              <p className="text-xs text-[#aab2bd]">{copy.layerRuntimeEvidence}</p>
              <p>{copy.layerMaskPrivateRawMetricCount(proof.metricCount)}</p>
            </div>
            <div
              className="rounded border border-white/10 bg-white/5 p-2"
              data-testid="layer-mask-private-raw-artifact-handoff"
            >
              <p className="text-xs text-[#aab2bd]">{copy.layerMaskPrivateRawExport}</p>
              <p className="break-all">{proof.exportArtifact}</p>
            </div>
          </div>
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
            data-preview-artifact={proof.previewArtifact}
            data-result-review-artifact={proof.resultReviewArtifact}
            data-runtime-status="private_raw_app_server_apply"
            data-source-count={proof.sourceCount}
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
  const outputReview: FocusStackOutputReviewWorkflow = {
    alignmentMode: settings.alignmentMode,
    artifactPath: proof.stackPath,
    blendMethod: settings.blendMethod,
    decision: 'editable_review_required',
    editableHandoff: {
      artifactHash: proof.stackHash,
      artifactId: proof.stackPath,
      exportReviewArtifactId: proof.exportReviewArtifact,
      status: 'review_required',
    },
    haloRiskCellRatio: 0.18,
    haloReview: {
      artifactId: `${proof.stackPath}:halo-review`,
      reviewStatus: 'review_required',
      transitionRiskRegions: [
        { cellCount: 2, regionId: 'near-flower-edge', risk: 'halo_risk', sourceIndex: 0 },
        { cellCount: 1, regionId: 'mid-stem-transition', risk: 'low_confidence', sourceIndex: 1 },
        { cellCount: 1, regionId: 'far-background', risk: 'stable', sourceIndex: 2 },
      ],
    },
    lowConfidenceCellRatio: 0.12,
    proofLevel: 'synthetic_runtime',
    qualityPreference: settings.qualityPreference,
    retouchLayerPolicy: settings.retouchLayerPolicy,
    reviewOverlay: {
      confidenceMarginThreshold: 0.12,
      mode: settings.reviewOverlayMode,
      opacityPercent: settings.reviewOverlayOpacityPercent,
      sourceContributionDetails: Array.from({ length: sourceCount }, (_value, sourceIndex) => ({
        artifactId: `artifact_focus_private_source_${sourceIndex + 1}_contribution`,
        contributionRatio: Number((1 / sourceCount).toFixed(6)),
        sourceId: `S${sourceIndex + 1}`,
        sourceIndex,
        warningState: 'artifact_review_required',
      })),
      sourceContributionSummary: Array.from({ length: sourceCount }, (_value, sourceIndex) => ({
        sourceIndex,
        winnerCellRatio: Number((1 / sourceCount).toFixed(6)),
      })),
    },
    sharpnessCoverageRatio: 0.91,
    sourceCount,
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
        data-fixture-id={proof.fixtureId}
        data-preview-requested={String(previewRequested)}
        data-source-count={proof.sourceCount}
        data-stack-hash={proof.stackHash}
        data-stack-path={proof.stackPath}
        data-testid="focus-private-raw-modal-review-proof"
      />
      <FocusStackModal
        isOpen
        loadingImageUrl={proof.previewDataUrl}
        onClose={() => {}}
        onPreviewPlan={() => {
          setPreviewRequested(true);
        }}
        onSettingsChange={setSettings}
        outputReview={outputReview}
        outputReviewArtifactPath={proof.stackPath}
        settings={settings}
        sourceCount={sourceCount}
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
          data-estimated-preview-megapixels={Math.round((5 * settings.maxPreviewDimensionPx ** 2) / 1_000_000)}
          data-mode={settings.detailPolicy === 'aggressive_preview_only' ? 'aggressive' : 'conservative'}
          data-mode-policy-version="1"
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-output-scale={settings.outputScale}
          data-proof-level="synthetic_runtime"
          data-quality-preference={settings.qualityPreference}
          data-review-crop-count="4"
          data-review-packet-path="docs/validation/sr-synthetic-output-artifact-proof-2026-06-20.json"
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
          loadingImageUrl={panoramaPreviewUrl}
          onClose={() => {}}
          onPreviewPlan={() => {}}
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
            data-export-review-artifact={proof.exportReviewArtifact}
            data-fixture-id={proof.fixtureId}
            data-preview-artifact={proof.previewArtifact}
            data-result-review-artifact={proof.resultReviewArtifact}
            data-runtime-status="private_raw_app_server_apply"
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
  const sourcePaths = proof.sourcePaths.split(',');
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
    decision: 'human_review_required',
    detailGainRatio: null,
    detailPolicy: settings.detailPolicy,
    editableGate: 'blocked_review_required',
    falseDetailRisk: 'unknown',
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
    staleState: 'current',
    supportMap: {
      artifactId: `${proof.reconstructionPath}:support-map`,
      coverageRatio: 0.74,
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
        data-output-height={proof.outputHeight}
        data-output-scale={proof.outputScale}
        data-output-width={proof.outputWidth}
        data-preview-requested={String(previewRequested)}
        data-private-run-report-path={proof.privateRunReportPath}
        data-reconstruction-hash={proof.reconstructionHash}
        data-reconstruction-path={proof.reconstructionPath}
        data-source-count={proof.sourceCount}
        data-source-hashes={proof.sourceHashes}
        data-source-paths={proof.sourcePaths}
        data-testid="sr-private-raw-modal-review-proof"
      />
      <SuperResolutionModal
        isOpen
        loadingImageUrl={proof.previewDataUrl}
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
          data-plan-scope="geometry_memory_only"
          data-plan-status={panoramaRuntimePlanFixture.preflight.status}
          data-plan-width={panoramaRuntimePlanFixture.output_dimensions.width}
          data-projection={settings.projection}
          data-quality-preference={settings.qualityPreference}
          data-runtime-status="dry_run_preview"
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
          loadingImageUrl={panoramaPreviewUrl}
          onClose={() => {}}
          onOpenFile={() => {}}
          onSave={() => Promise.resolve('/tmp/panorama.tif')}
          onSettingsChange={setSettings}
          onStitch={() => {}}
          progressMessage={null}
          renderedReview={null}
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
        loadingImageUrl={panoramaPreviewUrl}
        onClose={() => {}}
        onOpenFile={setOpenedPath}
        onSave={() => Promise.resolve(outputPath)}
        onSettingsChange={() => {}}
        onStitch={() => {}}
        progressMessage={null}
        renderedReview={{
          boundary: {
            crop: {
              height: 3200,
              mode: 'coverage_bounds',
              preCropHeight: 3400,
              preCropWidth: 9800,
              width: 9600,
              x: 100,
              y: 80,
            },
            effective: 'auto_crop',
            requested: 'auto_crop',
          },
          capabilityLevel: 'runtime_apply_capable',
          outputDimensions: { height: 3200, width: 9600 },
          projection: { effective: 'rectilinear', requested: 'rectilinear' },
          seamReview: {
            policy: 'adaptive_dp_feather_v1',
            reviewStatus: 'requires_review',
            seamCount: 4,
            seams: [
              { confidence: 'high', featherWidthPx: 100, fromSourceIndex: 0, p95ErrorPx: 1.2, toSourceIndex: 1 },
              { confidence: 'medium', featherWidthPx: 100, fromSourceIndex: 1, p95ErrorPx: 2.4, toSourceIndex: 2 },
              { confidence: 'medium', featherWidthPx: 100, fromSourceIndex: 2, p95ErrorPx: 3.1, toSourceIndex: 3 },
              { confidence: 'high', featherWidthPx: 100, fromSourceIndex: 3, p95ErrorPx: 1.6, toSourceIndex: 4 },
            ],
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
            mode: 'scalar_overlap_luminance_gain_v1',
          },
          warningCodes: ['geometry_estimate_low_confidence', 'legacy_full_frame_render'],
        }}
        runtimePlan={panoramaRuntimePlanFixture}
        settings={DEFAULT_PANORAMA_UI_SETTINGS}
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
        data-deghosting={hdrSettings.deghosting}
        data-estimated-preview-megapixels={Math.round((3 * hdrSettings.maxPreviewDimensionPx ** 2) / 1_000_000)}
        data-max-preview-dimension-px={hdrSettings.maxPreviewDimensionPx}
        data-runtime-status="dry_run_preview"
        data-source-count="3"
        data-testid="hdr-review-workspace-proof"
      />
      <div
        className="sr-only"
        data-deghosting={hdrSettings.deghosting}
        data-max-preview-dimension-px={hdrSettings.maxPreviewDimensionPx}
        data-testid="hdr-ui-settings-proof"
        data-tone-map-preview={hdrSettings.toneMapPreview}
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
        onSave={setSavedPaths}
        targetPaths={[
          '/fixtures/negative-lab/synthetic-color-negative-001.tif',
          '/fixtures/negative-lab/lab-processed-proof-negative-002.jpg',
        ]}
      />
      <div
        className="absolute bottom-4 left-4 z-30 rounded-md border border-white/10 bg-black/70 px-3 py-2 text-xs text-[#f3f4f1]"
        data-testid={VISUAL_SMOKE_PROOF_TEST_IDS.NegativeLabSavedPathProof}
      >
        {savedPaths.length > 0 ? savedPaths.join(', ') : NEGATIVE_LAB_NO_SAVED_PATHS_LABEL}
      </div>
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

function ColorWorkflowVisualSmoke() {
  const [adjustments, setAdjustments] = useState<Adjustments>(() => structuredClone(INITIAL_ADJUSTMENTS));
  const handleAdjustmentsChange = (update: Partial<Adjustments> | ((current: Adjustments) => Adjustments)) => {
    setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
  };
  const colorBalanceSourcePixel = { blue: 0.34, green: 0.48, red: 0.68 };
  const colorBalanceResult = applyColorBalanceRgbToPixel(colorBalanceSourcePixel, adjustments.colorBalanceRgb);
  const clipChannelCount = Object.values(colorBalanceResult.outputRgb).filter(
    (channel) => channel <= 0 || channel >= 1,
  ).length;
  const compareChanged = formatRgbTriplet(colorBalanceSourcePixel) !== formatRgbTriplet(colorBalanceResult.outputRgb);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode={VISUAL_SMOKE_SCENARIO_IDS.ColorWorkflow}
    >
      <div className="grid h-screen grid-cols-[1fr_420px] overflow-hidden">
        <section className="relative min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="color-workflow-preview">
          <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-5">
            <div className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,#182629,#435b5a_42%,#c79c63_72%,#f4d6a1)] shadow-2xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_38%_32%,rgba(255,246,219,0.48),transparent_20%),linear-gradient(170deg,transparent_45%,rgba(24,43,50,0.72)_46%)]" />
            </div>
            <div
              className="grid gap-2 rounded-md border border-white/10 bg-black/45 p-3 text-xs text-[#dce4ea]"
              data-after-rgb={formatRgbTriplet(colorBalanceResult.outputRgb)}
              data-before-rgb={formatRgbTriplet(colorBalanceSourcePixel)}
              data-clip-channel-count={clipChannelCount}
              data-command-summary="toneColor.colorBalanceRgb"
              data-compare-changed={String(compareChanged)}
              data-testid="color-balance-compare-strip"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">{copy.colorBalanceCompare}</span>
                <span className="rounded bg-white/10 px-2 py-1 text-[#aab5bd]">{copy.colorCompareReset}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-white/10 bg-white/5 p-2" data-testid="color-balance-before">
                  <div className="mb-1 text-[11px] uppercase text-[#9ba6b2]">{copy.colorBefore}</div>
                  <div className="font-mono">{formatRgbTriplet(colorBalanceSourcePixel)}</div>
                </div>
                <div
                  className="rounded border border-emerald-500/25 bg-emerald-500/10 p-2"
                  data-testid="color-balance-after"
                >
                  <div className="mb-1 text-[11px] uppercase text-[#9ba6b2]">{copy.colorAfter}</div>
                  <div className="font-mono">{formatRgbTriplet(colorBalanceResult.outputRgb)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-[#aab5bd]">
                <span className="rounded bg-white/5 px-2 py-1">{copy.colorBalanceCommandSummary}</span>
                <span className="rounded bg-white/5 px-2 py-1" data-testid="color-balance-gamut-warning">
                  {copy.colorGamutWarning}
                </span>
              </div>
            </div>
            <div
              className="grid grid-cols-4 gap-2 rounded-md border border-white/10 bg-black/45 p-3 text-sm"
              data-testid="color-workflow-adjustment-proof"
            >
              <span>{formatSmokeMetric(colorSmokeMetricLabels.temperature, adjustments.temperature)}</span>
              <span>{formatSmokeMetric(colorSmokeMetricLabels.saturation, adjustments.saturation)}</span>
              <span>
                {formatSmokeMetric(
                  colorSmokeMetricLabels.colorBalance,
                  adjustments.colorBalanceRgb.enabled ? 'on' : 'off',
                )}
              </span>
              <span>
                {formatSmokeMetric(
                  colorSmokeMetricLabels.channelMixer,
                  adjustments.channelMixer.enabled ? 'on' : 'off',
                )}
              </span>
              <span data-testid="skin-tone-uniformity-ui-proof">
                {formatSmokeMetric(colorSmokeMetricLabels.skinTone, skinToneOutputRed)}
              </span>
              <span data-testid="selective-color-ui-proof">
                {formatSmokeMetric('Orange', adjustments.hsl.oranges.hue)}
              </span>
              <span>{formatSmokeMetric('Orange sat', adjustments.hsl.oranges.saturation)}</span>
              <span>{formatSmokeMetric('Orange lum', adjustments.hsl.oranges.luminance)}</span>
            </div>
          </div>
        </section>
        <aside
          className="overflow-y-auto border-l border-white/10 bg-[#15181c] p-3"
          data-visual-smoke-section="color-workflow-panel"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">{copy.colorWorkflow}</span>
          </div>
          <ColorPanel adjustments={adjustments} appSettings={null} setAdjustments={handleAdjustmentsChange} />
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
