import type { LucideIcon } from 'lucide-react';
import {
  BotMessageSquare,
  Camera,
  Crop,
  FileInput,
  Info,
  Layers,
  Paintbrush,
  Palette,
  SlidersHorizontal,
  SwatchBook,
} from 'lucide-react';
import { Panel } from '../../ui/AppProperties';

export interface RightPanelRegistryEntry {
  fallbackLabel: string;
  icon: LucideIcon;
  id: Panel;
  priority: 'primary' | 'secondary';
  tooltipKey: string;
}

export const RIGHT_PANEL_GROUPS = [
  [
    {
      fallbackLabel: 'Color',
      icon: Palette,
      id: Panel.Color,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.color',
    },
    {
      fallbackLabel: 'Adjust',
      icon: SlidersHorizontal,
      id: Panel.Adjustments,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.adjust',
    },
    {
      fallbackLabel: 'Crop',
      icon: Crop,
      id: Panel.Crop,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.crop',
    },
    {
      fallbackLabel: 'Masks',
      icon: Layers,
      id: Panel.Masks,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.masks',
    },
    {
      fallbackLabel: 'Agent Edit',
      icon: BotMessageSquare,
      id: Panel.Agent,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.agent',
    },
    {
      fallbackLabel: 'Inpaint',
      icon: Paintbrush,
      id: Panel.Ai,
      priority: 'primary',
      tooltipKey: 'editor.switcher.tooltips.inpaint',
    },
  ],
  [
    {
      fallbackLabel: 'Info',
      icon: Info,
      id: Panel.Metadata,
      priority: 'secondary',
      tooltipKey: 'editor.switcher.tooltips.info',
    },
    {
      fallbackLabel: 'Presets',
      icon: SwatchBook,
      id: Panel.Presets,
      priority: 'secondary',
      tooltipKey: 'editor.switcher.tooltips.presets',
    },
    {
      fallbackLabel: 'Tether',
      icon: Camera,
      id: Panel.Tether,
      priority: 'secondary',
      tooltipKey: 'editor.switcher.tooltips.tether',
    },
    {
      fallbackLabel: 'Export',
      icon: FileInput,
      id: Panel.Export,
      priority: 'secondary',
      tooltipKey: 'editor.switcher.tooltips.export',
    },
  ],
] as const satisfies ReadonlyArray<ReadonlyArray<RightPanelRegistryEntry>>;

export const RIGHT_PANEL_ORDER: Panel[] = RIGHT_PANEL_GROUPS.flatMap((group) => group.map(({ id }) => id));

export const DEFAULT_EDITOR_RIGHT_PANEL = Panel.Color;

export const EDITING_RIGHT_PANELS = [
  Panel.Color,
  Panel.Adjustments,
  Panel.Crop,
  Panel.Masks,
  Panel.Agent,
  Panel.Ai,
] as const satisfies ReadonlyArray<Panel>;

const EDITING_RIGHT_PANEL_IDS = new Set<string>(EDITING_RIGHT_PANELS);

export const isEditingRightPanel = (panel: string | null): panel is (typeof EDITING_RIGHT_PANELS)[number] =>
  panel !== null && EDITING_RIGHT_PANEL_IDS.has(panel);
