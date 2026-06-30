import { z } from 'zod';

import { layerScopedAdjustmentStateV1Schema, layerScopedToneAdjustmentV1Schema } from './layerScopedToneSchemas.js';
import {
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  type LayerMaskParameterDiffV1,
  layerMaskBlendModeV1Schema,
  layerMaskCloneSourceV1Schema,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  layerMaskRemoveSourceV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from './rawEngineSchemas.js';

export const layerStackSidecarLayerV1Schema = z
  .object({
    adjustmentPreset: z.literal('empty_adjustment_layer_v1'),
    adjustments: layerScopedAdjustmentStateV1Schema.optional(),
    blendMode: layerMaskBlendModeV1Schema,
    id: z.string().trim().min(1),
    maskIds: z.array(z.string().trim().min(1)),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    retouchCloneSource: layerMaskCloneSourceV1Schema.optional(),
    retouchRemoveSource: layerMaskRemoveSourceV1Schema.optional(),
    visible: z.boolean(),
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.retouchCloneSource !== undefined && layer.retouchRemoveSource !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Layer cannot have both clone/heal and remove retouch sources.',
        path: ['retouchRemoveSource'],
      });
    }
  });

export const layerStackSidecarV1Schema = z
  .object({
    graphRevision: z.string().trim().min(1),
    lastCommandId: z.string().trim().min(1).optional(),
    layers: z.array(layerStackSidecarLayerV1Schema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sourceImagePath: z.string().trim().min(1),
    storage: z.literal('sidecar_artifact'),
  })
  .strict()
  .superRefine((sidecar, context) => {
    const layerIds = sidecar.layers.map((layer) => layer.id);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({ code: 'custom', message: 'Layer stack sidecar layer IDs must be unique.', path: ['layers'] });
    }
  });

export const layerStackCommandDryRunDispatchResultSchema = z
  .object({
    commandResult: layerMaskDryRunResultV1Schema,
    predictedSidecar: layerStackSidecarV1Schema,
  })
  .strict();

export const layerStackCommandApplyDispatchResultSchema = z
  .object({
    commandResult: layerMaskMutationResultV1Schema,
    sidecar: layerStackSidecarV1Schema,
  })
  .strict();

export const layerStackCommandDispatchResultSchema = z.union([
  layerStackCommandDryRunDispatchResultSchema,
  layerStackCommandApplyDispatchResultSchema,
]);

export type LayerStackSidecarLayerV1 = z.infer<typeof layerStackSidecarLayerV1Schema>;
export type LayerStackSidecarV1 = z.infer<typeof layerStackSidecarV1Schema>;
export type LayerStackCommandDispatchResult = z.infer<typeof layerStackCommandDispatchResultSchema>;

type LayerStackCommand = Extract<
  LayerMaskCommandEnvelopeV1,
  {
    commandType:
      | 'layerMask.createLayer'
      | 'layerMask.deleteLayer'
      | 'layerMask.duplicateLayer'
      | 'layerMask.applyLayerAdjustment'
      | 'layerMask.moveLayer'
      | 'layerMask.renameLayer'
      | 'layerMask.setLayerOpacity'
      | 'layerMask.setLayerVisibility'
      | 'layerMask.updateRetouchRemoveSource'
      | 'layerMask.updateRetouchSource';
  }
>;

export class LayerStackCommandRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerStackCommandRuntimeError';
  }
}

const isLayerStackCommand = (command: LayerMaskCommandEnvelopeV1): command is LayerStackCommand =>
  [
    'layerMask.createLayer',
    'layerMask.setLayerOpacity',
    'layerMask.setLayerVisibility',
    'layerMask.renameLayer',
    'layerMask.duplicateLayer',
    'layerMask.applyLayerAdjustment',
    'layerMask.deleteLayer',
    'layerMask.moveLayer',
    'layerMask.updateRetouchRemoveSource',
    'layerMask.updateRetouchSource',
  ].includes(command.commandType);

const changedLayerIds = (
  before: ReadonlyArray<LayerStackSidecarLayerV1>,
  after: ReadonlyArray<LayerStackSidecarLayerV1>,
  command: LayerStackCommand,
): Array<string> => {
  const beforeById = new Map(before.map((layer) => [layer.id, layer]));
  const afterById = new Map(after.map((layer) => [layer.id, layer]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  const changedIds = new Set(
    [...ids].filter((id) => JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))),
  );

  const beforeOrder = before.map((layer) => layer.id).join('\u0000');
  const afterOrder = after.map((layer) => layer.id).join('\u0000');
  if (beforeOrder !== afterOrder) changedIds.add(toLayerId(command));

  return [...changedIds].toSorted();
};

const layerIndex = (layers: ReadonlyArray<LayerStackSidecarLayerV1>, layerId: string): number => {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new LayerStackCommandRuntimeError(`Layer ${layerId} does not exist.`);
  return index;
};

