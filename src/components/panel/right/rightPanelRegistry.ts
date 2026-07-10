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
  keywords: readonly string[];
  priority: 'primary' | 'secondary';
  shortLabel: string;
  tooltipKey: string;
}

export const RIGHT_PANEL_GROUPS = [
  [
    {
      fallbackLabel: 'Color',
      icon: Palette,
      id: Panel.Color,
      keywords: ['color', 'profile', 'tone', 'grading', 'white balance', 'hsl', 'mixer', 'film look'],
      priority: 'primary',
      shortLabel: 'Color',
      tooltipKey: 'editor.switcher.tooltips.color',
    },
    {
      fallbackLabel: 'Adjust',
      icon: SlidersHorizontal,
      id: Panel.Adjustments,
      keywords: ['adjust', 'basic', 'exposure', 'contrast', 'curves', 'details', 'effects', 'sharpen'],
      priority: 'primary',
      shortLabel: 'Adjust',
      tooltipKey: 'editor.switcher.tooltips.adjust',
    },
    {
      fallbackLabel: 'Crop',
      icon: Crop,
      id: Panel.Crop,
      keywords: ['crop', 'rotate', 'straighten', 'aspect', 'transform', 'lens'],
      priority: 'primary',
      shortLabel: 'Crop',
      tooltipKey: 'editor.switcher.tooltips.crop',
    },
    {
      fallbackLabel: 'Masks',
      icon: Layers,
      id: Panel.Masks,
      keywords: ['mask', 'layer', 'brush', 'gradient', 'local adjustment', 'selection'],
      priority: 'primary',
      shortLabel: 'Masks',
      tooltipKey: 'editor.switcher.tooltips.masks',
    },
    {
      fallbackLabel: 'Agent Edit',
      icon: BotMessageSquare,
      id: Panel.Agent,
      keywords: ['agent', 'chat', 'ai edit', 'assistant', 'instruction', 'review'],
      priority: 'primary',
      shortLabel: 'Agent',
      tooltipKey: 'editor.switcher.tooltips.agent',
    },
    {
      fallbackLabel: 'Inpaint',
      icon: Paintbrush,
      id: Panel.Ai,
      keywords: ['inpaint', 'remove', 'retouch', 'object', 'fill', 'ai'],
      priority: 'primary',
      shortLabel: 'Inpaint',
      tooltipKey: 'editor.switcher.tooltips.inpaint',
    },
  ],
  [
    {
      fallbackLabel: 'Info',
      icon: Info,
      id: Panel.Metadata,
      keywords: ['info', 'metadata', 'exif', 'camera', 'lens', 'file'],
      priority: 'secondary',
      shortLabel: 'Info',
      tooltipKey: 'editor.switcher.tooltips.info',
    },
    {
      fallbackLabel: 'Presets',
      icon: SwatchBook,
      id: Panel.Presets,
      keywords: ['preset', 'look', 'style', 'recipe', 'saved settings'],
      priority: 'secondary',
      shortLabel: 'Presets',
      tooltipKey: 'editor.switcher.tooltips.presets',
    },
    {
      fallbackLabel: 'Tether',
      icon: Camera,
      id: Panel.Tether,
      keywords: ['tether', 'capture', 'camera', 'import', 'session'],
      priority: 'secondary',
      shortLabel: 'Tether',
      tooltipKey: 'editor.switcher.tooltips.tether',
    },
    {
      fallbackLabel: 'Export',
      icon: FileInput,
      id: Panel.Export,
      keywords: ['export', 'output', 'save', 'render', 'format', 'jpg', 'tiff'],
      priority: 'secondary',
      shortLabel: 'Export',
      tooltipKey: 'editor.switcher.tooltips.export',
    },
  ],
] as const satisfies ReadonlyArray<ReadonlyArray<RightPanelRegistryEntry>>;

export const RIGHT_PANEL_ORDER: Panel[] = RIGHT_PANEL_GROUPS.flatMap((group) => group.map(({ id }) => id));
export const RIGHT_PANEL_ENTRIES: RightPanelRegistryEntry[] = RIGHT_PANEL_GROUPS.flatMap((group) => [...group]);
export const RIGHT_PANEL_ENTRY_BY_ID: ReadonlyMap<Panel, RightPanelRegistryEntry> = new Map(
  RIGHT_PANEL_ENTRIES.map((entry) => [entry.id, entry]),
);

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
const RIGHT_PANEL_IDS = new Set<string>(RIGHT_PANEL_ORDER);

export const isEditingRightPanel = (panel: string | null): panel is (typeof EDITING_RIGHT_PANELS)[number] =>
  panel !== null && EDITING_RIGHT_PANEL_IDS.has(panel);

export const isRightPanel = (panel: string | null): panel is Panel => panel !== null && RIGHT_PANEL_IDS.has(panel);

export const getRightPanelEntry = (panel: Panel): RightPanelRegistryEntry => {
  const entry = RIGHT_PANEL_ENTRY_BY_ID.get(panel);
  if (entry === undefined) {
    throw new Error(`Unknown right panel: ${panel}`);
  }
  return entry;
};

export const getRecentRightPanelEntries = (
  recentPanels: readonly string[],
  activePanel: Panel | null,
  limit = 4,
): RightPanelRegistryEntry[] => {
  if (limit <= 0) return [];

  const recentEntries: RightPanelRegistryEntry[] = [];
  const seenPanels = new Set<Panel>();
  for (const panel of recentPanels) {
    if (!isRightPanel(panel) || panel === activePanel || seenPanels.has(panel)) continue;

    recentEntries.push(getRightPanelEntry(panel));
    seenPanels.add(panel);
    if (recentEntries.length === limit) break;
  }
  return recentEntries;
};

const normalizeSearchTerm = (value: string) => value.trim().toLocaleLowerCase();

export const searchRightPanels = (query: string): RightPanelRegistryEntry[] => {
  const normalizedQuery = normalizeSearchTerm(query);
  if (normalizedQuery.length === 0) return RIGHT_PANEL_ENTRIES;

  return RIGHT_PANEL_ENTRIES.filter((entry) => {
    const searchableValues = [entry.id, entry.fallbackLabel, entry.shortLabel, ...entry.keywords];
    return searchableValues.some((value) => normalizeSearchTerm(value).includes(normalizedQuery));
  });
};
