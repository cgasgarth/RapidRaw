import { Camera, CircleGauge, FolderOpen, Layers3, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useState } from 'react';

import ColorPanel from '../../components/adjustments/Color';
import EffectsPanel from '../../components/adjustments/Effects';
import CommandPaletteModal from '../../components/modals/CommandPaletteModal';
import FocusStackModal from '../../components/modals/FocusStackModal';
import HdrModal from '../../components/modals/HdrModal';
import NegativeConversionModal from '../../components/modals/NegativeConversionModal';
import PanoramaModal from '../../components/modals/PanoramaModal';
import SuperResolutionModal from '../../components/modals/SuperResolutionModal';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS, type FocusStackUiSettings } from '../../schemas/focusStackUiSchemas';
import { DEFAULT_HDR_MERGE_UI_SETTINGS, type HdrMergeUiSettings } from '../../schemas/hdrMergeUiSchemas';
import { DEFAULT_PANORAMA_UI_SETTINGS, type PanoramaUiSettings } from '../../schemas/panoramaUiSchemas';
import {
  DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  type SuperResolutionUiSettings,
} from '../../schemas/superResolutionUiSchemas';
import { useUIStore } from '../../store/useUIStore';
import { INITIAL_ADJUSTMENTS, type Adjustments } from '../../utils/adjustments';

interface VisualSmokeAppProps {
  mode: string;
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
const FILM_LOOK_PARITY_TITLE = 'Rendered parity proof';
const FILM_LOOK_PARITY_FIXTURE_LABEL = 'Synthetic fixture';
const formatFilmLookParityDelta = (maxDelta: string) => `Delta ${maxDelta}`;

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
  commandPaletteSmoke: 'Command Palette Workflows',
  filmLook: 'Film look',
  filmPreset: 'Neutral 400',
  focusStackSmoke: 'Focus Stack Smoke',
  panoramaSmoke: 'Panorama UI Smoke',
  superResolutionSmoke: 'Super Resolution Smoke',
  colorWorkflow: 'Color Workflow',
  frameStatus: (rating: string) => `Rating ${rating} / RAW / edited`,
} as const;

const scopes = [
  ['Luma', '71'],
  ['R', '64'],
  ['G', '69'],
  ['B', '73'],
] as const;

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
const filmSmokeMetricLabels = {
  contrast: 'Contrast',
  grain: 'Grain',
  highlights: 'Highlights',
  temperature: 'Temp',
} as const;
const formatSmokeMetric = (label: string, value: number | string) => `${label} ${value}`;
const colorSmokeMetricLabels = {
  channelMixer: 'CM',
  colorBalance: 'CB',
  saturation: 'Sat',
  temperature: 'Temp',
} as const;

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
      data-visual-smoke-mode="command-palette-workflows"
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="command-palette-workflows">
        <div
          className="sr-only"
          data-focus-open={focusOpen}
          data-hdr-open={hdrOpen}
          data-negative-open={negativeOpen}
          data-panorama-open={panoramaOpen}
          data-sr-open={srOpen}
          data-testid="command-palette-workflow-proof"
        />
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#181b1f] px-4">
          <span className="text-sm font-semibold tracking-normal">{copy.brand}</span>
          <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#aab2bd]">
            {copy.commandPaletteSmoke}
          </span>
        </div>
        <button
          className="m-6 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          data-testid="command-palette-open"
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
      data-visual-smoke-mode="focus-ui"
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="focus-modal">
        <div
          className="sr-only"
          data-alignment-mode={settings.alignmentMode}
          data-blend-method={settings.blendMethod}
          data-max-preview-dimension-px={settings.maxPreviewDimensionPx}
          data-quality-preference={settings.qualityPreference}
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
          onSettingsChange={setSettings}
          settings={settings}
          sourceCount={6}
        />
      </div>
    </main>
  );
}

function SuperResolutionVisualSmoke() {
  const [settings, setSettings] = useState<SuperResolutionUiSettings>(DEFAULT_SUPER_RESOLUTION_UI_SETTINGS);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode="sr-ui"
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="sr-modal">
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
          onSettingsChange={setSettings}
          settings={settings}
          sourceCount={5}
        />
      </div>
    </main>
  );
}

function PanoramaVisualSmoke() {
  const [settings, setSettings] = useState<PanoramaUiSettings>(DEFAULT_PANORAMA_UI_SETTINGS);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode="panorama-ui"
    >
      <div className="h-screen bg-[#0f1114]" data-visual-smoke-section="panorama-modal">
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
          settings={settings}
        />
      </div>
    </main>
  );
}

function HdrVisualSmoke() {
  const [hdrSettings, setHdrSettings] = useState<HdrMergeUiSettings>(DEFAULT_HDR_MERGE_UI_SETTINGS);

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode="hdr-ui"
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="hdr-modal" />
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
      />
    </main>
  );
}

function NegativeLabVisualSmoke() {
  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode="negative-lab-workspace"
    >
      <div className="absolute inset-0 bg-[#0f1114]" data-visual-smoke-section="negative-lab-modal" />
      <NegativeConversionModal
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        targetPaths={[
          '/fixtures/negative-lab/synthetic-color-negative-001.tif',
          '/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif',
        ]}
      />
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
      data-visual-smoke-mode="film-look-browser"
    >
      <div className="grid h-screen grid-cols-[1fr_380px] overflow-hidden">
        <section className="relative min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="film-look-preview">
          <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-5">
            <div className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-gradient-to-br from-[#293c42] via-[#52645f] to-[#d4b173] shadow-2xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_42%_35%,rgba(255,244,215,0.45),transparent_22%),linear-gradient(170deg,transparent_42%,rgba(12,31,37,0.72)_43%)]" />
            </div>
            <div
              className="grid grid-cols-4 gap-2 rounded-md border border-white/10 bg-black/45 p-3 text-sm"
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

  return (
    <main
      className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
      data-visual-smoke-ready="true"
      data-visual-smoke-mode="color-workflow"
    >
      <div className="grid h-screen grid-cols-[1fr_420px] overflow-hidden">
        <section className="relative min-w-0 bg-[#0f1114] p-6" data-visual-smoke-section="color-workflow-preview">
          <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-5">
            <div className="aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,#182629,#435b5a_42%,#c79c63_72%,#f4d6a1)] shadow-2xl">
              <div className="h-full w-full bg-[radial-gradient(circle_at_38%_32%,rgba(255,246,219,0.48),transparent_20%),linear-gradient(170deg,transparent_45%,rgba(24,43,50,0.72)_46%)]" />
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
  if (mode === 'command-palette-workflows') {
    return <CommandPaletteWorkflowSmoke />;
  }

  if (mode === 'focus-ui') {
    return <FocusStackVisualSmoke />;
  }

  if (mode === 'sr-ui') {
    return <SuperResolutionVisualSmoke />;
  }

  if (mode === 'panorama-ui') {
    return <PanoramaVisualSmoke />;
  }

  if (mode === 'hdr-ui') {
    return <HdrVisualSmoke />;
  }

  if (mode === 'negative-lab-workspace') {
    return <NegativeLabVisualSmoke />;
  }

  if (mode === 'film-look-browser') {
    return <FilmLookVisualSmoke />;
  }

  if (mode === 'color-workflow') {
    return <ColorWorkflowVisualSmoke />;
  }

  const scenario = mode === 'empty-library' ? 'Empty Library Startup' : 'Editor Shell Smoke';

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
