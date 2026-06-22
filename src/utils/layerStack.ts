import { DEFAULT_LAYER_BLEND_MODE, LAYER_BLEND_MODES, type LayerBlendMode, type MaskContainer } from './adjustments';

export type LayerStackMoveDirection = 'down' | 'up';

export interface LayerGroupSummary {
  id: string;
  layerCount: number;
  layerIds: Array<string>;
  name: string;
  opacity: number;
  visibleState: 'hidden' | 'mixed' | 'visible';
}

export interface LayerRenderPlanItem {
  adjustmentKeys: Array<string>;
  layerId: string;
  name: string;
  opacity: number;
  opacityFraction: number;
  subMaskCount: number;
}

export interface LayerExportReadinessSummary {
  exportableLayerCount: number;
  groupCount: number;
  hiddenLayerCount: number;
  maskedLayerCount: number;
  totalLayerCount: number;
}

export interface LayerGroupWorkflowProof {
  collapsedGroupCount: number;
  collapsedGroupIds: Array<string>;
  groupCount: number;
  hiddenGroupCount: number;
  groupedLayerCount: number;
  groups: Array<LayerGroupSummary & { collapsed: boolean }>;
  mixedGroupCount: number;
  visibleGroupCount: number;
  visibleOrder: Array<string>;
}

export interface DuplicateLayerGroupLayerInput {
  duplicateName: string;
  layerId: string;
  newLayerId: string;
}

export interface CopyLayerMasksInput {
  createSubMaskId: (sourceSubMaskId: string, index: number) => string;
  sourceLayerId: string;
  syncLayerVisibility?: boolean;
  targetLayerId: string;
}

export class LayerStackOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerStackOperationError';
  }
}

export function clampLayerOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 100;
  return Math.max(0, Math.min(100, Math.round(opacity)));
}

export function findLayerIndex(layers: Array<MaskContainer>, layerId: string): number {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) {
    throw new LayerStackOperationError(`Layer ${layerId} does not exist.`);
  }
  return index;
}

export function setLayerVisibility(
  layers: Array<MaskContainer>,
  layerId: string,
  visible: boolean,
): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.map((layer) => (layer.id === layerId ? { ...layer, visible } : layer));
}

export function setLayerOpacity(layers: Array<MaskContainer>, layerId: string, opacity: number): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.map((layer) => (layer.id === layerId ? { ...layer, opacity: clampLayerOpacity(opacity) } : layer));
}

export function setLayerBlendMode(
  layers: Array<MaskContainer>,
  layerId: string,
  blendMode: LayerBlendMode,
): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.map((layer) => (layer.id === layerId ? { ...layer, blendMode } : layer));
}

export function normalizeLayerBlendMode(blendMode: string | undefined): LayerBlendMode {
  return LAYER_BLEND_MODES.find((candidate) => candidate === blendMode) ?? DEFAULT_LAYER_BLEND_MODE;
}

export function setLayerName(layers: Array<MaskContainer>, layerId: string, name: string): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  const nextName = name.trim();
  if (nextName.length === 0) {
    throw new LayerStackOperationError('Layer name must not be empty.');
  }

  return layers.map((layer) => (layer.id === layerId ? { ...layer, name: nextName } : layer));
}

export function setLayerGroupName(layers: Array<MaskContainer>, groupId: string, name: string): Array<MaskContainer> {
  findLayerGroupIndexes(layers, groupId);
  const nextName = name.trim();
  if (nextName.length === 0) {
    throw new LayerStackOperationError('Layer group name must not be empty.');
  }

  return layers.map((layer) => (layer.layerGroupId === groupId ? { ...layer, layerGroupName: nextName } : layer));
}

export function setLayerGroupOpacity(
  layers: Array<MaskContainer>,
  groupId: string,
  opacity: number,
): Array<MaskContainer> {
  findLayerGroupIndexes(layers, groupId);
  const nextOpacity = clampLayerOpacity(opacity);
  return layers.map((layer) => (layer.layerGroupId === groupId ? { ...layer, opacity: nextOpacity } : layer));
}

export function soloLayer(layers: Array<MaskContainer>, layerId: string): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.map((layer) => ({ ...layer, visible: layer.id === layerId }));
}

export function soloLayerGroup(layers: Array<MaskContainer>, groupId: string): Array<MaskContainer> {
  findLayerGroupIndexes(layers, groupId);
  return layers.map((layer) => ({ ...layer, visible: layer.layerGroupId === groupId }));
}

export function showAllLayers(layers: Array<MaskContainer>): Array<MaskContainer> {
  return layers.map((layer) => ({ ...layer, visible: true }));
}

