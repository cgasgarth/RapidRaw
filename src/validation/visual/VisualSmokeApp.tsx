import { Camera, CircleGauge, FolderOpen, Layers3, SlidersHorizontal, Sparkles } from 'lucide-react';

import HdrModal from '../../components/modals/HdrModal';
import { DEFAULT_HDR_UI_SETTINGS } from '../../schemas/hdrUiSchemas';

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
  filmLook: 'Film look',
  filmPreset: 'Neutral 400',
  frameStatus: (rating: string) => `Rating ${rating} / RAW / edited`,
} as const;

const scopes = [
  ['Luma', '71'],
  ['R', '64'],
  ['G', '69'],
  ['B', '73'],
] as const;

function VisualSmokeApp({ mode }: VisualSmokeAppProps) {
  if (mode === 'hdr-modal') {
    return (
      <main
        className="h-full min-h-screen bg-[#111316] text-[#f3f4f1] font-sans"
        data-visual-smoke-ready="true"
        data-visual-smoke-mode={mode}
      >
        <div className="h-screen bg-[#111316]" data-visual-smoke-section="hdr-modal-backdrop" />
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
          onSave={() => Promise.resolve('visual-smoke-hdr-output.tif')}
          onSettingsChange={() => {}}
          progressMessage={null}
          settings={DEFAULT_HDR_UI_SETTINGS}
        />
      </main>
    );
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
