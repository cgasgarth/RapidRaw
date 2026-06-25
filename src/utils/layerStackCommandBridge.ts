import { z } from 'zod';

import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  type RetouchCloneSource,
  type RetouchRemoveSource,
} from './adjustments';
import {
  ActorKind,
  ApprovalClass,
  dispatchLayerStackCommand,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  type LayerScopedToneAdjustmentV1,
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskMutationResultV1,
  type LayerStackSidecarLayerV1,
  type LayerStackSidecarV1,
} from '../../packages/rawengine-schema/src';

export type LayerStackCommandBridgeOperation =
  | {
      layer: MaskContainer;
      type: 'create';
    }
  | {
      layerId: string;
      opacity: number;
      type: 'setOpacity';
    }
  | {
      layerId: string;
      type: 'setVisibility';
      visible: boolean;
    }
  | {
      layerId: string;
      name: string;
      type: 'rename';
    }
  | {
      direction: 'down' | 'up';
      layerId: string;
      type: 'move';
    }
  | {
      layerId: string;
      name: string;
      newLayerId: string;
      type: 'duplicate';
    }
  | {
      layerId: string;
      toneColor: LayerScopedToneAdjustmentV1;
      type: 'applyToneAdjustment';
    }
  | {
      layerId: string;
      retouchCloneSource: RetouchCloneSource;
      type: 'updateRetouchSource';
    }
  | {
      layerId: string;
      retouchRemoveSource: RetouchRemoveSource;
      type: 'updateRetouchRemoveSource';
    }
  | {
      layerId: string;
      type: 'delete';
    };

export interface LayerStackCommandBridgeContext {
  graphRevision: string;
  imagePath: string;
  operationId: string;
  sessionId: string;
}

export interface LayerStackCommandBridgeResult {
  command: LayerMaskCommandEnvelopeV1;
  commandResult: LayerMaskMutationResultV1;
  graphRevision: string;
  masks: Array<MaskContainer>;
  sidecar: LayerStackSidecarV1;
}

const bridgeContextSchema = z
  .object({
    graphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

const clampOpacityFraction = (opacity: number): number => {
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity / 100));
};

const toSidecarLayer = (layer: MaskContainer): LayerStackSidecarLayerV1 => {
  const sidecarLayer: LayerStackSidecarLayerV1 = {
    adjustmentPreset: 'empty_adjustment_layer_v1',
    adjustments: {
      toneColor: toLayerScopedToneAdjustment(layer.adjustments),
    },
    blendMode: layer.blendMode ?? DEFAULT_LAYER_BLEND_MODE,
    id: layer.id,
    maskIds: layer.subMasks.map((subMask) => subMask.id),
    name: layer.name,
    opacity: clampOpacityFraction(layer.opacity),
    visible: layer.visible,
  };
  if (layer.retouchCloneSource !== undefined) {
    sidecarLayer.retouchCloneSource = layer.retouchCloneSource;
  }
  if (layer.retouchRemoveSource !== undefined) {
    sidecarLayer.retouchRemoveSource = layer.retouchRemoveSource;
  }
  return sidecarLayer;
};

export function buildLayerStackSidecarFromMasks(
  masks: ReadonlyArray<MaskContainer>,
  context: LayerStackCommandBridgeContext,
): LayerStackSidecarV1 {
  const parsedContext = bridgeContextSchema.parse(context);
  return {
    graphRevision: parsedContext.graphRevision,
    layers: masks.map(toSidecarLayer),
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceImagePath: parsedContext.imagePath,
    storage: 'sidecar_artifact',
  };
}

export function applyLayerStackCommandBridgeOperation(
  masks: ReadonlyArray<MaskContainer>,
  operation: LayerStackCommandBridgeOperation,
  context: LayerStackCommandBridgeContext,
): LayerStackCommandBridgeResult {
  const sidecar = buildLayerStackSidecarFromMasks(masks, context);
  const command = buildLayerStackCommand(operation, sidecar, context);
  const dispatched = dispatchLayerStackCommand(command, sidecar);
  if (!('sidecar' in dispatched)) throw new Error('Layer stack bridge expected an applied sidecar result.');

  return {
    command,
    commandResult: dispatched.commandResult,
    graphRevision: dispatched.sidecar.graphRevision,
    masks: materializeMasksFromSidecar(dispatched.sidecar.layers, masks, operation),
    sidecar: dispatched.sidecar,
  };
}

