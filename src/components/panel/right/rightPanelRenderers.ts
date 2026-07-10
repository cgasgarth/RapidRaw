import { type ComponentType, createElement, lazy, type ReactNode } from 'react';
import { Panel } from '../../ui/AppProperties';
import ColorWorkspacePanel from './color/ColorWorkspacePanel';
import Controls from './color/ControlsPanel';
import CropPanel from './color/CropPanel';
import type { EditorRightPanelHostProps } from './EditorRightPanelHost';
import ExportPanel from './export/ExportPanel';
import MetadataPanel from './metadata/MetadataPanel';

const AIPanel = lazy(() => import('./ai/AIPanel.js').then((module) => ({ default: module.AIPanel })));
const AgentPanel = lazy(() => import('./ai/AgentPanel.js').then((module) => ({ default: module.AgentPanel })));
const MasksPanel = lazy(() => import('./layers/MasksPanel.js').then((module) => ({ default: module.MasksPanel })));
const PresetsPanel = lazy(() => import('./color/PresetsPanel.js').then((module) => ({ default: module.PresetsPanel })));

type TetherPanelComponent = ComponentType<{ onOpenCapture?: (path: string) => void }>;

const TetherPanel = lazy<TetherPanelComponent>(() =>
  import('./capture/TetherPanel.js').then((module) => ({ default: module.TetherPanel })),
);

export type RightPanelRenderer = (props: EditorRightPanelHostProps) => ReactNode;

const RIGHT_PANEL_RENDERERS: Record<Panel, RightPanelRenderer> = {
  [Panel.Adjustments]: () => createElement(Controls),
  [Panel.Agent]: () => createElement(AgentPanel),
  [Panel.Ai]: () => createElement(AIPanel),
  [Panel.Color]: () => createElement(ColorWorkspacePanel),
  [Panel.Crop]: () => createElement(CropPanel),
  [Panel.Export]: ({
    appSettings,
    exportState,
    handleSettingsChange,
    multiSelectedPaths,
    onLinkedVariantImported,
    rootPaths,
    selectedImage,
    setExportState,
  }) =>
    createElement(ExportPanel, {
      appSettings,
      exportState,
      multiSelectedPaths,
      onLinkedVariantImported,
      onSettingsChange: (settings) => void handleSettingsChange(settings),
      rootPaths,
      selectedImage,
      setExportState,
    }),
  [Panel.Masks]: () => createElement(MasksPanel),
  [Panel.Metadata]: () => createElement(MetadataPanel),
  [Panel.Presets]: ({ onNavigateToCommunity }) => createElement(PresetsPanel, { onNavigateToCommunity }),
  [Panel.Tether]: ({ onOpenTetherCapture }) =>
    createElement(TetherPanel, { onOpenCapture: (path: string) => void onOpenTetherCapture(path) }),
};

export const getRightPanelRenderer = (panel: Panel): RightPanelRenderer => RIGHT_PANEL_RENDERERS[panel];
