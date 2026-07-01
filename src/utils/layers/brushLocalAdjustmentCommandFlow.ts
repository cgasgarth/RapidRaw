import { z } from 'zod';
import {
  BrushMaskCommandRuntime,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  type LayerScopedToneAdjustmentV1,
} from '../../../packages/rawengine-schema/src';
import { Mask, type SubMask, SubMaskMode } from '../../components/panel/right/layers/Masks';
import { DEFAULT_LAYER_BLEND_MODE, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../adjustments';
import {
  BRUSH_MASK_COMMAND_COORDINATE_SPACE,
  buildBrushMaskCommandFromParameters,
} from '../mask/brushMaskCommandBridge';
import {
  applyLayerStackCommandBridgeOperation,
  buildLayerStackSidecarFromMasks,
  type LayerStackCommandBridgeContext,
  type LayerStackCommandBridgeResult,
} from './layerStackCommandBridge';

export interface BrushLocalAdjustmentLayerInput {
  brushMaskName: string;
  brushParameters: unknown;
  context: LayerStackCommandBridgeContext;
  imageSize: {
    height: number;
    width: number;
  };
  layer: MaskContainer;
  toneColor: LayerScopedToneAdjustmentV1;
}

export interface BrushLocalAdjustmentLayerReceipt {
  afterPreviewHash: string;
  appliedGraphRevision: string;
  beforePreviewHash: string;
  brushCommandId: string;
  brushContentHash: string;
  brushDryRunPlanId: string;
  brushMaskId: string;
  brushMutationCommandId: string;
  brushStrokeCount: number;
  attachMaskCommandId: string;
  coordinateSpace: typeof BRUSH_MASK_COMMAND_COORDINATE_SPACE;
  createLayerCommandId: string;
  graphRevision: string;
  imagePath: string;
  layerId: string;
  operationId: string;
  receiptVersion: 1;
  replayKey: string;
  rollbackGraphRevision: string;
  sessionId: string;
  toneCommandId: string;
}

export interface BrushLocalAdjustmentLayerResult {
  brushApplyResult: LayerMaskMutationResultV1;
  brushDryRunResult: LayerMaskDryRunResultV1;
  attachMaskResult: LayerStackCommandBridgeResult;
  createLayerResult: LayerStackCommandBridgeResult;
  masks: Array<MaskContainer>;
  receipt: BrushLocalAdjustmentLayerReceipt;
  toneResult: LayerStackCommandBridgeResult;
}

const receiptSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    brushCommandId: z.string().trim().min(1),
    brushContentHash: z.string().trim().min(1),
    brushDryRunPlanId: z.string().trim().min(1),
    brushMaskId: z.string().trim().min(1),
    brushMutationCommandId: z.string().trim().min(1),
    brushStrokeCount: z.number().int().positive(),
    attachMaskCommandId: z.string().trim().min(1),
    coordinateSpace: z.literal(BRUSH_MASK_COMMAND_COORDINATE_SPACE),
    createLayerCommandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    receiptVersion: z.literal(1),
    replayKey: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    toneCommandId: z.string().trim().min(1),
  })
  .strict();

export const BRUSH_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY = 'brushLocalAdjustmentReceipt';

export function createBrushLocalAdjustmentSubMask(
  id: string,
  name: string,
  parameters: Record<string, unknown>,
): SubMask {
  return {
    id,
    invert: false,
    mode: SubMaskMode.Additive,
    name,
    opacity: 100,
    parameters,
    type: Mask.Brush,
    visible: true,
  };
}

export function createBrushLocalAdjustmentLayerDraft({
  layerId,
  maskId,
  maskName,
  name,
}: {
  layerId: string;
  maskId: string;
  maskName: string;
  name: string;
}): MaskContainer {
  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: layerId,
    invert: false,
    name,
    opacity: 100,
    subMasks: [createBrushLocalAdjustmentSubMask(maskId, maskName, { lines: [] })],
    visible: true,
  };
}

