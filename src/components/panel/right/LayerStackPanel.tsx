import cx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Mask, SubMaskMode } from './Masks';
import { useEditorStore } from '../../../store/useEditorStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  LAYER_BLEND_MODES,
  type LayerBlendMode,
  type MaskContainer,
  type RetouchCandidateProvenance,
  type RetouchCloneSource,
  type RetouchRemoveSource,
} from '../../../utils/adjustments';
import {
  buildLayerGroupSummaries,
  buildLayerGroupWorkflowProof,
  buildLayerExportReadinessSummary,
  canGroupLayerWithNext,
  deleteLayerGroup,
  duplicateLayerGroup,
  groupLayerWithNext,
  moveLayerGroup,
  normalizeLayerBlendMode,
  setLayerBlendMode,
  setLayerGroupName,
  setLayerGroupOpacity,
  showAllLayers,
  soloLayer,
  soloLayerGroup,
  ungroupLayerGroup,
} from '../../../utils/layerStack';
import {
  applyLayerStackCommandBridgeOperation,
  type LayerStackCommandBridgeOperation,
} from '../../../utils/layerStackCommandBridge';
import Slider, { type SliderChangeEvent } from '../../ui/Slider';
import UiText from '../../ui/Text';

interface LayerStackPanelProps {
  activeMaskContainerId: string | null;
  masks: Array<MaskContainer>;
  onSelectMaskContainer: (id: string | null) => void;
  onSetMaskContainers: (masks: Array<MaskContainer>) => void;
}

interface LayerRowModel {
  adjustmentKeys: Array<string>;
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
  retouchCloneSource: RetouchCloneSource | null;
  retouchCloneSourceLabel: string | null;
  retouchMode: 'clone' | 'heal' | null;
  retouchRemoveSource: RetouchRemoveSource | null;
  retouchRemoveSourceLabel: string | null;
  visible: boolean;
  visibleState: 'hidden' | 'mixed' | 'visible';
}

type RetouchControlField =
  | 'featherRadiusPx'
  | 'radiusPx'
  | 'rotationDegrees'
  | 'scale'
  | 'sourcePoint.x'
  | 'sourcePoint.y'
  | 'targetPoint.x'
  | 'targetPoint.y';

type RetouchRemoveControlField =
  | 'featherRadiusPx'
  | 'radiusPx'
  | 'searchRadiusMultiplier'
  | 'seed'
  | 'targetCenterX'
  | 'targetCenterY';

const BASE_LAYER_ID = 'base-raw-layer';
const LAYER_OPACITY_PRESETS = [0, 25, 50, 75, 100] as const;

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const roundRetouchNumber = (value: number): number => Math.round(value * 1000) / 1000;