export function createAdjustmentLayer(
  layers: Array<MaskContainer>,
  layer: MaskContainer,
  insertIndex = 0,
): Array<MaskContainer> {
  if (layers.some((existingLayer) => existingLayer.id === layer.id)) {
    throw new LayerStackOperationError(`Layer ${layer.id} already exists.`);
  }

  const nextLayer = structuredClone(layer);
  nextLayer.opacity = clampLayerOpacity(nextLayer.opacity);
  const clampedInsertIndex = Math.max(0, Math.min(layers.length, Math.round(insertIndex)));

  return [...layers.slice(0, clampedInsertIndex), nextLayer, ...layers.slice(clampedInsertIndex)];
}

export function deleteLayer(layers: Array<MaskContainer>, layerId: string): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.filter((layer) => layer.id !== layerId);
}

export function deleteLayerGroup(layers: Array<MaskContainer>, groupId: string): Array<MaskContainer> {
  if (!layers.some((layer) => layer.layerGroupId === groupId)) {
    throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
  }

  return layers.filter((layer) => layer.layerGroupId !== groupId);
}

export function duplicateLayer(
  layers: Array<MaskContainer>,
  layerId: string,
  newLayerId: string,
  duplicateName: string,
): Array<MaskContainer> {
  const sourceIndex = findLayerIndex(layers, layerId);
  const sourceLayer = layers[sourceIndex];
  if (!sourceLayer) {
    throw new LayerStackOperationError(`Layer ${layerId} does not exist.`);
  }

  const duplicate = structuredClone(sourceLayer);
  duplicate.id = newLayerId;
  duplicate.name = duplicateName;
  duplicate.subMasks = duplicate.subMasks.map((subMask) => ({
    ...subMask,
    id: `${newLayerId}-${subMask.id}`,
  }));

  return [...layers.slice(0, sourceIndex + 1), duplicate, ...layers.slice(sourceIndex + 1)];
}

export function copyLayerMasksToLayer(layers: Array<MaskContainer>, input: CopyLayerMasksInput): Array<MaskContainer> {
  const sourceLayer = layers[findLayerIndex(layers, input.sourceLayerId)];
  const targetLayer = layers[findLayerIndex(layers, input.targetLayerId)];
  if (sourceLayer === undefined || targetLayer === undefined) {
    throw new LayerStackOperationError('Copy mask source and target layers must exist.');
  }
  if (sourceLayer.subMasks.length === 0) {
    throw new LayerStackOperationError(`Layer ${input.sourceLayerId} has no masks to copy.`);
  }

  const copiedSubMasks = sourceLayer.subMasks.map((subMask, index) => ({
    ...structuredClone(subMask),
    id: input.createSubMaskId(subMask.id, index),
  }));

  return layers.map((layer) =>
    layer.id === input.targetLayerId
      ? {
          ...layer,
          subMasks: copiedSubMasks,
          visible: input.syncLayerVisibility === false ? layer.visible : sourceLayer.visible,
        }
      : layer,
  );
}

export function duplicateLayerGroup(
  layers: Array<MaskContainer>,
  groupId: string,
  newGroupId: string,
  duplicateGroupName: string,
  layerInputs: Array<DuplicateLayerGroupLayerInput>,
): Array<MaskContainer> {
  if (layers.some((layer) => layer.layerGroupId === newGroupId || layer.id === newGroupId)) {
    throw new LayerStackOperationError(`Layer group ${newGroupId} already exists.`);
  }

  const groupIndexes = findLayerGroupIndexes(layers, groupId);
  const groupLayers = groupIndexes.map((index) => {
    const layer = layers[index];
    if (layer === undefined) {
      throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
    }
    return layer;
  });
  if (groupLayers.length !== layerInputs.length) {
    throw new LayerStackOperationError(`Layer group ${groupId} duplicate input count does not match group size.`);
  }

  const inputsByLayerId = new Map(layerInputs.map((input) => [input.layerId, input]));
  const duplicatedLayerIds = new Set<string>();
  const duplicates = groupLayers.map((sourceLayer) => {
    const input = inputsByLayerId.get(sourceLayer.id);
    if (input === undefined) {
      throw new LayerStackOperationError(`Layer group ${groupId} duplicate input missing ${sourceLayer.id}.`);
    }
    if (duplicatedLayerIds.has(input.newLayerId) || layers.some((layer) => layer.id === input.newLayerId)) {
      throw new LayerStackOperationError(`Layer ${input.newLayerId} already exists.`);
    }
    duplicatedLayerIds.add(input.newLayerId);

    const duplicate = structuredClone(sourceLayer);
    duplicate.id = input.newLayerId;
    duplicate.name = input.duplicateName;
    duplicate.layerGroupId = newGroupId;
    duplicate.layerGroupName = duplicateGroupName;
    duplicate.subMasks = duplicate.subMasks.map((subMask) => ({
      ...subMask,
      id: `${input.newLayerId}-${subMask.id}`,
    }));
    return duplicate;
  });

  const insertIndex = groupIndexes.at(-1);
  if (insertIndex === undefined) {
    throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
  }

  return [...layers.slice(0, insertIndex + 1), ...duplicates, ...layers.slice(insertIndex + 1)];
}

