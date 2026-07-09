import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { type AppSettings, Panel, type SelectedImage } from '../../ui/AppProperties';
import type { ExportState } from '../../ui/ExportImportProperties';
import ColorWorkspacePanel from './color/ColorWorkspacePanel';
import Controls from './color/ControlsPanel';
import CropPanel from './color/CropPanel';
import ExportPanel from './export/ExportPanel';
import MetadataPanel from './metadata/MetadataPanel';

const AIPanel = lazy(() => import('./ai/AIPanel.js').then((module) => ({ default: module.AIPanel })));
const AgentPanel = lazy(() => import('./ai/AgentPanel.js').then((module) => ({ default: module.AgentPanel })));
const MasksPanel = lazy(() => import('./layers/MasksPanel.js').then((module) => ({ default: module.MasksPanel })));
const PresetsPanel = lazy(() => import('./color/PresetsPanel.js').then((module) => ({ default: module.PresetsPanel })));
const TetherPanel = lazy(() => import('./capture/TetherPanel.js').then((module) => ({ default: module.TetherPanel })));

const panelVariants: Variants = {
  animate: (direction: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: direction === 0 ? 0 : 0.18, ease: 'circOut' },
  }),
  exit: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? -12 : 12,
    transition: { duration: direction === 0 ? 0 : 0.1, ease: 'circIn' },
  }),
  initial: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? 12 : -12,
  }),
};

export interface EditorRightPanelHostProps {
  activeRightPanel: Panel | null;
  appSettings: AppSettings | null;
  exportState: ExportState;
  handleSettingsChange: (settings: AppSettings) => Promise<void> | void;
  multiSelectedPaths: Array<string>;
  onLinkedVariantImported: (path: string) => Promise<void> | void;
  onNavigateToCommunity: () => void;
  onOpenTetherCapture: (path: string) => Promise<void> | void;
  renderedRightPanel: Panel | null;
  rootPaths: Array<string>;
  selectedImage: SelectedImage | null;
  setExportState: (updater: Partial<ExportState> | ((state: ExportState) => Partial<ExportState>)) => void;
  slideDirection: number;
}

type RightPanelRenderer = (props: EditorRightPanelHostProps) => ReactNode;

const rightPanelRegistry: Record<Panel, RightPanelRenderer> = {
  [Panel.Adjustments]: () => <Controls />,
  [Panel.Agent]: () => <AgentPanel />,
  [Panel.Ai]: () => <AIPanel />,
  [Panel.Color]: () => <ColorWorkspacePanel />,
  [Panel.Crop]: () => <CropPanel />,
  [Panel.Export]: ({
    appSettings,
    exportState,
    handleSettingsChange,
    multiSelectedPaths,
    onLinkedVariantImported,
    rootPaths,
    selectedImage,
    setExportState,
  }) => (
    <ExportPanel
      appSettings={appSettings}
      exportState={exportState}
      multiSelectedPaths={multiSelectedPaths}
      onLinkedVariantImported={onLinkedVariantImported}
      onSettingsChange={(settings) => {
        void handleSettingsChange(settings);
      }}
      rootPaths={rootPaths}
      selectedImage={selectedImage}
      setExportState={setExportState}
    />
  ),
  [Panel.Masks]: () => <MasksPanel />,
  [Panel.Metadata]: () => <MetadataPanel />,
  [Panel.Presets]: ({ onNavigateToCommunity }) => <PresetsPanel onNavigateToCommunity={onNavigateToCommunity} />,
  [Panel.Tether]: ({ onOpenTetherCapture }) => (
    <TetherPanel
      onOpenCapture={(path) => {
        void onOpenTetherCapture(path);
      }}
    />
  ),
};

function EditorRightPanelSkeleton() {
  return (
    <div
      className="flex h-full w-full flex-col bg-editor-panel"
      aria-busy="true"
      data-testid="editor-right-panel-skeleton"
    >
      <div className="flex min-h-11 shrink-0 items-center justify-between border-b border-editor-border px-3">
        <div className="h-3 w-28 rounded bg-editor-panel-raised" />
        <div className="h-5 w-12 rounded bg-editor-panel-raised" />
      </div>
      <div className="space-y-3 p-3">
        <div className="h-20 rounded-md border border-editor-border bg-editor-panel-well" />
        <div className="h-7 rounded bg-editor-panel-raised" />
        <div className="h-7 rounded bg-editor-panel-raised" />
        <div className="h-32 rounded-md border border-editor-border bg-editor-panel-well" />
      </div>
    </div>
  );
}

export function EditorRightPanelHost(props: EditorRightPanelHostProps) {
  const { activeRightPanel, renderedRightPanel, slideDirection } = props;
  const [hasMountedAgentPanel, setHasMountedAgentPanel] = useState(renderedRightPanel === Panel.Agent);
  const shouldMountAgentPanel = hasMountedAgentPanel || renderedRightPanel === Panel.Agent;
  const isAgentPanelActive = activeRightPanel === Panel.Agent;
  const renderPanel =
    renderedRightPanel === null || renderedRightPanel === Panel.Agent ? null : rightPanelRegistry[renderedRightPanel];

  useEffect(() => {
    if (renderedRightPanel === Panel.Agent) setHasMountedAgentPanel(true);
  }, [renderedRightPanel]);

  return (
    <>
      {shouldMountAgentPanel ? (
        <div
          aria-hidden={!isAgentPanelActive}
          className={`h-full w-full overflow-hidden bg-editor-panel text-text-primary ${
            isAgentPanelActive ? '' : 'hidden'
          }`}
          data-testid="editor-agent-panel-keep-alive"
          inert={isAgentPanelActive ? undefined : true}
        >
          <Suspense fallback={<EditorRightPanelSkeleton />}>
            <AgentPanel />
          </Suspense>
        </div>
      ) : null}
      <AnimatePresence mode="wait" custom={slideDirection}>
        {activeRightPanel && !isAgentPanelActive && (
          <motion.div
            animate="animate"
            className="h-full w-full overflow-hidden bg-editor-panel text-text-primary"
            custom={slideDirection}
            exit="exit"
            initial="initial"
            key={renderedRightPanel}
            variants={panelVariants}
          >
            <Suspense fallback={<EditorRightPanelSkeleton />}>{renderPanel?.(props)}</Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