function buildLayerStackCommand(
  operation: LayerStackCommandBridgeOperation,
  sidecar: LayerStackSidecarV1,
  context: LayerStackCommandBridgeContext,
): LayerMaskCommandEnvelopeV1 {
  const parsedContext = bridgeContextSchema.parse(context);
  const commandId = `layer_stack_${parsedContext.operationId}`;
  const base = {
    actor: {
      id: 'rapidraw-ui',
      kind: ActorKind.Ui,
      sessionId: parsedContext.sessionId,
    },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Apply layer stack operation from the layer stack panel.',
      state: 'approved',
    },
    commandId,
    correlationId: `layer_stack_corr_${parsedContext.operationId}`,
    dryRun: false,
    expectedGraphRevision: sidecar.graphRevision,
    idempotencyKey: `layer_stack_idem_${parsedContext.operationId}`,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: parsedContext.imagePath,
      kind: 'image',
    },
  } as const;

  switch (operation.type) {
    case 'create': {
      const createLayerParameters = {
        blendMode: operation.layer.blendMode ?? DEFAULT_LAYER_BLEND_MODE,
        layerId: operation.layer.id,
        layerName: operation.layer.name,
        opacity: clampOpacityFraction(operation.layer.opacity),
        position: 'top',
        visible: operation.layer.visible,
      };
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.createLayer',
        parameters: {
          ...createLayerParameters,
          ...(operation.layer.retouchCloneSource === undefined
            ? {}
            : { retouchCloneSource: operation.layer.retouchCloneSource }),
          ...(operation.layer.retouchRemoveSource === undefined
            ? {}
            : { retouchRemoveSource: operation.layer.retouchRemoveSource }),
        },
      });
    }
    case 'setOpacity':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.setLayerOpacity',
        parameters: {
          layerId: operation.layerId,
          opacity: clampOpacityFraction(operation.opacity),
        },
      });
    case 'setVisibility':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.setLayerVisibility',
        parameters: {
          layerId: operation.layerId,
          visible: operation.visible,
        },
      });
    case 'rename':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.renameLayer',
        parameters: {
          layerId: operation.layerId,
          layerName: operation.name,
        },
      });
    case 'move':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.moveLayer',
        parameters: toMoveParameters(sidecar.layers, operation.layerId, operation.direction),
      });
    case 'duplicate':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.duplicateLayer',
        parameters: {
          layerId: operation.layerId,
          newLayerId: operation.newLayerId,
          newLayerName: operation.name,
          position: 'below_source',
        },
      });
    case 'applyToneAdjustment':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.applyLayerAdjustment',
        parameters: {
          adjustmentKind: 'tone_color',
          adjustmentParameters: operation.toneColor,
          layerId: operation.layerId,
        },
      });
    case 'updateRetouchSource':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.updateRetouchSource',
        parameters: {
          layerId: operation.layerId,
          retouchCloneSource: operation.retouchCloneSource,
        },
      });
    case 'updateRetouchRemoveSource':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.updateRetouchRemoveSource',
        parameters: {
          layerId: operation.layerId,
          retouchRemoveSource: operation.retouchRemoveSource,
        },
      });
    case 'delete':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.deleteLayer',
        parameters: {
          layerId: operation.layerId,
        },
      });
  }
}

function toMoveParameters(
  layers: ReadonlyArray<LayerStackSidecarLayerV1>,
  layerId: string,
  direction: 'down' | 'up',
): { layerId: string; position: 'above_layer' | 'below_layer'; referenceLayerId: string } {
  const sourceIndex = layers.findIndex((layer) => layer.id === layerId);
  if (sourceIndex < 0) throw new Error(`Layer ${layerId} does not exist.`);
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
  const referenceLayerId = layers[targetIndex]?.id;
  if (referenceLayerId === undefined) throw new Error(`Layer ${layerId} cannot move ${direction}.`);

  return {
    layerId,
    position: direction === 'up' ? 'above_layer' : 'below_layer',
    referenceLayerId,
  };
}

function materializeMasksFromSidecar(
  sidecarLayers: ReadonlyArray<LayerStackSidecarLayerV1>,
  previousMasks: ReadonlyArray<MaskContainer>,
  operation: LayerStackCommandBridgeOperation,
): Array<MaskContainer> {
  const previousById = new Map(previousMasks.map((mask) => [mask.id, mask]));

  return sidecarLayers.map((layer) => {
    const previous = previousById.get(layer.id) ?? cloneSourceForOperation(previousMasks, operation);
    const materializedMask: MaskContainer = {
      ...previous,
      adjustments: toMaskAdjustments(layer.adjustments?.toneColor, previous.adjustments),
      blendMode: layer.blendMode,
      id: layer.id,
      name: layer.name,
      opacity: Math.round(layer.opacity * 100),
      subMasks: previous.subMasks,
      visible: layer.visible,
    };
    if (layer.retouchCloneSource !== undefined) {
      materializedMask.retouchCloneSource = layer.retouchCloneSource;
    } else {
      delete materializedMask.retouchCloneSource;
    }
    if (layer.retouchRemoveSource !== undefined) {
      materializedMask.retouchRemoveSource = layer.retouchRemoveSource;
    } else {
      delete materializedMask.retouchRemoveSource;
    }
    return materializedMask;
  });
}

function cloneSourceForOperation(
  previousMasks: ReadonlyArray<MaskContainer>,
  operation: LayerStackCommandBridgeOperation,
): MaskContainer {
  if (operation.type === 'create') return structuredClone(operation.layer);
  if (operation.type === 'duplicate') {
    const source = previousMasks.find((mask) => mask.id === operation.layerId);
    if (source !== undefined) return structuredClone(source);
  }

  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: 'layer-stack-command-placeholder',
    invert: false,
    name: 'Layer',
    opacity: 100,
    subMasks: [],
    visible: true,
  };
}

export function toLayerScopedToneAdjustment(adjustments: MaskContainer['adjustments']): LayerScopedToneAdjustmentV1 {
  return {
    blackPoint: adjustments.blacks,
    clarity: adjustments.clarity,
    contrast: adjustments.contrast,
    exposureEv: adjustments.exposure,
    highlights: adjustments.highlights,
    saturation: adjustments.saturation,
    shadows: adjustments.shadows,
    whitePoint: adjustments.whites,
  };
}

function toMaskAdjustments(
  toneColor: LayerScopedToneAdjustmentV1 | undefined,
  fallback: MaskContainer['adjustments'],
): MaskContainer['adjustments'] {
  if (toneColor === undefined) return fallback;

  return {
    ...fallback,
    blacks: toneColor.blackPoint,
    clarity: toneColor.clarity,
    contrast: toneColor.contrast,
    exposure: toneColor.exposureEv,
    highlights: toneColor.highlights,
    saturation: toneColor.saturation,
    shadows: toneColor.shadows,
    whites: toneColor.whitePoint,
  };
}