export function moveLayer(
  layers: Array<MaskContainer>,
  layerId: string,
  direction: LayerStackMoveDirection,
): Array<MaskContainer> {
  const sourceIndex = findLayerIndex(layers, layerId);
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= layers.length) {
    return layers;
  }

  const nextLayers = [...layers];
  const [layer] = nextLayers.splice(sourceIndex, 1);
  if (!layer) {
    throw new LayerStackOperationError(`Layer ${layerId} does not exist.`);
  }
  nextLayers.splice(targetIndex, 0, layer);
  return nextLayers;
}

export function canGroupLayerWithNext(layers: Array<MaskContainer>, layerId: string): boolean {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0 || index >= layers.length - 1) return false;

  const layer = layers[index];
  const nextLayer = layers[index + 1];
  if (!layer || !nextLayer) return false;

  return layer.layerGroupId === undefined && nextLayer.layerGroupId === undefined;
}

export function groupLayerWithNext(
  layers: Array<MaskContainer>,
  layerId: string,
  groupId: string,
  groupName: string,
): Array<MaskContainer> {
  if (!canGroupLayerWithNext(layers, layerId)) {
    throw new LayerStackOperationError(
      'Layer groups support one flat adjacent pair; nested and non-adjacent groups are blocked.',
    );
  }

  const sourceIndex = findLayerIndex(layers, layerId);
  const groupedIds = new Set([layers[sourceIndex]?.id, layers[sourceIndex + 1]?.id]);
  return layers.map((layer) =>
    groupedIds.has(layer.id) ? { ...layer, layerGroupId: groupId, layerGroupName: groupName } : layer,
  );
}

export function ungroupLayerGroup(layers: Array<MaskContainer>, groupId: string): Array<MaskContainer> {
  if (!layers.some((layer) => layer.layerGroupId === groupId)) {
    throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
  }

  return layers.map(({ layerGroupId, layerGroupName, ...layer }) =>
    layerGroupId === groupId ? layer : { ...layer, ...groupFields(layerGroupId, layerGroupName) },
  );
}

export function moveLayerGroup(
  layers: Array<MaskContainer>,
  groupId: string,
  direction: LayerStackMoveDirection,
): Array<MaskContainer> {
  const groupIndexes = findLayerGroupIndexes(layers, groupId);

  const startIndex = groupIndexes[0];
  const endIndex = groupIndexes.at(-1);
  if (startIndex === undefined || endIndex === undefined) {
    throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
  }

  if (direction === 'up') {
    if (startIndex === 0) return layers;
    const previousGroupId = layers[startIndex - 1]?.layerGroupId;
    const insertIndex = previousGroupId
      ? layers.findIndex((layer) => layer.layerGroupId === previousGroupId)
      : startIndex - 1;
    return moveLayerBlock(layers, startIndex, endIndex, insertIndex);
  }

  if (endIndex >= layers.length - 1) return layers;
  const nextGroupId = layers[endIndex + 1]?.layerGroupId;
  const insertIndex = nextGroupId
    ? layers.findLastIndex((layer) => layer.layerGroupId === nextGroupId) + 1
    : endIndex + 2;
  return moveLayerBlock(layers, startIndex, endIndex, insertIndex);
}

export function buildLayerGroupSummaries(layers: Array<MaskContainer>): Array<LayerGroupSummary> {
  const groups = new Map<string, LayerGroupSummary>();
  for (const layer of layers) {
    if (!layer.layerGroupId) continue;
    const existing = groups.get(layer.layerGroupId);
    if (existing) {
      existing.layerCount += 1;
      existing.layerIds.push(layer.id);
      existing.opacity = clampLayerOpacity(
        (existing.opacity * (existing.layerCount - 1) + clampLayerOpacity(layer.opacity)) / existing.layerCount,
      );
      existing.visibleState = mergeGroupVisibleState(existing.visibleState, layer.visible);
      continue;
    }

    groups.set(layer.layerGroupId, {
      id: layer.layerGroupId,
      layerCount: 1,
      layerIds: [layer.id],
      name: layer.layerGroupName?.trim() || 'Layer Group',
      opacity: clampLayerOpacity(layer.opacity),
      visibleState: layer.visible ? 'visible' : 'hidden',
    });
  }

  return [...groups.values()];
}