const requireUniqueLayerId = (layers: ReadonlyArray<LayerStackSidecarLayerV1>, layerId: string): void => {
  if (layers.some((layer) => layer.id === layerId)) {
    throw new LayerStackCommandRuntimeError(`Layer ${layerId} already exists.`);
  }
};

const insertLayer = (
  layers: ReadonlyArray<LayerStackSidecarLayerV1>,
  layer: LayerStackSidecarLayerV1,
  position: 'above_layer' | 'below_layer' | 'bottom' | 'top',
  referenceLayerId?: string,
): Array<LayerStackSidecarLayerV1> => {
  if (position === 'top') return [layer, ...layers];
  if (position === 'bottom') return [...layers, layer];

  if (referenceLayerId === undefined) {
    throw new LayerStackCommandRuntimeError('Relative layer insertion requires referenceLayerId.');
  }

  const referenceIndex = layerIndex(layers, referenceLayerId);
  const insertIndex = position === 'above_layer' ? referenceIndex : referenceIndex + 1;
  return [...layers.slice(0, insertIndex), layer, ...layers.slice(insertIndex)];
};

const moveLayer = (
  layers: ReadonlyArray<LayerStackSidecarLayerV1>,
  layerId: string,
  position: 'above_layer' | 'below_layer' | 'bottom' | 'top',
  referenceLayerId?: string,
): Array<LayerStackSidecarLayerV1> => {
  if (referenceLayerId === layerId) throw new LayerStackCommandRuntimeError('Layer cannot move relative to itself.');

  const sourceIndex = layerIndex(layers, layerId);
  const layer = layers[sourceIndex];
  if (layer === undefined) throw new LayerStackCommandRuntimeError(`Layer ${layerId} does not exist.`);

  const withoutLayer = [...layers.slice(0, sourceIndex), ...layers.slice(sourceIndex + 1)];
  return insertLayer(withoutLayer, layer, position, referenceLayerId);
};

const nextGraphRevision = (command: LayerStackCommand): string =>
  command.dryRun
    ? `${command.expectedGraphRevision}_preview_${command.commandId}`
    : `${command.expectedGraphRevision}_${command.commandId}`;

const toLayerId = (command: LayerStackCommand): string => {
  if (command.commandType === 'layerMask.createLayer')
    return command.parameters.layerId ?? `layer_${command.commandId}`;
  if (command.commandType === 'layerMask.duplicateLayer')
    return command.parameters.newLayerId ?? `${command.parameters.layerId}_copy`;
  return command.parameters.layerId;
};

const applyCommandToLayers = (
  command: LayerStackCommand,
  layers: ReadonlyArray<LayerStackSidecarLayerV1>,
): Array<LayerStackSidecarLayerV1> => {
  switch (command.commandType) {
    case 'layerMask.createLayer': {
      const layerId = toLayerId(command);
      requireUniqueLayerId(layers, layerId);
      return insertLayer(
        layers,
        {
          adjustmentPreset: 'empty_adjustment_layer_v1',
          adjustments: {},
          blendMode: command.parameters.blendMode,
          id: layerId,
          maskIds: [],
          name: command.parameters.layerName,
          opacity: command.parameters.opacity,
          retouchCloneSource: command.parameters.retouchCloneSource,
          retouchRemoveSource: command.parameters.retouchRemoveSource,
          visible: command.parameters.visible,
        },
        command.parameters.position,
        command.parameters.referenceLayerId,
      );
    }
    case 'layerMask.setLayerOpacity':
      return layers.map((layer) =>
        layer.id === command.parameters.layerId
          ? { ...layer, opacity: command.parameters.opacity, visible: command.parameters.visible ?? layer.visible }
          : layer,
      );
    case 'layerMask.setLayerVisibility':
      layerIndex(layers, command.parameters.layerId);
      return layers.map((layer) =>
        layer.id === command.parameters.layerId ? { ...layer, visible: command.parameters.visible } : layer,
      );
    case 'layerMask.renameLayer':
      layerIndex(layers, command.parameters.layerId);
      return layers.map((layer) =>
        layer.id === command.parameters.layerId ? { ...layer, name: command.parameters.layerName } : layer,
      );
    case 'layerMask.duplicateLayer': {
      const sourceIndex = layerIndex(layers, command.parameters.layerId);
      const sourceLayer = layers[sourceIndex];
      if (sourceLayer === undefined)
        throw new LayerStackCommandRuntimeError(`Layer ${command.parameters.layerId} does not exist.`);
      const newLayerId = toLayerId(command);
      requireUniqueLayerId(layers, newLayerId);
      const duplicate = {
        ...sourceLayer,
        id: newLayerId,
        maskIds: sourceLayer.maskIds.map((maskId) => `${newLayerId}_${maskId}`),
        name: command.parameters.newLayerName ?? `${sourceLayer.name} Copy`,
      };
      const insertIndex = command.parameters.position === 'above_source' ? sourceIndex : sourceIndex + 1;
      return [...layers.slice(0, insertIndex), duplicate, ...layers.slice(insertIndex)];
    }
    case 'layerMask.applyLayerAdjustment': {
      layerIndex(layers, command.parameters.layerId);
      if (command.parameters.adjustmentKind !== 'tone_color') {
        throw new LayerStackCommandRuntimeError(
          `Unsupported layer adjustment kind ${command.parameters.adjustmentKind}.`,
        );
      }
      const toneColor = layerScopedToneAdjustmentV1Schema.parse(command.parameters.adjustmentParameters);
      return layers.map((layer) =>
        layer.id === command.parameters.layerId
          ? { ...layer, adjustments: { ...layer.adjustments, toneColor } }
          : layer,
      );
    }
    case 'layerMask.deleteLayer':
      layerIndex(layers, command.parameters.layerId);
      return layers.filter((layer) => layer.id !== command.parameters.layerId);
    case 'layerMask.moveLayer':
      return moveLayer(
        layers,
        command.parameters.layerId,
        command.parameters.position,
        command.parameters.referenceLayerId,
      );
    case 'layerMask.updateRetouchSource':
      layerIndex(layers, command.parameters.layerId);
      return layers.map((layer) =>
        layer.id === command.parameters.layerId
          ? { ...layer, retouchCloneSource: command.parameters.retouchCloneSource, retouchRemoveSource: undefined }
          : layer,
      );
    case 'layerMask.updateRetouchRemoveSource':
      layerIndex(layers, command.parameters.layerId);
      return layers.map((layer) =>
        layer.id === command.parameters.layerId
          ? { ...layer, retouchCloneSource: undefined, retouchRemoveSource: command.parameters.retouchRemoveSource }
          : layer,
      );
  }
};

