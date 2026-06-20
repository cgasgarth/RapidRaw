import cx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, Copy, Eye, EyeOff, GripVertical, Layers3, Plus, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../../../utils/adjustments';
import {
  buildLayerGroupSummaries,
  canGroupLayerWithNext,
  createAdjustmentLayer,
  deleteLayer,
  duplicateLayer,
  groupLayerWithNext,
  moveLayer,
  moveLayerGroup,
  setLayerOpacity,
  setLayerVisibility,
  ungroupLayerGroup,
} from '../../../utils/layerStack';
import Slider, { type SliderChangeEvent } from '../../ui/Slider';
import UiText from '../../ui/Text';

interface LayerStackPanelProps {
  activeMaskContainerId: string | null;
  masks: Array<MaskContainer>;
  onSelectMaskContainer: (id: string | null) => void;
  onSetMaskContainers: (masks: Array<MaskContainer>) => void;
}

interface LayerRowModel {
  blendMode: string;
  groupId: string | null;
  groupLayerCount: number;
  id: string;
  isBase: boolean;
  isGroupHeader: boolean;
  isGroupedLayer: boolean;
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

function getLayerRows(masks: Array<MaskContainer>): Array<LayerRowModel> {
  const groupSummaries = buildLayerGroupSummaries(masks);
  const rows: Array<LayerRowModel> = [];
  const emittedGroupIds = new Set<string>();

  masks.forEach((mask, index) => {
    if (mask.layerGroupId && !emittedGroupIds.has(mask.layerGroupId)) {
      const groupSummary = groupSummaries.find((group) => group.id === mask.layerGroupId);
      emittedGroupIds.add(mask.layerGroupId);
      rows.push({
        blendMode: 'Folder',
        groupId: mask.layerGroupId,
        groupLayerCount: groupSummary?.layerCount ?? 1,
        id: `group:${mask.layerGroupId}`,
        isBase: false,
        isGroupHeader: true,
        isGroupedLayer: false,
        maskCount: groupSummary?.layerIds.length ?? 1,
        name: groupSummary?.name ?? tFallbackLayerGroupName(),
        opacity: 100,
        visible:
          groupSummary?.layerIds.every((layerId) => masks.find((layer) => layer.id === layerId)?.visible) ?? true,
      });
    }

    rows.push({
      blendMode: 'Normal',
      groupId: mask.layerGroupId ?? null,
      groupLayerCount: 0,
      id: mask.id,
      isBase: false,
      isGroupHeader: false,
      isGroupedLayer: mask.layerGroupId !== undefined,
      maskCount: mask.subMasks.length,
      name: mask.name.trim() || `Layer ${String(index + 1)}`,
      opacity: mask.opacity,
      visible: mask.visible,
    });
  });

  return [
    ...rows,
    {
      blendMode: 'Normal',
      groupId: null,
      groupLayerCount: 0,
      id: BASE_LAYER_ID,
      isBase: true,
      isGroupHeader: false,
      isGroupedLayer: false,
      maskCount: 0,
      name: 'Base RAW',
      opacity: 100,
      visible: true,
    },
  ];
}

function tFallbackLayerGroupName(): string {
  return 'Layer Group';
}

export default function LayerStackPanel({
  activeMaskContainerId,
  masks,
  onSelectMaskContainer,
  onSetMaskContainers,
}: LayerStackPanelProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => getLayerRows(masks), [masks]);
  const [localSelectedLayerId, setLocalSelectedLayerId] = useState<string>(BASE_LAYER_ID);
  const selectedLayerId = activeMaskContainerId ?? localSelectedLayerId;

  const activeRow = rows.find((row) => row.id === selectedLayerId) ?? rows[0];
  const isBaseSelected = activeRow?.isBase ?? true;
  const isGroupHeaderSelected = activeRow?.isGroupHeader ?? false;
  const activeMaskIndex = activeRow && !activeRow.isBase ? masks.findIndex((mask) => mask.id === activeRow.id) : -1;
  const activeGroupId = activeRow?.groupId ?? null;
  const canMoveActiveLayerUp = isGroupHeaderSelected
    ? masks.findIndex((mask) => mask.layerGroupId === activeGroupId) > 0
    : activeMaskIndex > 0 && activeRow?.isGroupedLayer !== true;
  const canMoveActiveLayerDown = isGroupHeaderSelected
    ? masks.findLastIndex((mask) => mask.layerGroupId === activeGroupId) < masks.length - 1
    : activeMaskIndex >= 0 && activeMaskIndex < masks.length - 1 && activeRow?.isGroupedLayer !== true;
  const canGroupActiveLayer =
    activeRow !== undefined &&
    !activeRow.isBase &&
    !activeRow.isGroupHeader &&
    canGroupLayerWithNext(masks, activeRow.id);
  const canUngroupActiveLayer = activeGroupId !== null;

