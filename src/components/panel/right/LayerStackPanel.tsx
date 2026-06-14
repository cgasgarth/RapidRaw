import cx from 'clsx';
import { ChevronDown, Copy, Eye, EyeOff, GripVertical, Layers3, Plus, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import Slider, { type SliderChangeEvent } from '../../ui/Slider';
import UiText from '../../ui/Text';

import type { MaskContainer } from '../../../utils/adjustments';

interface LayerStackPanelProps {
  activeMaskContainerId: string | null;
  masks: Array<MaskContainer>;
  onSelectMaskContainer: (id: string | null) => void;
  onUpdateMaskContainer: (id: string, data: Partial<Pick<MaskContainer, 'opacity' | 'visible'>>) => void;
}

interface LayerRowModel {
  blendMode: string;
  id: string;
  isBase: boolean;
  maskCount: number;
  name: string;
  opacity: number;
  visible: boolean;
}

const BASE_LAYER_ID = 'base-raw-layer';

const blendModes = [
  { labelKey: 'editor.layers.blendModes.normal', value: 'Normal' },
  { labelKey: 'editor.layers.blendModes.multiply', value: 'Multiply' },
  { labelKey: 'editor.layers.blendModes.screen', value: 'Screen' },
  { labelKey: 'editor.layers.blendModes.overlay', value: 'Overlay' },
  { labelKey: 'editor.layers.blendModes.softLight', value: 'Soft Light' },
  { labelKey: 'editor.layers.blendModes.color', value: 'Color' },
  { labelKey: 'editor.layers.blendModes.luminosity', value: 'Luminosity' },
] as const;

function formatMaskCount(count: number): string {
  if (count === 0) return 'No masks';
  if (count === 1) return '1 mask';
  return `${String(count)} masks`;
}

function getLayerRows(masks: Array<MaskContainer>): Array<LayerRowModel> {
  const localLayers = masks.map((mask, index) => ({
    blendMode: 'Normal',
    id: mask.id,
    isBase: false,
    maskCount: mask.subMasks.length,
    name: mask.name.trim() || `Layer ${String(index + 1)}`,
    opacity: mask.opacity,
    visible: mask.visible,
  }));

  return [
    ...localLayers,
    {
      blendMode: 'Normal',
      id: BASE_LAYER_ID,
      isBase: true,
      maskCount: 0,
      name: 'Base RAW',
      opacity: 100,
      visible: true,
    },
  ];
}

export default function LayerStackPanel({
  activeMaskContainerId,
  masks,
  onSelectMaskContainer,
  onUpdateMaskContainer,
}: LayerStackPanelProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => getLayerRows(masks), [masks]);
  const [selectedLayerId, setSelectedLayerId] = useState<string>(activeMaskContainerId ?? BASE_LAYER_ID);

  const activeRow = rows.find((row) => row.id === selectedLayerId) ?? rows[0];
  const isBaseSelected = activeRow?.isBase ?? true;
  const selectRow = (row: LayerRowModel) => {
    setSelectedLayerId(row.id);
    onSelectMaskContainer(row.isBase ? null : row.id);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: LayerRowModel) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectRow(row);
  };

  return (
    <section className="shrink-0 border-b border-surface bg-bg-primary">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Layers3 size={18} className="shrink-0 text-text-secondary" />
          <UiText variant={TextVariants.heading} className="truncate">
            {t('editor.layers.title')}
          </UiText>
        </div>
        <button
          className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
          data-tooltip="Create adjustment layer"
          disabled
          type="button"
        >
          <Plus size={17} className="mx-auto" />
        </button>
      </div>

      <div className="px-3 pb-3 space-y-1">
        {rows.map((row) => {
          const isSelected = selectedLayerId === row.id;

          return (
            <div
              key={row.id}
              className={cx(
                'group grid w-full grid-cols-[18px_28px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                isSelected
                  ? 'bg-surface text-text-primary'
                  : 'text-text-secondary hover:bg-surface/70 hover:text-text-primary',
              )}
              onClick={() => {
                selectRow(row);
              }}
              onKeyDown={(event) => {
                handleRowKeyDown(event, row);
              }}
              role="button"
              tabIndex={0}
            >
              <GripVertical size={15} className={row.isBase ? 'text-transparent' : 'text-text-secondary'} />
              <span className="flex h-7 w-7 items-center justify-center rounded bg-bg-primary text-text-secondary ring-1 ring-surface">
                <Layers3 size={15} />
              </span>
              <span className="min-w-0">
                <UiText as="span" variant={TextVariants.body} weight={TextWeights.medium} className="block truncate">
                  {row.name}
                </UiText>
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block truncate">
                  {t('editor.layers.rowSummary', {
                    blendMode: row.blendMode,
                    maskCount: formatMaskCount(row.maskCount),
                    opacity: row.opacity,
                  })}
                </UiText>
              </span>
              <span className="flex items-center gap-1">
                <button
                  className="h-7 w-7 rounded-md text-text-secondary hover:bg-card-active hover:text-text-primary transition-colors"
                  data-tooltip={row.visible ? 'Hide layer' : 'Show layer'}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!row.isBase) {
                      onUpdateMaskContainer(row.id, { visible: !row.visible });
                    }
                  }}
                  disabled={row.isBase}
                  type="button"
                >
                  {row.visible ? (
                    <Eye size={15} className="mx-auto mt-1.5" />
                  ) : (
                    <EyeOff size={15} className="mx-auto mt-1.5" />
                  )}
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {activeRow && (
        <div className="border-t border-surface px-4 py-3 space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
            <UiText variant={TextVariants.label} className="truncate">
              {t('editor.layers.blend')}
            </UiText>
            <div className="relative">
              <select
                className="h-8 w-full appearance-none rounded-md bg-surface px-2 pr-7 text-sm text-text-primary outline-none disabled:opacity-60"
                disabled
                value={activeRow.blendMode}
              >
                {blendModes.map((blendMode) => (
                  <option key={blendMode.value} value={blendMode.value}>
                    {t(blendMode.labelKey)}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-2 top-2 text-text-secondary" />
            </div>
          </div>

          <Slider
            defaultValue={100}
            disabled={isBaseSelected}
            fillOrigin="min"
            label={t('editor.masks.settings.opacity')}
            max={100}
            min={0}
            onChange={(event: SliderChangeEvent) => {
              if (!activeRow.isBase) {
                onUpdateMaskContainer(activeRow.id, { opacity: Number(event.target.value) });
              }
            }}
            step={1}
            value={activeRow.opacity}
          />

          <div className="flex items-center justify-end gap-1">
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip="Duplicate layer"
              disabled
              type="button"
            >
              <Copy size={16} className="mx-auto" />
            </button>
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip="Delete layer"
              disabled={isBaseSelected}
              type="button"
            >
              <Trash2 size={16} className="mx-auto" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
