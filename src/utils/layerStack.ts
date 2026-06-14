import type { MaskContainer } from './adjustments';

export type LayerStackMoveDirection = 'down' | 'up';

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

export function deleteLayer(layers: Array<MaskContainer>, layerId: string): Array<MaskContainer> {
  findLayerIndex(layers, layerId);
  return layers.filter((layer) => layer.id !== layerId);
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