export function buildLayerGroupWorkflowProof(
  layers: Array<MaskContainer>,
  collapsedGroupIds: ReadonlySet<string> = new Set(),
): LayerGroupWorkflowProof {
  const groupSummaries = buildLayerGroupSummaries(layers);
  const collapsedIds = groupSummaries.map((group) => group.id).filter((groupId) => collapsedGroupIds.has(groupId));

  return {
    collapsedGroupCount: collapsedIds.length,
    collapsedGroupIds: collapsedIds,
    groupCount: groupSummaries.length,
    hiddenGroupCount: groupSummaries.filter((group) => group.visibleState === 'hidden').length,
    groupedLayerCount: groupSummaries.reduce((count, group) => count + group.layerCount, 0),
    groups: groupSummaries.map((group) => ({ ...group, collapsed: collapsedGroupIds.has(group.id) })),
    mixedGroupCount: groupSummaries.filter((group) => group.visibleState === 'mixed').length,
    visibleGroupCount: groupSummaries.filter((group) => group.visibleState === 'visible').length,
    visibleOrder: layers.map((layer) => layer.id),
  };
}

export function buildLayerRenderPlan(layers: Array<MaskContainer>): Array<LayerRenderPlanItem> {
  return layers
    .filter((layer) => layer.visible && clampLayerOpacity(layer.opacity) > 0)
    .map((layer) => {
      const opacity = clampLayerOpacity(layer.opacity);
      const adjustmentKeys = Object.entries(layer.adjustments)
        .filter(([, value]) => typeof value === 'number' && value !== 0)
        .map(([key]) => key)
        .toSorted();

      return {
        adjustmentKeys,
        layerId: layer.id,
        name: layer.name,
        opacity,
        opacityFraction: opacity / 100,
        subMaskCount: layer.subMasks.length,
      };
    });
}

export function buildLayerExportReadinessSummary(layers: Array<MaskContainer>): LayerExportReadinessSummary {
  const groupIds = new Set<string>();
  let exportableLayerCount = 0;
  let hiddenLayerCount = 0;
  let maskedLayerCount = 0;

  for (const layer of layers) {
    if (typeof layer.layerGroupId === 'string') {
      groupIds.add(layer.layerGroupId);
    }
    if (!layer.visible) {
      hiddenLayerCount += 1;
    }
    if (layer.subMasks.length > 0) {
      maskedLayerCount += 1;
    }
    if (layer.visible && clampLayerOpacity(layer.opacity) > 0) {
      exportableLayerCount += 1;
    }
  }

  return {
    exportableLayerCount,
    groupCount: groupIds.size,
    hiddenLayerCount,
    maskedLayerCount,
    totalLayerCount: layers.length,
  };
}

function groupFields(layerGroupId: string | undefined, layerGroupName: string | undefined) {
  return layerGroupId === undefined ? {} : { layerGroupId, layerGroupName };
}

function mergeGroupVisibleState(
  currentState: LayerGroupSummary['visibleState'],
  nextVisible: boolean,
): LayerGroupSummary['visibleState'] {
  if (currentState === 'mixed') return 'mixed';
  if (currentState === 'visible' && nextVisible) return 'visible';
  if (currentState === 'hidden' && !nextVisible) return 'hidden';
  return 'mixed';
}

function findLayerGroupIndexes(layers: Array<MaskContainer>, groupId: string): Array<number> {
  const groupIndexes = layers
    .map((layer, index) => (layer.layerGroupId === groupId ? index : -1))
    .filter((index) => index >= 0);
  if (groupIndexes.length === 0) {
    throw new LayerStackOperationError(`Layer group ${groupId} does not exist.`);
  }
  return groupIndexes;
}

function moveLayerBlock(
  layers: Array<MaskContainer>,
  startIndex: number,
  endIndex: number,
  insertIndex: number,
): Array<MaskContainer> {
  const nextLayers = [...layers];
  const block = nextLayers.splice(startIndex, endIndex - startIndex + 1);
  const adjustedInsertIndex = insertIndex > startIndex ? insertIndex - block.length : insertIndex;
  nextLayers.splice(adjustedInsertIndex, 0, ...block);
  return nextLayers;
}
