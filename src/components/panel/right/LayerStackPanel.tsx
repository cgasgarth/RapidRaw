import cx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  Plus,
  Trash2,
} from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  LAYER_BLEND_MODES,
  type LayerBlendMode,
  type MaskContainer,
} from '../../../utils/adjustments';
import {
  buildLayerGroupSummaries,
  canGroupLayerWithNext,
  createAdjustmentLayer,
  deleteLayer,
  deleteLayerGroup,
  duplicateLayer,
  duplicateLayerGroup,
  groupLayerWithNext,
  moveLayer,
  moveLayerGroup,
  normalizeLayerBlendMode,
  setLayerBlendMode,
  setLayerGroupName,
  setLayerGroupOpacity,
  setLayerName,
  setLayerOpacity,
  setLayerVisibility,
  showAllLayers,
  soloLayer,
  soloLayerGroup,
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
  blendMode: LayerBlendMode | null;
  groupId: string | null;
  groupLayerCount: number;
  id: string;
  isBase: boolean;
  isGroupCollapsed: boolean;
  isGroupHeader: boolean;
  isGroupedLayer: boolean;
  maskCount: number;
  name: string;
  opacity: number;
  visible: boolean;
}

const BASE_LAYER_ID = 'base-raw-layer';
const LAYER_OPACITY_PRESETS = [0, 25, 50, 75, 100] as const;

const blendModes = [
  { labelKey: 'editor.layers.blendModes.normal', value: 'normal' },
  { labelKey: 'editor.layers.blendModes.multiply', value: 'multiply' },
  { labelKey: 'editor.layers.blendModes.screen', value: 'screen' },
  { labelKey: 'editor.layers.blendModes.overlay', value: 'overlay' },
  { labelKey: 'editor.layers.blendModes.softLight', value: 'soft_light' },
  { labelKey: 'editor.layers.blendModes.color', value: 'color' },
  { labelKey: 'editor.layers.blendModes.luminosity', value: 'luminosity' },
] as const;
type BlendModeLabelKey = (typeof blendModes)[number]['labelKey'];

function isLayerBlendMode(value: string): value is LayerBlendMode {
  return LAYER_BLEND_MODES.some((blendMode) => blendMode === value);
}

function getBlendModeLabelKey(value: LayerBlendMode): BlendModeLabelKey {
  return blendModes.find((blendMode) => blendMode.value === value)?.labelKey ?? 'editor.layers.blendModes.normal';
}