const numberParameter = (parameters: Record<string, unknown> | undefined, key: string, fallback: number): number => {
  const value = parameters?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const syncRetouchRemoveTargetMask = (
  masks: Array<MaskContainer>,
  layerId: string,
  retouchRemoveSource: RetouchRemoveSource,
  targetCenter?: { x?: number; y?: number },
): Array<MaskContainer> =>
  masks.map((mask) => {
    if (mask.id !== layerId) return mask;
    return {
      ...mask,
      subMasks: mask.subMasks.map((subMask) => {
        if (subMask.id !== retouchRemoveSource.targetMaskId || subMask.type !== Mask.Radial) return subMask;
        return {
          ...subMask,
          parameters: {
            ...(subMask.parameters ?? {}),
            ...(targetCenter?.x === undefined ? {} : { centerX: targetCenter.x }),
            ...(targetCenter?.y === undefined ? {} : { centerY: targetCenter.y }),
            featherRadiusPx: retouchRemoveSource.featherRadiusPx ?? 24,
            radiusPx: retouchRemoveSource.radiusPx ?? 48,
          },
        };
      }),
    };
  });

const syncRetouchCloneTargetMask = (
  masks: Array<MaskContainer>,
  layerId: string,
  retouchCloneSource: RetouchCloneSource,
  imageDimensions: { height: number; width: number },
): Array<MaskContainer> =>
  masks.map((mask) => {
    if (mask.id !== layerId) return mask;
    let syncedTargetMask = false;
    return {
      ...mask,
      subMasks: mask.subMasks.map((subMask) => {
        if (subMask.type !== Mask.Radial || syncedTargetMask) return subMask;
        syncedTargetMask = true;
        return {
          ...subMask,
          parameters: {
            ...(subMask.parameters ?? {}),
            centerX: retouchCloneSource.targetPoint.x * imageDimensions.width,
            centerY: retouchCloneSource.targetPoint.y * imageDimensions.height,
            featherRadiusPx: retouchCloneSource.featherRadiusPx ?? 24,
            radiusPx: retouchCloneSource.radiusPx ?? 48,
          },
        };
      }),
    };
  });

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

function getRemoveStatusLabelKey(status: RetouchRemoveSource['status']) {
  switch (status) {
    case 'fallback_unchanged':
      return 'editor.layers.removeSource.status.fallback_unchanged';
    case 'ready':
      return 'editor.layers.removeSource.status.ready';
    case 'stale':
      return 'editor.layers.removeSource.status.stale';
    case 'needs_regeneration':
    case undefined:
      return 'editor.layers.removeSource.status.needs_regeneration';
  }
}

function getRemoveStatusGuidanceKey(status: RetouchRemoveSource['status']) {
  switch (status) {
    case 'fallback_unchanged':
      return 'editor.layers.removeSource.guidance.fallback_unchanged';
    case 'ready':
      return 'editor.layers.removeSource.guidance.ready';
    case 'stale':
      return 'editor.layers.removeSource.guidance.stale';
    case 'needs_regeneration':
    case undefined:
      return 'editor.layers.removeSource.guidance.needs_regeneration';
  }
}

function getRemoveStatusTone(status: RetouchRemoveSource['status']): string {
  switch (status) {
    case 'ready':
      return 'border-green-500/30 bg-green-500/10 text-green-200';
    case 'fallback_unchanged':
    case 'stale':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'needs_regeneration':
    case undefined:
      return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
  }
}

function getCandidateStatusLabelKey(status: RetouchCandidateProvenance['statusAtAcceptance']) {
  switch (status) {
    case 'acknowledged':
      return 'modals.negativeConversion.dustCandidateStatus.acknowledged';
    case 'ignored':
      return 'modals.negativeConversion.dustCandidateStatus.ignored';
    case 'pending':
      return 'modals.negativeConversion.dustCandidateStatus.pending';
  }
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
        adjustmentKeys: [],
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
        retouchCloneSource: null,
        retouchCloneSourceLabel: null,
        retouchMode: null,
        retouchRemoveSource: null,
        retouchRemoveSourceLabel: null,
        visible: groupSummary?.visibleState !== 'hidden',
        visibleState: groupSummary?.visibleState ?? 'visible',
      });
    }

    if (mask.layerGroupId && collapsedGroupIds.has(mask.layerGroupId)) {
      return;
    }

    rows.push({
      adjustmentKeys: Object.entries(mask.adjustments)
        .filter(([, value]) => typeof value === 'number' && value !== 0)
        .map(([key]) => key)
        .toSorted(),
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
      retouchCloneSource: mask.retouchCloneSource ?? null,
      retouchCloneSourceLabel:
        mask.retouchCloneSource === undefined
          ? null
          : [
              `${mask.retouchCloneSource.sourcePoint.x.toFixed(2)},${mask.retouchCloneSource.sourcePoint.y.toFixed(2)}`,
              `${mask.retouchCloneSource.targetPoint.x.toFixed(2)},${mask.retouchCloneSource.targetPoint.y.toFixed(2)}`,
            ].join(' -> '),
      retouchMode: mask.retouchCloneSource?.retouchMode ?? (mask.retouchCloneSource ? 'clone' : null),
      retouchRemoveSource: mask.retouchRemoveSource ?? null,
      retouchRemoveSourceLabel: mask.retouchRemoveSource
        ? `${mask.retouchRemoveSource.generator} / ${mask.retouchRemoveSource.status ?? 'needs_regeneration'}`
        : null,
      visible: mask.visible,
      visibleState: mask.visible ? 'visible' : 'hidden',
    });
  });

  return [
    ...rows,
    {
      adjustmentKeys: [],
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
      retouchCloneSource: null,
      retouchCloneSourceLabel: null,
      retouchMode: null,
      retouchRemoveSource: null,
      retouchRemoveSourceLabel: null,
      visible: true,
      visibleState: 'visible',
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
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const orientationSteps = useEditorStore((state) => state.adjustments.orientationSteps);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => getLayerRows(masks, collapsedGroupIds), [collapsedGroupIds, masks]);
  const [localSelectedLayerId, setLocalSelectedLayerId] = useState<string>(BASE_LAYER_ID);
  const [layerGraphRevision, setLayerGraphRevision] = useState('layer_stack_panel_initial');
  const [lastCommandType, setLastCommandType] = useState('none');
  const [lastChangedLayerCount, setLastChangedLayerCount] = useState(0);
  const selectedLayerId = activeMaskContainerId ?? localSelectedLayerId;
  const visibleLayerCount = masks.filter((mask) => mask.visible).length;
  const hiddenLayerCount = masks.length - visibleLayerCount;
  const exportReadiness = useMemo(() => buildLayerExportReadinessSummary(masks), [masks]);
  const effectiveImageDimensions = useMemo(() => {
    const width = selectedImage?.width ?? 1;
    const height = selectedImage?.height ?? 1;
    return orientationSteps === 1 || orientationSteps === 3 ? { height: width, width: height } : { height, width };
  }, [orientationSteps, selectedImage?.height, selectedImage?.width]);
  const groupWorkflowProof = useMemo(
    () => buildLayerGroupWorkflowProof(masks, collapsedGroupIds),
    [collapsedGroupIds, masks],
  );
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
  const activeMask = activeRow && !activeRow.isBase ? masks.find((mask) => mask.id === activeRow.id) : undefined;
  const activeRemoveTargetSubMask =
    activeRow?.retouchRemoveSource === null || activeRow?.retouchRemoveSource === undefined
      ? undefined
      : activeMask?.subMasks.find((subMask) => subMask.id === activeRow.retouchRemoveSource?.targetMaskId);
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
  const applyLayerStackCommand = (
    operation: LayerStackCommandBridgeOperation,
    nextSelectedLayerId = selectedLayerId,
    materializeMasks: (nextMasks: Array<MaskContainer>) => Array<MaskContainer> = (nextMasks) => nextMasks,
  ) => {
    const result = applyLayerStackCommandBridgeOperation(masks, operation, {
      graphRevision: layerGraphRevision,
      imagePath: 'rapidraw://current-image',
      operationId: crypto.randomUUID(),
      sessionId: 'rapidraw-layer-stack-panel',
    });
    setLayerGraphRevision(result.graphRevision);
    setLastCommandType(result.command.commandType);
    setLastChangedLayerCount(result.commandResult.changedLayerIds.length);
    applyLayerStack(materializeMasks(result.masks), nextSelectedLayerId);
  };
  const updateLayerVisibility = (layerId: string, visible: boolean) => {
    applyLayerStackCommand({ layerId, type: 'setVisibility', visible }, layerId);
  };
  const updateGroupVisibility = (groupId: string, visible: boolean) => {
    const nextMasks = masks.map((mask) => (mask.layerGroupId === groupId ? { ...mask, visible } : mask));
    applyLayerStack(nextMasks, `group:${groupId}`);
  };
  const updateLayerOpacity = (layerId: string, opacity: number) => {
    applyLayerStackCommand({ layerId, opacity, type: 'setOpacity' }, layerId);
  };
  const updateLayerBlendMode = (layerId: string, blendMode: LayerBlendMode) => {
    applyLayerStack(setLayerBlendMode(masks, layerId, blendMode), layerId);
  };
  const updateLayerRetouchSource = (
    layerId: string,
    retouchCloneSource: RetouchCloneSource,
    syncTargetMask = false,
  ) => {
    applyLayerStackCommand(
      { layerId, retouchCloneSource, type: 'updateRetouchSource' },
      layerId,
      syncTargetMask
        ? (nextMasks) => syncRetouchCloneTargetMask(nextMasks, layerId, retouchCloneSource, effectiveImageDimensions)
        : undefined,
    );
  };
  const updateLayerRetouchRemoveSource = (
    layerId: string,
    retouchRemoveSource: RetouchRemoveSource,
    syncTargetMask = false,
    targetCenter?: { x?: number; y?: number },
  ) => {
    applyLayerStackCommand(
      { layerId, retouchRemoveSource, type: 'updateRetouchRemoveSource' },
      layerId,
      syncTargetMask
        ? (nextMasks) => syncRetouchRemoveTargetMask(nextMasks, layerId, retouchRemoveSource, targetCenter)
        : undefined,
    );
  };
  const updateActiveRetouchNumber = (field: RetouchControlField, rawValue: number) => {
    if (!activeRow || activeRow.isBase || activeRow.isGroupHeader || activeRow.retouchCloneSource === null) return;

    const nextSource = structuredClone(activeRow.retouchCloneSource);
    if (field === 'sourcePoint.x') nextSource.sourcePoint.x = roundRetouchNumber(clampNumber(rawValue, 0, 1));
    if (field === 'sourcePoint.y') nextSource.sourcePoint.y = roundRetouchNumber(clampNumber(rawValue, 0, 1));
    if (field === 'targetPoint.x') nextSource.targetPoint.x = roundRetouchNumber(clampNumber(rawValue, 0, 1));
    if (field === 'targetPoint.y') nextSource.targetPoint.y = roundRetouchNumber(clampNumber(rawValue, 0, 1));
    if (field === 'scale') nextSource.scale = roundRetouchNumber(clampNumber(rawValue, 0.1, 10));
    if (field === 'rotationDegrees') nextSource.rotationDegrees = roundRetouchNumber(clampNumber(rawValue, -180, 180));
    if (field === 'radiusPx') nextSource.radiusPx = roundRetouchNumber(clampNumber(rawValue, 0.01, 4096));
    if (field === 'featherRadiusPx') nextSource.featherRadiusPx = roundRetouchNumber(clampNumber(rawValue, 0, 4096));

    const syncTargetMask =
      field === 'targetPoint.x' || field === 'targetPoint.y' || field === 'radiusPx' || field === 'featherRadiusPx';
    updateLayerRetouchSource(activeRow.id, nextSource, syncTargetMask);
  };
  const updateActiveRetouchRemoveNumber = (field: RetouchRemoveControlField, rawValue: number) => {
    if (!activeRow || activeRow.isBase || activeRow.isGroupHeader || activeRow.retouchRemoveSource === null) return;

    const nextSource = structuredClone(activeRow.retouchRemoveSource);
    if (field === 'radiusPx') nextSource.radiusPx = roundRetouchNumber(clampNumber(rawValue, 0.01, 4096));
    if (field === 'featherRadiusPx') nextSource.featherRadiusPx = roundRetouchNumber(clampNumber(rawValue, 0, 4096));
    let targetCenter: { x?: number; y?: number } | undefined;
    if (field === 'targetCenterX') {
      targetCenter = { x: roundRetouchNumber(clampNumber(rawValue, 0, 1)) };
    }
    if (field === 'targetCenterY') {
      targetCenter = { y: roundRetouchNumber(clampNumber(rawValue, 0, 1)) };
    }
    if (field === 'searchRadiusMultiplier') {
      nextSource.searchRadiusMultiplier = roundRetouchNumber(clampNumber(rawValue, 1, 12));
    }
    if (field === 'seed') nextSource.seed = Math.round(clampNumber(rawValue, 0, 0xffffffff));
    nextSource.status = 'needs_regeneration';
    delete nextSource.resolvedSourcePoint;

    updateLayerRetouchRemoveSource(
      activeRow.id,
      nextSource,
      field === 'radiusPx' || field === 'featherRadiusPx' || targetCenter !== undefined,
      targetCenter,
    );
  };
  const regenerateActiveRemoveLayer = () => {
    if (!activeRow || activeRow.isBase || activeRow.isGroupHeader || activeRow.retouchRemoveSource === null) return;
    const nextSource = structuredClone(activeRow.retouchRemoveSource);
    nextSource.seed = (nextSource.seed + 1) % 0x100000000;
    nextSource.status = 'needs_regeneration';
    delete nextSource.resolvedSourcePoint;
    updateLayerRetouchRemoveSource(activeRow.id, nextSource);
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
    applyLayerStackCommand({ layerId: activeRow.id, name: nextName, type: 'rename' }, activeRow.id);
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
    applyLayerStackCommand({ layer, type: 'create' }, layerId);
  };
  const createCloneLayer = () => {
    const layerId = crypto.randomUUID();
    const targetMaskId = `${layerId}_clone_target`;
    const targetPoint = { x: 0.58, y: 0.58 };
    const radiusPx = 48;
    const featherRadiusPx = 24;
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      blendMode: DEFAULT_LAYER_BLEND_MODE,
      id: layerId,
      invert: false,
      name: t('editor.layers.newCloneLayerName', { count: masks.length + 1 }),
      opacity: 100,
      retouchCloneSource: {
        alignmentErrorPx: 0,
        featherRadiusPx,
        radiusPx,
        retouchMode: 'clone',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 0.42, y: 0.42 },
        targetPoint,
      },
      subMasks: [
        {
          id: targetMaskId,
          invert: false,
          mode: SubMaskMode.Additive,
          name: t('editor.layers.newCloneLayerName', { count: masks.length + 1 }),
          opacity: 100,
          parameters: {
            centerX: targetPoint.x * effectiveImageDimensions.width,
            centerY: targetPoint.y * effectiveImageDimensions.height,
            featherRadiusPx,
            radiusPx,
          },
          type: Mask.Radial,
          visible: true,
        },
      ],
      visible: true,
    };
    applyLayerStackCommand({ layer, type: 'create' }, layerId);
  };
  const createHealLayer = () => {
    const layerId = crypto.randomUUID();
    const targetMaskId = `${layerId}_heal_target`;
    const targetPoint = { x: 0.56, y: 0.56 };
    const radiusPx = 48;
    const featherRadiusPx = 24;
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      blendMode: DEFAULT_LAYER_BLEND_MODE,
      id: layerId,
      invert: false,
      name: t('editor.layers.newHealLayerName', { count: masks.length + 1 }),
      opacity: 100,
      retouchCloneSource: {
        alignmentErrorPx: 0,
        featherRadiusPx,
        radiusPx,
        retouchMode: 'heal',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 0.44, y: 0.44 },
        targetPoint,
      },
      subMasks: [
        {
          id: targetMaskId,
          invert: false,
          mode: SubMaskMode.Additive,
          name: t('editor.layers.newHealLayerName', { count: masks.length + 1 }),
          opacity: 100,
          parameters: {
            centerX: targetPoint.x * effectiveImageDimensions.width,
            centerY: targetPoint.y * effectiveImageDimensions.height,
            featherRadiusPx,
            radiusPx,
          },
          type: Mask.Radial,
          visible: true,
        },
      ],
      visible: true,
    };
    applyLayerStackCommand({ layer, type: 'create' }, layerId);
  };
  const createRemoveLayer = () => {
    const layerId = crypto.randomUUID();
    const targetMaskId = `${layerId}_remove_region`;
    const targetPoint = { x: 0.5, y: 0.5 };
    const layer: MaskContainer = {
      adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
      blendMode: DEFAULT_LAYER_BLEND_MODE,
      id: layerId,
      invert: false,
      name: t('editor.layers.newRemoveLayerName', { count: masks.length + 1 }),
      opacity: 100,
      retouchRemoveSource: {
        featherRadiusPx: 24,
        generator: 'local_patch_fill_v1',
        generatorVersion: 1,
        radiusPx: 48,
        searchRadiusMultiplier: 4,
        seed: 0,
        status: 'needs_regeneration',
        targetMaskId,
      },
      subMasks: [
        {
          id: targetMaskId,
          invert: false,
          mode: SubMaskMode.Additive,
          name: t('editor.layers.removeSource.defaultMaskName'),
          opacity: 100,
          parameters: {
            centerX: targetPoint.x * effectiveImageDimensions.width,
            centerY: targetPoint.y * effectiveImageDimensions.height,
            featherRadiusPx: 24,
            radiusPx: 48,
          },
          type: Mask.Radial,
          visible: true,
        },
      ],
      visible: true,
    };
    applyLayerStackCommand({ layer, type: 'create' }, layerId);
  };
  const moveActiveLayer = (direction: 'down' | 'up') => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(moveLayerGroup(masks, activeRow.groupId, direction), activeRow.id);
      return;
    }
    if (activeRow.isGroupedLayer) return;
    applyLayerStackCommand({ direction, layerId: activeRow.id, type: 'move' }, activeRow.id);
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
    applyLayerStackCommand(
      {
        layerId: activeRow.id,
        name: t('editor.layers.copyName', { name: activeRow.name }),
        newLayerId,
        type: 'duplicate',
      },
      newLayerId,
    );
  };
  const deleteActiveLayer = () => {
    if (!activeRow || activeRow.isBase) return;
    if (activeRow.isGroupHeader && activeRow.groupId) {
      applyLayerStack(deleteLayerGroup(masks, activeRow.groupId), BASE_LAYER_ID);
      return;
    }
    applyLayerStackCommand({ layerId: activeRow.id, type: 'delete' }, BASE_LAYER_ID);
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
          <button
            className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
            data-tooltip={t('editor.layers.actions.createCloneLayer')}
            data-testid="layer-create-clone-layer"
            onClick={createCloneLayer}
            type="button"
          >
            <Copy size={17} className="mx-auto" />
          </button>
          <button
            className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
            data-tooltip={t('editor.layers.actions.createHealLayer')}
            data-testid="layer-create-heal-layer"
            onClick={createHealLayer}
            type="button"
          >
            <Sparkles size={17} className="mx-auto" />
          </button>
          <button
            className="h-8 w-8 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40"
            data-tooltip={t('editor.layers.actions.createRemoveLayer')}
            data-testid="layer-create-remove-layer"
            onClick={createRemoveLayer}
            type="button"
          >
            <Eraser size={17} className="mx-auto" />
          </button>
        </div>
      </div>

      <div
        className="mx-3 mb-3 grid grid-cols-1 gap-1.5 rounded-md border border-surface bg-bg-secondary/70 p-2"
        data-collapsed-group-count={groupWorkflowProof.collapsedGroupCount}
        data-collapsed-group-ids={groupWorkflowProof.collapsedGroupIds.join(',')}
        data-group-count={groupCount}
        data-hidden-group-count={groupWorkflowProof.hiddenGroupCount}
        data-grouped-layer-count={groupWorkflowProof.groupedLayerCount}
        data-hidden-layer-count={hiddenLayerCount}
        data-mixed-group-count={groupWorkflowProof.mixedGroupCount}
        data-testid="layer-stack-composition-summary"
        data-visible-group-count={groupWorkflowProof.visibleGroupCount}
        data-visible-layer-count={visibleLayerCount}
        data-visible-order={groupWorkflowProof.visibleOrder.join(',')}
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

      <div
        className="mx-3 mb-3 rounded-md border border-surface bg-bg-secondary/70 p-2"
        data-exportable-layer-count={exportReadiness.exportableLayerCount}
        data-hidden-layer-count={exportReadiness.hiddenLayerCount}
        data-masked-layer-count={exportReadiness.maskedLayerCount}
        data-testid="layer-export-readiness-summary"
        data-total-layer-count={exportReadiness.totalLayerCount}
      >
        <UiText variant={TextVariants.small} weight={TextWeights.medium} className="block text-text-primary">
          {t('editor.layers.exportReadiness.title')}
        </UiText>
        <UiText variant={TextVariants.small} className="block text-text-tertiary">
          {t('editor.layers.exportReadiness.summary', {
            exportable: exportReadiness.exportableLayerCount,
            masked: exportReadiness.maskedLayerCount,
            total: exportReadiness.totalLayerCount,
          })}
        </UiText>
      </div>

      <div
        className="mx-3 mb-3 grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-secondary/70 p-2"
        data-can-group-active-layer={String(canGroupActiveLayer)}
        data-can-move-active-layer={String(canMoveActiveLayerUp || canMoveActiveLayerDown)}
        data-can-ungroup-active-layer={String(canUngroupActiveLayer)}
        data-layer-stack-graph-revision={layerGraphRevision}
        data-layer-stack-last-changed-layer-count={lastChangedLayerCount}
        data-layer-stack-last-command-type={lastCommandType}
        data-testid="layer-operation-readiness-summary"
      >
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="rounded bg-bg-primary px-2 py-1 text-left leading-4 text-text-secondary"
          data-testid="layer-operation-move-ready"
        >
          {canMoveActiveLayerUp || canMoveActiveLayerDown
            ? t('editor.layers.operationReadiness.moveReady')
            : t('editor.layers.operationReadiness.moveBlocked')}
        </UiText>
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="rounded bg-bg-primary px-2 py-1 text-left leading-4 text-text-secondary"
          data-testid="layer-operation-group-ready"
        >
          {canGroupActiveLayer
            ? t('editor.layers.operationReadiness.groupReady')
            : t('editor.layers.operationReadiness.groupBlocked')}
        </UiText>
        <UiText
          variant={TextVariants.small}
          weight={TextWeights.medium}
          className="rounded bg-bg-primary px-2 py-1 text-left leading-4 text-text-secondary"
          data-testid="layer-operation-ungroup-ready"
        >
          {canUngroupActiveLayer
            ? t('editor.layers.operationReadiness.ungroupReady')
            : t('editor.layers.operationReadiness.ungroupBlocked')}
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
              data-group-collapsed={String(row.isGroupCollapsed)}
              data-group-id={row.groupId ?? ''}
              data-group-visible-state={row.isGroupHeader ? row.visibleState : ''}
              data-grouped-layer={String(row.isGroupedLayer)}
              data-layer-row-id={row.id}
              data-retouch-candidate-id={row.retouchCloneSource?.candidateProvenance?.candidateId ?? ''}
              data-retouch-candidate-origin={row.retouchCloneSource?.candidateProvenance?.origin ?? ''}
              data-retouch-clone-source={row.retouchCloneSourceLabel ?? ''}
              data-retouch-remove-source={row.retouchRemoveSourceLabel ?? ''}
              data-testid={
                row.isGroupHeader
                  ? `layer-stack-group-row-${row.groupId ?? 'unknown'}`
                  : `layer-stack-layer-row-${row.id}`
              }
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
                  {row.retouchCloneSourceLabel !== null
                    ? t(row.retouchMode === 'heal' ? 'editor.layers.healRowSummary' : 'editor.layers.cloneRowSummary', {
                        blendMode:
                          row.blendMode === null
                            ? t('editor.layers.groupType')
                            : t(getBlendModeLabelKey(row.blendMode)),
                        maskCount: row.isGroupHeader
                          ? t('editor.layers.groupCount', { count: row.groupLayerCount })
                          : getMaskCountLabel(row.maskCount),
                        opacity: row.opacity,
                        source: row.retouchCloneSourceLabel,
                      })
                    : row.retouchRemoveSourceLabel !== null
                      ? t('editor.layers.removeRowSummary', {
                          blendMode:
                            row.blendMode === null
                              ? t('editor.layers.groupType')
                              : t(getBlendModeLabelKey(row.blendMode)),
                          maskCount: row.isGroupHeader
                            ? t('editor.layers.groupCount', { count: row.groupLayerCount })
                            : getMaskCountLabel(row.maskCount),
                          opacity: row.opacity,
                          source: row.retouchRemoveSourceLabel,
                        })
                      : t('editor.layers.rowSummary', {
                          blendMode:
                            row.blendMode === null
                              ? t('editor.layers.groupType')
                              : t(getBlendModeLabelKey(row.blendMode)),
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
          <div
            className="rounded-md border border-surface bg-bg-secondary p-2"
            data-active-layer-adjustment-count={activeRow.adjustmentKeys.length}
            data-active-layer-adjustment-keys={activeRow.adjustmentKeys.join(',')}
            data-active-layer-id={activeRow.id}
            data-active-layer-opacity={activeRow.opacity}
            data-active-layer-visible={String(activeRow.visible)}
            data-active-layer-visible-state={activeRow.visibleState}
            data-testid="layer-active-render-state"
          >
            <UiText variant={TextVariants.small} weight={TextWeights.medium} className="block text-text-primary">
              {t('editor.layers.activeRenderState.title')}
            </UiText>
            <UiText variant={TextVariants.small} className="block text-text-tertiary">
              {t('editor.layers.activeRenderState.summary', {
                opacity: activeRow.opacity,
                visibility: activeRow.visible
                  ? t('editor.layers.activeRenderState.visible')
                  : t('editor.layers.activeRenderState.hidden'),
              })}
            </UiText>
          </div>
          {activeRow.retouchCloneSource !== null && (
            <div
              className="rounded-md border border-surface bg-bg-secondary p-2"
              data-retouch-candidate-confidence={activeRow.retouchCloneSource.candidateProvenance?.confidence ?? ''}
              data-retouch-candidate-id={activeRow.retouchCloneSource.candidateProvenance?.candidateId ?? ''}
              data-retouch-candidate-kind={activeRow.retouchCloneSource.candidateProvenance?.candidateKind ?? ''}
              data-retouch-candidate-origin={activeRow.retouchCloneSource.candidateProvenance?.origin ?? ''}
              data-retouch-candidate-source-frame-id={
                activeRow.retouchCloneSource.candidateProvenance?.sourceFrameId ?? ''
              }
              data-retouch-candidate-status={activeRow.retouchCloneSource.candidateProvenance?.statusAtAcceptance ?? ''}
              data-retouch-feather-radius-px={activeRow.retouchCloneSource.featherRadiusPx ?? ''}
              data-retouch-mode={activeRow.retouchMode ?? 'clone'}
              data-retouch-radius-px={activeRow.retouchCloneSource.radiusPx ?? ''}
              data-retouch-rotation-degrees={activeRow.retouchCloneSource.rotationDegrees}
              data-retouch-scale={activeRow.retouchCloneSource.scale}
              data-retouch-source-x={activeRow.retouchCloneSource.sourcePoint.x}
              data-retouch-source-y={activeRow.retouchCloneSource.sourcePoint.y}
              data-retouch-target-x={activeRow.retouchCloneSource.targetPoint.x}
              data-retouch-target-y={activeRow.retouchCloneSource.targetPoint.y}
              data-testid="layer-retouch-source-editor"
            >
              <UiText variant={TextVariants.small} weight={TextWeights.medium} className="block text-text-primary">
                {t('editor.layers.retouchSource.title')}
              </UiText>
              <UiText variant={TextVariants.small} className="block text-text-tertiary">
                {t('editor.layers.retouchSource.summary', {
                  mode: t(
                    activeRow.retouchMode === 'heal'
                      ? 'editor.layers.retouchSource.modes.heal'
                      : 'editor.layers.retouchSource.modes.clone',
                  ),
                  source: activeRow.retouchCloneSourceLabel,
                })}
              </UiText>
              {activeRow.retouchCloneSource.candidateProvenance !== undefined && (
                <div
                  className="mt-2 rounded-md border border-surface bg-surface/60 px-2 py-1.5"
                  data-testid="layer-retouch-candidate-provenance"
                >
                  <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                    {t(
                      activeRow.retouchCloneSource.candidateProvenance.candidateKind === 'dust_spot'
                        ? 'modals.negativeConversion.dustCandidate.dustSpot'
                        : 'modals.negativeConversion.dustCandidate.emulsionScratch',
                    )}
                    {' · '}
                    {t(getCandidateStatusLabelKey(activeRow.retouchCloneSource.candidateProvenance.statusAtAcceptance))}
                  </UiText>
                  <UiText variant={TextVariants.small} className="block truncate tabular-nums text-text-primary">
                    {activeRow.retouchCloneSource.candidateProvenance.candidateId}
                    {' · '}
                    {Math.round(activeRow.retouchCloneSource.candidateProvenance.confidence * 100)}
                    {'% · '}
                    {activeRow.retouchCloneSource.candidateProvenance.sourceFrameId}
                  </UiText>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      field: 'sourcePoint.x',
                      label: t('editor.layers.retouchSource.sourceX'),
                      max: 1,
                      min: 0,
                      step: 0.01,
                      value: activeRow.retouchCloneSource.sourcePoint.x,
                    },
                    {
                      field: 'sourcePoint.y',
                      label: t('editor.layers.retouchSource.sourceY'),
                      max: 1,
                      min: 0,
                      step: 0.01,
                      value: activeRow.retouchCloneSource.sourcePoint.y,
                    },
                    {
                      field: 'targetPoint.x',
                      label: t('editor.layers.retouchSource.targetX'),
                      max: 1,
                      min: 0,
                      step: 0.01,
                      value: activeRow.retouchCloneSource.targetPoint.x,
                    },
                    {
                      field: 'targetPoint.y',
                      label: t('editor.layers.retouchSource.targetY'),
                      max: 1,
                      min: 0,
                      step: 0.01,
                      value: activeRow.retouchCloneSource.targetPoint.y,
                    },
                    {
                      field: 'scale',
                      label: t('editor.layers.retouchSource.scale'),
                      max: 10,
                      min: 0.1,
                      step: 0.01,
                      value: activeRow.retouchCloneSource.scale,
                    },
                    {
                      field: 'rotationDegrees',
                      label: t('editor.layers.retouchSource.rotation'),
                      max: 180,
                      min: -180,
                      step: 0.1,
                      value: activeRow.retouchCloneSource.rotationDegrees,
                    },
                  ] satisfies Array<{
                    field: RetouchControlField;
                    label: string;
                    max: number;
                    min: number;
                    step: number;
                    value: number;
                  }>
                ).map((control) => (
                  <label className="min-w-0" key={control.field}>
                    <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                      {control.label}
                    </UiText>
                    <input
                      className="mt-1 h-8 w-full rounded-md bg-surface px-2 text-sm tabular-nums text-text-primary outline-none"
                      data-testid={`layer-retouch-control-${control.field}`}
                      defaultValue={control.value}
                      max={control.max}
                      min={control.min}
                      onBlur={(event) => {
                        updateActiveRetouchNumber(control.field, Number(event.currentTarget.value));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      step={control.step}
                      type="number"
                    />
                  </label>
                ))}
                {activeRow.retouchMode === 'heal' &&
                  (
                    [
                      {
                        field: 'radiusPx',
                        label: t('editor.layers.retouchSource.radius'),
                        value: activeRow.retouchCloneSource.radiusPx ?? 48,
                      },
                      {
                        field: 'featherRadiusPx',
                        label: t('editor.layers.retouchSource.feather'),
                        value: activeRow.retouchCloneSource.featherRadiusPx ?? 24,
                      },
                    ] satisfies Array<{ field: RetouchControlField; label: string; value: number }>
                  ).map((control) => (
                    <label className="min-w-0" key={control.field}>
                      <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                        {control.label}
                      </UiText>
                      <input
                        className="mt-1 h-8 w-full rounded-md bg-surface px-2 text-sm tabular-nums text-text-primary outline-none"
                        data-testid={`layer-retouch-control-${control.field}`}
                        defaultValue={control.value}
                        min={control.field === 'radiusPx' ? 0.01 : 0}
                        onBlur={(event) => {
                          updateActiveRetouchNumber(control.field, Number(event.currentTarget.value));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                        step={1}
                        type="number"
                      />
                    </label>
                  ))}
              </div>
            </div>
          )}
          {activeRow.retouchRemoveSource !== null && (
            <div
              className="rounded-md border border-surface bg-bg-secondary p-2"
              data-remove-generator={activeRow.retouchRemoveSource.generator}
              data-remove-generator-version={activeRow.retouchRemoveSource.generatorVersion}
              data-remove-search-radius-multiplier={activeRow.retouchRemoveSource.searchRadiusMultiplier}
              data-remove-seed={activeRow.retouchRemoveSource.seed}
              data-remove-resolved-source-x={activeRow.retouchRemoveSource.resolvedSourcePoint?.x ?? ''}
              data-remove-resolved-source-y={activeRow.retouchRemoveSource.resolvedSourcePoint?.y ?? ''}
              data-remove-status={activeRow.retouchRemoveSource.status ?? 'needs_regeneration'}
              data-remove-status-guidance={t(getRemoveStatusGuidanceKey(activeRow.retouchRemoveSource.status))}
              data-remove-target-mask-id={activeRow.retouchRemoveSource.targetMaskId}
              data-remove-source-resolved={String(activeRow.retouchRemoveSource.resolvedSourcePoint !== undefined)}
              data-testid="layer-retouch-remove-editor"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <UiText variant={TextVariants.small} weight={TextWeights.medium} className="block text-text-primary">
                    {t('editor.layers.removeSource.title')}
                  </UiText>
                  <UiText variant={TextVariants.small} className="block text-text-tertiary">
                    {t('editor.layers.removeSource.summary', {
                      generator: t('editor.layers.removeSource.generators.localPatchFill'),
                      status: t(getRemoveStatusLabelKey(activeRow.retouchRemoveSource.status)),
                    })}
                  </UiText>
                </span>
                <button
                  className={cx(
                    'shrink-0 rounded-md border border-surface bg-surface px-2 py-1 text-xs text-text-secondary',
                    'hover:bg-card-active hover:text-text-primary',
                  )}
                  data-testid="layer-retouch-remove-regenerate"
                  onClick={regenerateActiveRemoveLayer}
                  type="button"
                >
                  {t('editor.layers.removeSource.regenerate')}
                </button>
              </div>
              <div
                className="mt-2 grid grid-cols-1 gap-2 rounded-md border border-surface bg-surface/60 p-2"
                data-testid="layer-retouch-remove-status-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cx(
                      'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                      getRemoveStatusTone(activeRow.retouchRemoveSource.status),
                    )}
                    data-testid="layer-retouch-remove-status-pill"
                  >
                    {t(getRemoveStatusLabelKey(activeRow.retouchRemoveSource.status))}
                  </span>
                  <UiText
                    variant={TextVariants.small}
                    className="text-text-tertiary"
                    data-testid="layer-retouch-remove-source-state"
                  >
                    {activeRow.retouchRemoveSource.resolvedSourcePoint === undefined
                      ? t('editor.layers.removeSource.sourcePending')
                      : t('editor.layers.removeSource.sourceResolved')}
                  </UiText>
                </div>
                <UiText
                  variant={TextVariants.small}
                  className="text-text-secondary"
                  data-testid="layer-retouch-remove-guidance"
                >
                  {t(getRemoveStatusGuidanceKey(activeRow.retouchRemoveSource.status))}
                </UiText>
              </div>
              {activeRow.retouchRemoveSource.resolvedSourcePoint !== undefined && (
                <div
                  className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-surface bg-surface/60 p-2"
                  data-testid="layer-retouch-remove-resolved-source"
                >
                  <span className="min-w-0">
                    <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                      {t('editor.layers.retouchSource.sourceX')}
                    </UiText>
                    <UiText variant={TextVariants.small} className="block tabular-nums text-text-primary">
                      {activeRow.retouchRemoveSource.resolvedSourcePoint.x.toFixed(3)}
                    </UiText>
                  </span>
                  <span className="min-w-0">
                    <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                      {t('editor.layers.retouchSource.sourceY')}
                    </UiText>
                    <UiText variant={TextVariants.small} className="block tabular-nums text-text-primary">
                      {activeRow.retouchRemoveSource.resolvedSourcePoint.y.toFixed(3)}
                    </UiText>
                  </span>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      field: 'targetCenterX',
                      label: t('editor.layers.retouchSource.targetX'),
                      max: 1,
                      min: 0,
                      step: 0.001,
                      value: numberParameter(activeRemoveTargetSubMask?.parameters, 'centerX', 0.5),
                    },
                    {
                      field: 'targetCenterY',
                      label: t('editor.layers.retouchSource.targetY'),
                      max: 1,
                      min: 0,
                      step: 0.001,
                      value: numberParameter(activeRemoveTargetSubMask?.parameters, 'centerY', 0.5),
                    },
                    {
                      field: 'radiusPx',
                      label: t('editor.layers.removeSource.radius'),
                      max: 4096,
                      min: 0.01,
                      step: 1,
                      value: activeRow.retouchRemoveSource.radiusPx ?? 48,
                    },
                    {
                      field: 'featherRadiusPx',
                      label: t('editor.layers.removeSource.feather'),
                      max: 4096,
                      min: 0,
                      step: 1,
                      value: activeRow.retouchRemoveSource.featherRadiusPx ?? 24,
                    },
                    {
                      field: 'searchRadiusMultiplier',
                      label: t('editor.layers.removeSource.search'),
                      max: 12,
                      min: 1,
                      step: 0.25,
                      value: activeRow.retouchRemoveSource.searchRadiusMultiplier,
                    },
                    {
                      field: 'seed',
                      label: t('editor.layers.removeSource.seed'),
                      max: 0xffffffff,
                      min: 0,
                      step: 1,
                      value: activeRow.retouchRemoveSource.seed,
                    },
                  ] satisfies Array<{
                    field: RetouchRemoveControlField;
                    label: string;
                    max: number;
                    min: number;
                    step: number;
                    value: number;
                  }>
                ).map((control) => (
                  <label className="min-w-0" key={control.field}>
                    <UiText variant={TextVariants.small} className="block truncate text-text-tertiary">
                      {control.label}
                    </UiText>
                    <input
                      className="mt-1 h-8 w-full rounded-md bg-surface px-2 text-sm tabular-nums text-text-primary outline-none"
                      data-testid={`layer-retouch-remove-control-${control.field}`}
                      defaultValue={control.value}
                      max={control.max}
                      min={control.min}
                      onBlur={(event) => {
                        updateActiveRetouchRemoveNumber(control.field, Number(event.currentTarget.value));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                      step={control.step}
                      type="number"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
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
