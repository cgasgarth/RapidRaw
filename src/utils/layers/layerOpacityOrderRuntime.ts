import {
  type LayerBlendStackInput,
  type LayerBlendStackLayer,
  renderLayerBlendStack,
} from './layerPreviewExportParity';

export type LayerOpacityOrderRuntimeOperation =
  | { layerId: string; opacity: number; type: 'setOpacity' }
  | { layerId: string; type: 'setVisibility'; visible: boolean }
  | { layerId: string; toIndex: number; type: 'moveToIndex' };

export interface LayerOpacityOrderRuntimeInput extends LayerBlendStackInput {
  operations: ReadonlyArray<LayerOpacityOrderRuntimeOperation>;
}

export function renderLayerOpacityOrderRuntime(input: LayerOpacityOrderRuntimeInput) {
  return renderLayerBlendStack({
    ...input,
    layers: applyLayerOpacityOrderOperations(input.layers, input.operations),
  });
}

export function applyLayerOpacityOrderOperations(
  layers: ReadonlyArray<LayerBlendStackLayer>,
  operations: ReadonlyArray<LayerOpacityOrderRuntimeOperation>,
): Array<LayerBlendStackLayer> {
  return operations.reduce((nextLayers, operation) => applyLayerOperation(nextLayers, operation), [...layers]);
}

function applyLayerOperation(
  layers: Array<LayerBlendStackLayer>,
  operation: LayerOpacityOrderRuntimeOperation,
): Array<LayerBlendStackLayer> {
  const index = layers.findIndex((layer) => layer.id === operation.layerId);
  if (index < 0) {
    throw new Error(`Layer opacity/order runtime missing layer ${operation.layerId}.`);
  }

  if (operation.type === 'setOpacity') {
    return layers.map((layer) => (layer.id === operation.layerId ? { ...layer, opacity: operation.opacity } : layer));
  }

  if (operation.type === 'setVisibility') {
    return layers.map((layer) => (layer.id === operation.layerId ? { ...layer, visible: operation.visible } : layer));
  }

  const [layer] = layers.splice(index, 1);
  if (layer === undefined) {
    throw new Error(`Layer opacity/order runtime missing layer ${operation.layerId}.`);
  }
  layers.splice(Math.max(0, Math.min(operation.toIndex, layers.length)), 0, layer);
  return layers;
}