function getLayerRows(masks: Array<MaskContainer>, collapsedGroupIds: Set<string>): Array<LayerRowModel> {
  const groupSummaries = buildLayerGroupSummaries(masks);
  const rows: Array<LayerRowModel> = [];
  const emittedGroupIds = new Set<string>();

  masks.forEach((mask, index) => {
    if (mask.layerGroupId && !emittedGroupIds.has(mask.layerGroupId)) {
      const groupSummary = groupSummaries.find((group) => group.id === mask.layerGroupId);
      emittedGroupIds.add(mask.layerGroupId);
      rows.push({
        blendMode: null,
        groupId: mask.layerGroupId,
        groupLayerCount: groupSummary?.layerCount ?? 1,
        id: `group:${mask.layerGroupId}`,
        isBase: false,
        isGroupCollapsed: collapsedGroupIds.has(mask.layerGroupId),
        isGroupHeader: true,
        isGroupedLayer: false,
        maskCount: groupSummary?.layerIds.length ?? 1,
        name: groupSummary?.name ?? tFallbackLayerGroupName(),
        opacity: groupSummary?.opacity ?? 100,
        visible:
          groupSummary?.layerIds.every((layerId) => masks.find((layer) => layer.id === layerId)?.visible) ?? true,
      });
    }

    if (mask.layerGroupId && collapsedGroupIds.has(mask.layerGroupId)) {
      return;
    }

    rows.push({
      blendMode: normalizeLayerBlendMode(mask.blendMode),
      groupId: mask.layerGroupId ?? null,
      groupLayerCount: 0,
      id: mask.id,
      isBase: false,
      isGroupCollapsed: false,
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
      blendMode: DEFAULT_LAYER_BLEND_MODE,
      groupId: null,
      groupLayerCount: 0,
      id: BASE_LAYER_ID,
      isBase: true,
      isGroupCollapsed: false,
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
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => getLayerRows(masks, collapsedGroupIds), [collapsedGroupIds, masks]);
  const [localSelectedLayerId, setLocalSelectedLayerId] = useState<string>(BASE_LAYER_ID);
  const selectedLayerId = activeMaskContainerId ?? localSelectedLayerId;
  const visibleLayerCount = masks.filter((mask) => mask.visible).length;
  const hiddenLayerCount = masks.length - visibleLayerCount;
  const groupCount = useMemo(() => {
    const groupIds = new Set<string>();
    for (const mask of masks) {
      if (typeof mask.layerGroupId === 'string') {
        groupIds.add(mask.layerGroupId);
      }
    }
    return groupIds.size;
  }, [masks]);

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
  const canShowAllLayers = masks.some((mask) => !mask.visible);
  const isActiveLayerSoloed =
    activeRow !== undefined &&
    !activeRow.isBase &&
    visibleLayerCount > 0 &&
    masks.every(
      (mask) =>
        mask.visible === (activeRow.isGroupHeader ? mask.layerGroupId === activeRow.groupId : mask.id === activeRow.id),
    );

  const selectRow = (row: LayerRowModel) => {
    setLocalSelectedLayerId(row.id);
    onSelectMaskContainer(row.isBase || row.isGroupHeader ? null : row.id);
  };
  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds);
      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId);
      } else {
        nextGroupIds.add(groupId);
      }
      return nextGroupIds;
    });
    setLocalSelectedLayerId(`group:${groupId}`);
    onSelectMaskContainer(null);
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
    onSelectMaskContainer(
      nextSelectedLayerId === BASE_LAYER_ID || nextSelectedLayerId.startsWith('group:') ? null : nextSelectedLayerId,
    );
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
  const updateLayerBlendMode = (layerId: string, blendMode: LayerBlendMode) => {
    applyLayerStack(setLayerBlendMode(masks, layerId, blendMode), layerId);
  };
  const updateGroupOpacity = (groupId: string, opacity: number) => {
    applyLayerStack(setLayerGroupOpacity(masks, groupId, opacity), `group:${groupId}`);
  };
  const updateActiveOpacity = (opacity: number) => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      updateGroupOpacity(activeRow.groupId, opacity);
      return;
    }
    updateLayerOpacity(activeRow.id, opacity);
  };
  const updateActiveLayerName = (name: string) => {
    if (!activeRow || activeRow.isBase) return;
    const nextName = name.trim();
    if (nextName.length === 0) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(setLayerGroupName(masks, activeRow.groupId, nextName), activeRow.id);
      return;
    }
    applyLayerStack(setLayerName(masks, activeRow.id, nextName), activeRow.id);
  };
  const createActiveAdjustmentLayer = () => {
    const layerId = crypto.randomUUID();
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      blendMode: DEFAULT_LAYER_BLEND_MODE,
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
  const soloActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(soloLayerGroup(masks, activeRow.groupId), activeRow.id);
      return;
    }
    applyLayerStack(soloLayer(masks, activeRow.id), activeRow.id);
  };
  const showAllActiveLayers = () => {
    applyLayerStack(showAllLayers(masks), selectedLayerId);
  };
  const duplicateActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      const newGroupId = crypto.randomUUID();
      const groupLayers = masks.filter((mask) => mask.layerGroupId === activeRow.groupId);
      applyLayerStack(
        duplicateLayerGroup(
          masks,
          activeRow.groupId,
          newGroupId,
          t('editor.layers.copyName', { name: activeRow.name }),
          groupLayers.map((layer) => ({
            duplicateName: t('editor.layers.copyName', { name: layer.name }),
            layerId: layer.id,
            newLayerId: crypto.randomUUID(),
          })),
        ),
        `group:${newGroupId}`,
      );
      return;
    }
    const newLayerId = crypto.randomUUID();
    applyLayerStack(
      duplicateLayer(masks, activeRow.id, newLayerId, t('editor.layers.copyName', { name: activeRow.name })),
      newLayerId,
    );
  };
  const deleteActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(deleteLayerGroup(masks, activeRow.groupId), BASE_LAYER_ID);
      return;
    }
    applyLayerStack(deleteLayer(masks, activeRow.id), BASE_LAYER_ID);
  };

  return (
    <section className="shrink-0 border-b border-surface bg-bg-primary">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Layers3 size={18} className="shrink-0 text-text-secondary" />
          <span className="min-w-0">
            <UiText variant={TextVariants.heading} className="block truncate">
              {t('editor.layers.title')}
            </UiText>
            <UiText
              variant={TextVariants.small}
              className="block tabular-nums text-text-tertiary"
              data-testid="layer-stack-count"
            >
              {t('editor.layers.layerCount', { count: masks.length })}
            </UiText>
          </span>
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

      <div
        className="mx-3 mb-3 grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-secondary/70 p-2"
        data-group-count={groupCount}
        data-hidden-layer-count={hiddenLayerCount}
        data-testid="layer-stack-composition-summary"
        data-visible-layer-count={visibleLayerCount}
      >
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="truncate rounded bg-bg-primary px-2 py-1 text-center tabular-nums text-text-secondary"
          data-testid="layer-visible-count"
        >
          {t('editor.layers.visibleLayerCount', { count: visibleLayerCount })}
        </UiText>
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="truncate rounded bg-bg-primary px-2 py-1 text-center tabular-nums text-text-secondary"
          data-testid="layer-hidden-count"
        >
          {t('editor.layers.hiddenLayerCount', { count: hiddenLayerCount })}
        </UiText>
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="truncate rounded bg-bg-primary px-2 py-1 text-center tabular-nums text-text-secondary"
          data-testid="layer-stack-count-summary"
        >
          {t('editor.layers.groupSummaryCount', { count: groupCount })}
        </UiText>
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
              {row.isGroupHeader && row.groupId ? (
                (() => {
                  const groupId = row.groupId;

                  return (
                    <button
                      aria-label={
                        row.isGroupCollapsed
                          ? t('editor.layers.actions.expandGroup')
                          : t('editor.layers.actions.collapseGroup')
                      }
                      className="h-6 w-6 rounded text-text-secondary hover:bg-card-active hover:text-text-primary"
                      data-tooltip={
                        row.isGroupCollapsed
                          ? t('editor.layers.actions.expandGroup')
                          : t('editor.layers.actions.collapseGroup')
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleGroupCollapsed(groupId);
                      }}
                      type="button"
                    >
                      {row.isGroupCollapsed ? (
                        <ChevronRight size={15} className="mx-auto" />
                      ) : (
                        <ChevronDown size={15} className="mx-auto" />
                      )}
                    </button>
                  );
                })()
              ) : (
                <GripVertical
                  size={15}
                  className={row.isBase || row.isGroupedLayer ? 'text-transparent' : 'text-text-secondary'}
                />
              )}
              <span className="flex h-7 w-7 items-center justify-center rounded bg-bg-primary text-text-secondary ring-1 ring-surface">
                <Layers3 size={15} />
              </span>
              <span className="min-w-0">
                <UiText as="span" variant={TextVariants.body} weight={TextWeights.medium} className="block truncate">
                  {row.name}
                </UiText>
                <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block truncate">
                  {t('editor.layers.rowSummary', {
                    blendMode:
                      row.blendMode === null ? t('editor.layers.groupType') : t(getBlendModeLabelKey(row.blendMode)),
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
          <div className="grid grid-cols-[minmax(0,1fr)_160px] items-center gap-3">
            <UiText variant={TextVariants.label} className="truncate">
              {t('editor.layers.name')}
            </UiText>
            <input
              aria-label={t('editor.layers.name')}
              className="h-8 w-full rounded-md bg-surface px-2 text-sm text-text-primary outline-none disabled:opacity-60"
              defaultValue={activeRow.name}
              disabled={isBaseSelected}
              key={activeRow.id}
              onBlur={(event) => {
                updateActiveLayerName(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              type="text"
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
            <UiText variant={TextVariants.label} className="truncate">
              {t('editor.layers.blend')}
            </UiText>
            <div className="relative">
              <select
                className="h-8 w-full appearance-none rounded-md bg-surface px-2 pr-7 text-sm text-text-primary outline-none disabled:opacity-60"
                data-testid="layer-blend-mode-select"
                disabled={isBaseSelected || isGroupHeaderSelected}
                onChange={(event) => {
                  const blendMode = event.currentTarget.value;
                  if (!activeRow.isBase && !activeRow.isGroupHeader && isLayerBlendMode(blendMode)) {
                    updateLayerBlendMode(activeRow.id, blendMode);
                  }
                }}
                value={activeRow.blendMode ?? DEFAULT_LAYER_BLEND_MODE}
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
              updateActiveOpacity(Number(event.target.value));
            }}
            step={1}
            value={activeRow.opacity}
          />
          <div className="grid grid-cols-5 gap-1" data-testid="layer-opacity-presets">
            {LAYER_OPACITY_PRESETS.map((presetOpacity) => {
              const isActiveOpacity = activeRow.opacity === presetOpacity;

              return (
                <button
                  aria-label={t('editor.layers.opacityPreset', { opacity: `${presetOpacity}%` })}
                  aria-pressed={isActiveOpacity}
                  className={cx(
                    'rounded border px-2 py-1 text-xs tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    isActiveOpacity
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-surface text-text-secondary hover:bg-card-active',
                  )}
                  data-testid={`layer-opacity-preset-${presetOpacity}`}
                  disabled={isBaseSelected}
                  key={presetOpacity}
                  onClick={() => {
                    updateActiveOpacity(presetOpacity);
                  }}
                  type="button"
                >
                  {presetOpacity}%
                </button>
              );
            })}
          </div>

          <div
            className="grid grid-cols-2 gap-2 rounded-md border border-surface bg-bg-secondary p-2"
            data-hidden-layer-count={hiddenLayerCount}
            data-solo-active={String(isActiveLayerSoloed)}
            data-testid="layer-active-action-strip"
          >
            <button
              className={cx(
                'flex min-w-0 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                isActiveLayerSoloed
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-surface bg-surface text-text-secondary hover:bg-card-active',
              )}
              data-testid="layer-active-solo"
              disabled={isBaseSelected}
              onClick={soloActiveLayer}
              type="button"
            >
              <Eye size={14} className="shrink-0" />
              <span className="truncate">{t('editor.layers.actions.soloActive')}</span>
            </button>
            <button
              className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-surface bg-surface px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-card-active disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="layer-show-all-hidden"
              disabled={!canShowAllLayers}
              onClick={showAllActiveLayers}
              type="button"
            >
              <EyeOff size={14} className="shrink-0" />
              <span className="truncate">{t('editor.layers.actions.showAllHidden')}</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-1" data-testid="layer-icon-action-row">
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
              disabled={isBaseSelected}
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
              disabled={isBaseSelected}
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