export function applyBrushLocalAdjustmentLayerFlow(
  masks: ReadonlyArray<MaskContainer>,
  input: BrushLocalAdjustmentLayerInput,
): BrushLocalAdjustmentLayerResult {
  const beforePreviewHash = hashJson({ context: input.context, masks });
  const createLayerResult = applyLayerStackCommandBridgeOperation(
    masks,
    { layer: input.layer, type: 'create' },
    input.context,
  );
  const createdLayer = createLayerResult.masks.find((mask) => mask.id === input.layer.id);
  const brushMask = createdLayer?.subMasks.find((subMask) => subMask.type === Mask.Brush);
  if (createdLayer === undefined || brushMask === undefined) {
    throw new Error('Brush local adjustment flow requires a created layer with a brush sub-mask.');
  }

  const brushRuntime = new BrushMaskCommandRuntime();
  const brushContext = {
    expectedGraphRevision: createLayerResult.graphRevision,
    imagePath: input.context.imagePath,
    imageSize: input.imageSize,
    maskId: brushMask.id,
    maskName: input.brushMaskName,
    operationId: `${input.context.operationId}_brush`,
    sessionId: input.context.sessionId,
  };
  const baseMask = {
    alpha: new Array<number>(input.imageSize.width * input.imageSize.height).fill(0),
    height: input.imageSize.height,
    maskId: brushMask.id,
    width: input.imageSize.width,
  };
  const dryRunCommand = buildBrushMaskCommandFromParameters(input.brushParameters, brushContext, { dryRun: true });
  const brushDryRunResult = brushRuntime.dispatch(dryRunCommand, { ...input.imageSize, baseMask });
  if (!brushDryRunResult.dryRun) throw new Error('Brush local adjustment flow expected a brush dry-run.');
  const applyCommand = buildBrushMaskCommandFromParameters(input.brushParameters, brushContext, { dryRun: false });
  const brushApplyResult = brushRuntime.dispatch(applyCommand, { ...input.imageSize, baseMask });
  if (brushApplyResult.dryRun) throw new Error('Brush local adjustment flow expected a brush mutation.');
  const brushArtifact = brushDryRunResult.maskArtifacts[0];
  if (brushArtifact === undefined) throw new Error('Brush local adjustment flow expected a mask artifact receipt.');

  const masksWithBrush = createLayerResult.masks.map((mask) =>
    mask.id === input.layer.id
      ? {
          ...mask,
          subMasks: mask.subMasks.map((subMask) =>
            subMask.id === brushMask.id
              ? {
                  ...subMask,
                  parameters: {
                    ...(typeof input.brushParameters === 'object' && input.brushParameters !== null
                      ? input.brushParameters
                      : {}),
                    rawEngine: {
                      commandId: applyCommand.commandId,
                      contentHash: brushArtifact.contentHash,
                      coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
                      height: input.imageSize.height,
                      width: input.imageSize.width,
                    },
                  },
                }
              : subMask,
          ),
        }
      : mask,
  );
  const brushSubMask = masksWithBrush
    .find((mask) => mask.id === input.layer.id)
    ?.subMasks.find((subMask) => subMask.id === brushMask.id);
  if (brushSubMask === undefined) throw new Error('Brush local adjustment flow could not materialize brush sub-mask.');
  const preAttachMasks = createLayerResult.masks.map((mask) =>
    mask.id === input.layer.id ? { ...mask, subMasks: [] } : mask,
  );
  const attachMaskResult = applyLayerStackCommandBridgeOperation(
    preAttachMasks,
    {
      layerId: input.layer.id,
      replaceExisting: false,
      subMask: brushSubMask,
      type: 'attachMask',
    },
    {
      ...input.context,
      graphRevision: brushApplyResult.appliedGraphRevision,
      operationId: `${input.context.operationId}_attach_mask`,
    },
  );

  const toneResult = applyLayerStackCommandBridgeOperation(
    attachMaskResult.masks,
    { layerId: input.layer.id, toneColor: input.toneColor, type: 'applyToneAdjustment' },
    {
      ...input.context,
      graphRevision: attachMaskResult.graphRevision,
      operationId: `${input.context.operationId}_tone`,
    },
  );
  const afterPreviewHash = hashJson({
    command: toneResult.command,
    masks: toneResult.masks,
    sidecar: toneResult.sidecar,
  });
  const receipt = receiptSchema.parse({
    afterPreviewHash,
    appliedGraphRevision: toneResult.graphRevision,
    beforePreviewHash,
    brushCommandId: dryRunCommand.commandId,
    brushContentHash: brushArtifact.contentHash,
    brushDryRunPlanId: brushDryRunResult.predictedGraphRevision,
    brushMaskId: brushMask.id,
    brushMutationCommandId: applyCommand.commandId,
    brushStrokeCount: applyCommand.parameters.strokes.length,
    coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
    createLayerCommandId: createLayerResult.command.commandId,
    graphRevision: toneResult.graphRevision,
    imagePath: input.context.imagePath,
    layerId: input.layer.id,
    operationId: input.context.operationId,
    receiptVersion: 1,
    replayKey: hashJson({ brush: applyCommand.parameters, layerId: input.layer.id, tone: input.toneColor }),
    rollbackGraphRevision: input.context.graphRevision,
    sessionId: input.context.sessionId,
    attachMaskCommandId: attachMaskResult.command.commandId,
    toneCommandId: toneResult.command.commandId,
  });

  const masksWithReceipt = toneResult.masks.map((mask) =>
    mask.id === input.layer.id
      ? {
          ...mask,
          subMasks: mask.subMasks.map((subMask) =>
            subMask.id === brushMask.id
              ? {
                  ...subMask,
                  parameters: {
                    ...(subMask.parameters ?? {}),
                    rawEngine: {
                      ...((subMask.parameters as { rawEngine?: Record<string, unknown> } | undefined)?.rawEngine ?? {}),
                      [BRUSH_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY]: receipt,
                    },
                  },
                }
              : subMask,
          ),
        }
      : mask,
  );
  const sidecarWithMaskIds = buildLayerStackSidecarFromMasks(masksWithReceipt, {
    ...input.context,
    graphRevision: toneResult.graphRevision,
    operationId: `${input.context.operationId}_receipt`,
  });

  return {
    attachMaskResult,
    brushApplyResult,
    brushDryRunResult,
    createLayerResult,
    masks: masksWithReceipt,
    receipt: {
      ...receipt,
      graphRevision: sidecarWithMaskIds.graphRevision,
    },
    toneResult: {
      ...toneResult,
      masks: masksWithReceipt,
      sidecar: sidecarWithMaskIds,
    },
  };
}

export function readBrushLocalAdjustmentReceipt(parameters: unknown): BrushLocalAdjustmentLayerReceipt | null {
  if (typeof parameters !== 'object' || parameters === null) return null;
  const rawEngine = (parameters as { rawEngine?: unknown }).rawEngine;
  if (typeof rawEngine !== 'object' || rawEngine === null) return null;
  const value = (rawEngine as Record<string, unknown>)[BRUSH_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY];
  const parsed = receiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function hashJson(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