const buildParameterDiff = (
  before: LayerStackSidecarV1,
  after: LayerStackSidecarV1,
  command: LayerStackCommand,
): Array<LayerMaskParameterDiffV1> => [
  {
    entityId: toLayerId(command),
    entityKind: command.commandType === 'layerMask.moveLayer' ? 'layer_stack' : 'layer',
    path: '/layers',
    previousValue: before.layers,
    value: after.layers,
  },
];

export function dispatchLayerStackCommand(
  inputCommand: LayerMaskCommandEnvelopeV1,
  inputSidecar: LayerStackSidecarV1,
): LayerStackCommandDispatchResult {
  const commandEnvelope = layerMaskCommandEnvelopeV1Schema.parse(inputCommand);
  if (!isLayerStackCommand(commandEnvelope)) {
    throw new LayerStackCommandRuntimeError(`Unsupported layer stack command ${commandEnvelope.commandType}.`);
  }

  const command = commandEnvelope;
  const sidecar = layerStackSidecarV1Schema.parse(inputSidecar);
  if (command.expectedGraphRevision !== sidecar.graphRevision) {
    throw new LayerStackCommandRuntimeError(
      `Command expected ${command.expectedGraphRevision} but sidecar is ${sidecar.graphRevision}.`,
    );
  }
  const nextSidecar = layerStackSidecarV1Schema.parse({
    ...sidecar,
    graphRevision: nextGraphRevision(command),
    lastCommandId: command.commandId,
    layers: applyCommandToLayers(command, sidecar.layers),
  });

  if (command.dryRun) {
    return layerStackCommandDryRunDispatchResultSchema.parse({
      commandResult: {
        commandId: command.commandId,
        commandType: command.commandType,
        correlationId: command.correlationId,
        dryRun: true,
        maskArtifacts: [],
        mutates: false,
        parameterDiff: buildParameterDiff(sidecar, nextSidecar, command),
        predictedGraphRevision: nextSidecar.graphRevision,
        previewArtifacts: [],
        schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
        sourceGraphRevision: sidecar.graphRevision,
        warnings: [],
      } satisfies LayerMaskDryRunResultV1,
      predictedSidecar: nextSidecar,
    });
  }

  return layerStackCommandApplyDispatchResultSchema.parse({
    commandResult: {
      appliedGraphRevision: nextSidecar.graphRevision,
      changedLayerIds: changedLayerIds(sidecar.layers, nextSidecar.layers, command),
      changedMaskIds: [],
      changedNodeIds: [],
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId: command.correlationId,
      dryRun: false,
      mutates: true,
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      sourceGraphRevision: sidecar.graphRevision,
      undoRevision: sidecar.graphRevision,
      warnings: [],
    } satisfies LayerMaskMutationResultV1,
    sidecar: nextSidecar,
  });
}