  const selectRow = (row: LayerRowModel) => {
    setLocalSelectedLayerId(row.id);
    onSelectMaskContainer(row.isBase || row.isGroupHeader ? null : row.id);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: LayerRowModel) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectRow(row);
  };
  const getMaskCountLabel = (count: number) =>
    count === 0 ? t('editor.layers.maskCount.none') : t('editor.layers.maskCount.count', { count });
  const applyLayerStack = (nextMasks: Array<MaskContainer>, nextSelectedLayerId = selectedLayerId) => {
    onSetMaskContainers(nextMasks);
    setLocalSelectedLayerId(nextSelectedLayerId);
    onSelectMaskContainer(nextSelectedLayerId === BASE_LAYER_ID ? null : nextSelectedLayerId);
  };
  const updateLayerVisibility = (layerId: string, visible: boolean) => {
    applyLayerStack(setLayerVisibility(masks, layerId, visible), layerId);
  };
  const updateGroupVisibility = (groupId: string, visible: boolean) => {
    const nextMasks = masks.map((mask) => (mask.layerGroupId === groupId ? { ...mask, visible } : mask));
    applyLayerStack(nextMasks, `group:${groupId}`);
  };
  const updateLayerOpacity = (layerId: string, opacity: number) => {
    applyLayerStack(setLayerOpacity(masks, layerId, opacity), layerId);
  };
  const createActiveAdjustmentLayer = () => {
    const layerId = crypto.randomUUID();
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      id: layerId,
      invert: false,
      name: t('editor.layers.newAdjustmentLayerName', { count: masks.length + 1 }),
      opacity: 100,
      subMasks: [],
      visible: true,
    };
    applyLayerStack(createAdjustmentLayer(masks, layer), layerId);
  };
  const moveActiveLayer = (direction: 'down' | 'up') => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(moveLayerGroup(masks, activeRow.groupId, direction), activeRow.id);
      return;
    }
    if (activeRow.isGroupedLayer) return;
    applyLayerStack(moveLayer(masks, activeRow.id, direction), activeRow.id);
  };
  const groupActiveLayer = () => {
    if (!activeRow || activeRow.isBase || activeRow.isGroupHeader || !canGroupActiveLayer) return;
    const groupId = crypto.randomUUID();
    applyLayerStack(
      groupLayerWithNext(masks, activeRow.id, groupId, t('editor.layers.defaultGroupName')),
      `group:${groupId}`,
    );
  };
  const ungroupActiveLayer = () => {
    if (!activeGroupId) return;
    applyLayerStack(ungroupLayerGroup(masks, activeGroupId), BASE_LAYER_ID);
  };
  const duplicateActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    const newLayerId = crypto.randomUUID();
    applyLayerStack(
      duplicateLayer(masks, activeRow.id, newLayerId, t('editor.layers.copyName', { name: activeRow.name })),
      newLayerId,
    );
  };
  const deleteActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    applyLayerStack(deleteLayer(masks, activeRow.id), BASE_LAYER_ID);
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
        <div className="flex items-center gap-1">
          <button
            className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
            data-tooltip={t('editor.layers.actions.groupWithNext')}
            disabled={!canGroupActiveLayer}
            onClick={groupActiveLayer}
            type="button"
          >
            <Layers3 size={17} className="mx-auto" />
          </button>
          <button
            className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
            data-tooltip={t('editor.layers.actions.createAdjustmentLayer')}
            onClick={createActiveAdjustmentLayer}
            type="button"
          >
            <Plus size={17} className="mx-auto" />
          </button>
        </div>
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
                row.isGroupedLayer && 'ml-6 w-[calc(100%-1.5rem)] border-l border-surface/80 pl-3',
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
              <GripVertical
                size={15}
                className={row.isBase || row.isGroupedLayer ? 'text-transparent' : 'text-text-secondary'}
              />
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
                    maskCount: row.isGroupHeader
                      ? t('editor.layers.groupCount', { count: row.groupLayerCount })
                      : getMaskCountLabel(row.maskCount),
                    opacity: row.opacity,
                  })}
                </UiText>
              </span>
              <span className="flex items-center gap-1">
                <button
                  className="h-7 w-7 rounded-md text-text-secondary hover:bg-card-active hover:text-text-primary transition-colors"
                  data-tooltip={row.visible ? t('editor.layers.actions.hide') : t('editor.layers.actions.show')}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!row.isBase) {
                      if (row.isGroupHeader && row.groupId) {
                        updateGroupVisibility(row.groupId, !row.visible);
                      } else {
                        updateLayerVisibility(row.id, !row.visible);
                      }
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
            disabled={isBaseSelected || isGroupHeaderSelected}
            fillOrigin="min"
            label={t('editor.masks.settings.opacity')}
            max={100}
            min={0}
            onChange={(event: SliderChangeEvent) => {
              if (!activeRow.isBase && !activeRow.isGroupHeader) {
                updateLayerOpacity(activeRow.id, Number(event.target.value));
              }
            }}
            step={1}
            value={activeRow.opacity}
          />

          <div className="flex items-center justify-end gap-1">
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip={t('editor.layers.actions.moveUp')}
              disabled={!canMoveActiveLayerUp}
              onClick={() => {
                moveActiveLayer('up');
              }}
              type="button"
            >
              <ArrowUp size={16} className="mx-auto" />
            </button>
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip={t('editor.layers.actions.moveDown')}
              disabled={!canMoveActiveLayerDown}
              onClick={() => {
                moveActiveLayer('down');
              }}
              type="button"
            >
              <ArrowDown size={16} className="mx-auto" />
            </button>
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip={t('editor.layers.actions.duplicate')}
              disabled={isBaseSelected || isGroupHeaderSelected}
              onClick={duplicateActiveLayer}
              type="button"
            >
              <Copy size={16} className="mx-auto" />
            </button>
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip={t('editor.layers.actions.ungroup')}
              disabled={!canUngroupActiveLayer}
              onClick={ungroupActiveLayer}
              type="button"
            >
              <Layers3 size={16} className="mx-auto" />
            </button>
            <button
              className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
              data-tooltip={t('editor.layers.actions.delete')}
              disabled={isBaseSelected || isGroupHeaderSelected}
              onClick={deleteActiveLayer}
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
