import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { lazy, type ReactNode, Suspense } from 'react';
import { type AppSettings, Panel, type SelectedImage } from '../../ui/AppProperties';
import type { ExportState } from '../../ui/ExportImportProperties';
import Controls from './ControlsPanel';
import CropPanel from './CropPanel';
import ExportPanel from './ExportPanel';
import MetadataPanel from './MetadataPanel';

const AIPanel = lazy(() => import('./AIPanel.js').then((module) => ({ default: module.AIPanel })));
const MasksPanel = lazy(() => import('./MasksPanel.js').then((module) => ({ default: module.MasksPanel })));
const PresetsPanel = lazy(() => import('./PresetsPanel.js').then((module) => ({ default: module.PresetsPanel })));
const TetherPanel = lazy(() => import('./TetherPanel.js').then((module) => ({ default: module.TetherPanel })));

const panelVariants: Variants = {
  animate: (direction: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: direction === 0 ? 0 : 0.2, ease: 'circOut' },
  }),
  exit: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? -20 : 20,
    transition: { duration: direction === 0 ? 0 : 0.1, ease: 'circIn' },
  }),
  initial: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? 20 : -20,
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
  [Panel.Ai]: () => <AIPanel />,
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

export function EditorRightPanelHost(props: EditorRightPanelHostProps) {
  const { activeRightPanel, renderedRightPanel, slideDirection } = props;
  const renderPanel = renderedRightPanel === null ? null : rightPanelRegistry[renderedRightPanel];

  return (
    <AnimatePresence mode="wait" custom={slideDirection}>
      {activeRightPanel && (
        <motion.div
          animate="animate"
          className="h-full w-full"
          custom={slideDirection}
          exit="exit"
          initial="initial"
          key={renderedRightPanel}
          variants={panelVariants}
        >
          <Suspense fallback={<div className="h-full w-full bg-bg-secondary" aria-busy="true" />}>
            {renderPanel?.(props)}
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
