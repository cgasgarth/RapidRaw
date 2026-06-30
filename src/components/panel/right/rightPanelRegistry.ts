import type { LucideIcon } from 'lucide-react';
import { Camera, Crop, FileInput, Info, Layers, Paintbrush, SlidersHorizontal, SwatchBook } from 'lucide-react';
import { Panel } from '../../ui/AppProperties';

export interface RightPanelRegistryEntry {
  fallbackLabel: string;
  icon: LucideIcon;
  id: Panel;
  tooltipKey: string;
}

export const RIGHT_PANEL_GROUPS = [
  [{ fallbackLabel: 'Info', icon: Info, id: Panel.Metadata, tooltipKey: 'editor.switcher.tooltips.info' }],
  [
    {
      fallbackLabel: 'Adjust',
      icon: SlidersHorizontal,
      id: Panel.Adjustments,
      tooltipKey: 'editor.switcher.tooltips.adjust',
    },
    { fallbackLabel: 'Crop', icon: Crop, id: Panel.Crop, tooltipKey: 'editor.switcher.tooltips.crop' },
    { fallbackLabel: 'Masks', icon: Layers, id: Panel.Masks, tooltipKey: 'editor.switcher.tooltips.masks' },
    { fallbackLabel: 'Inpaint', icon: Paintbrush, id: Panel.Ai, tooltipKey: 'editor.switcher.tooltips.inpaint' },
  ],
  [
    { fallbackLabel: 'Presets', icon: SwatchBook, id: Panel.Presets, tooltipKey: 'editor.switcher.tooltips.presets' },
    { fallbackLabel: 'Tether', icon: Camera, id: Panel.Tether, tooltipKey: 'editor.switcher.tooltips.tether' },
    { fallbackLabel: 'Export', icon: FileInput, id: Panel.Export, tooltipKey: 'editor.switcher.tooltips.export' },
  ],
] as const satisfies ReadonlyArray<ReadonlyArray<RightPanelRegistryEntry>>;

export const RIGHT_PANEL_ORDER: Panel[] = RIGHT_PANEL_GROUPS.flatMap((group) => group.map(({ id }) => id));
