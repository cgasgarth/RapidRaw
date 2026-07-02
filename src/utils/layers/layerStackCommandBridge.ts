import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  dispatchLayerStackCommand,
  type LayerBlendResolvedRemoveSource,
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskMutationResultV1,
  type LayerScopedToneAdjustmentV1,
  type LayerStackSidecarLayerV1,
  type LayerStackSidecarV1,
  layerMaskCommandEnvelopeV1Schema,
  layerStackSidecarV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
  type RetouchCloneSource,
  type RetouchRemoveSource,
} from '../adjustments';

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
      replaceExisting: boolean;
      subMask: MaskContainer['subMasks'][number];
      type: 'attachMask';
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

export interface LayerStackResolvedRemoveSourceApplication {
  appliedLayerIds: Array<string>;
  graphRevision: string;
  masks: Array<MaskContainer>;
  skippedLayerIds: Array<string>;
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

const toSidecarSubMask = (subMask: MaskContainer['subMasks'][number]) => ({
  ...structuredClone(subMask),
});

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
    subMasks: layer.subMasks.map(toSidecarSubMask),
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

export function applyResolvedRemoveSourcesToLayerStack(
  masks: ReadonlyArray<MaskContainer>,
  resolvedRemoveSources: ReadonlyArray<LayerBlendResolvedRemoveSource>,
  context: LayerStackCommandBridgeContext,
): LayerStackResolvedRemoveSourceApplication {
  let currentMasks = [...masks];
  let currentContext = bridgeContextSchema.parse(context);
  let sidecar = buildLayerStackSidecarFromMasks(currentMasks, currentContext);
  const appliedLayerIds: Array<string> = [];
  const skippedLayerIds: Array<string> = [];

  for (const resolvedSource of resolvedRemoveSources) {
    const currentLayer = currentMasks.find((mask) => mask.id === resolvedSource.layerId);
    if (currentLayer?.retouchRemoveSource === undefined) {
      skippedLayerIds.push(resolvedSource.layerId);
      continue;
    }
    if (currentLayer.retouchRemoveSource.targetMaskId !== resolvedSource.targetMaskId) {
      skippedLayerIds.push(resolvedSource.layerId);
      continue;
    }

    const nextSource = {
      ...currentLayer.retouchRemoveSource,
      status: resolvedSource.status,
    } satisfies RetouchRemoveSource;
    if (resolvedSource.status === 'ready') {
      if (resolvedSource.resolvedSourcePoint === undefined) {
        skippedLayerIds.push(resolvedSource.layerId);
        continue;
      }
      nextSource.resolvedSourcePoint = resolvedSource.resolvedSourcePoint;
    } else {
      delete nextSource.resolvedSourcePoint;
    }
    if (JSON.stringify(currentLayer.retouchRemoveSource) === JSON.stringify(nextSource)) {
      skippedLayerIds.push(resolvedSource.layerId);
      continue;
    }

    const result = applyLayerStackCommandBridgeOperation(
      currentMasks,
      {
        layerId: resolvedSource.layerId,
        retouchRemoveSource: nextSource,
        type: 'updateRetouchRemoveSource',
      },
      {
        ...currentContext,
        operationId: `${currentContext.operationId}_resolve_${operationIdPart(resolvedSource.layerId)}`,
      },
    );
    currentMasks = result.masks;
    currentContext = {
      ...currentContext,
      graphRevision: result.graphRevision,
      operationId: `${currentContext.operationId}_resolved`,
    };
    sidecar = result.sidecar;
    appliedLayerIds.push(resolvedSource.layerId);
  }

  return {
    appliedLayerIds,
    graphRevision: currentContext.graphRevision,
    masks: currentMasks,
    skippedLayerIds,
    sidecar,
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
    case 'attachMask':
      return layerMaskCommandEnvelopeV1Schema.parse({
        ...base,
        commandType: 'layerMask.attachMask',
        parameters: {
          layerId: operation.layerId,
          maskId: operation.subMask.id,
          replaceExisting: operation.replaceExisting,
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

function operationIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/gu, '_').slice(0, 64) || 'layer';
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
    const operationSubMasks =
      operation.type === 'attachMask' && operation.layerId === layer.id
        ? operation.replaceExisting
          ? [operation.subMask]
          : [...previous.subMasks.filter((subMask) => subMask.id !== operation.subMask.id), operation.subMask]
        : previous.subMasks;
    const serializedSubMasks = (layer.subMasks ?? []) as Array<MaskContainer['subMasks'][number]>;
    const availableSubMasks = [
      ...serializedSubMasks,
      ...operationSubMasks.filter(
        (subMask) => !serializedSubMasks.some((serializedSubMask) => serializedSubMask.id === subMask.id),
      ),
    ];
    const materializedMask: MaskContainer = {
      ...previous,
      adjustments: toMaskAdjustments(layer.adjustments?.toneColor, previous.adjustments),
      blendMode: layer.blendMode,
      id: layer.id,
      name: layer.name,
      opacity: Math.round(layer.opacity * 100),
      subMasks: materializeSubMasksFromIds(layer.maskIds, availableSubMasks),
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

function materializeSubMasksFromIds(
  maskIds: ReadonlyArray<string>,
  subMasks: ReadonlyArray<MaskContainer['subMasks'][number]>,
): Array<MaskContainer['subMasks'][number]> {
  const subMasksById = new Map(subMasks.map((subMask) => [subMask.id, subMask]));
  const orderedSubMasks = maskIds.flatMap((maskId) => {
    const subMask = subMasksById.get(maskId);
    return subMask === undefined ? [] : [subMask];
  });
  const orderedIds = new Set(orderedSubMasks.map((subMask) => subMask.id));
  return [...orderedSubMasks, ...subMasks.filter((subMask) => !orderedIds.has(subMask.id))];
}

export function materializeMasksFromLayerStackSidecar(
  sidecar: LayerStackSidecarV1,
  previousMasks: ReadonlyArray<MaskContainer> = [],
): Array<MaskContainer> {
  const parsedSidecar = layerStackSidecarV1Schema.safeParse(sidecar);
  if (!parsedSidecar.success) {
    throw new Error('Invalid layer stack sidecar data.');
  }
  return materializeMasksFromSidecar(parsedSidecar.data.layers, previousMasks, {
    type: 'delete',
    layerId: '__reload__',
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
