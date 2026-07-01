import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  type LayerScopedToneAdjustmentV1,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  RangeMaskCommandRuntime,
} from '../../../packages/rawengine-schema/src';
import { Mask, type SubMask, SubMaskMode } from '../../components/panel/right/layers/Masks';
import {
  type ColorRangeMaskParameters,
  colorRangeMaskParametersSchema,
} from '../../schemas/masks/maskParameterSchemas';
import { DEFAULT_LAYER_BLEND_MODE, INITIAL_MASK_ADJUSTMENTS, type MaskContainer } from '../adjustments';
import { getSelectiveColorRange, type SelectiveColorRangeKey } from '../selectiveColorRanges';
import {
  applyLayerStackCommandBridgeOperation,
  buildLayerStackSidecarFromMasks,
  type LayerStackCommandBridgeContext,
  type LayerStackCommandBridgeResult,
} from './layerStackCommandBridge';

export const COLOR_RANGE_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY = 'colorRangeLocalAdjustmentReceipt';

export interface ColorRangeLocalAdjustmentLayerInput {
  colorRangeParameters: ColorRangeMaskParameters;
  context: LayerStackCommandBridgeContext;
  imageSize: {
    height: number;
    width: number;
  };
  layer: MaskContainer;
  maskName: string;
  sourceRgbPixels: Array<number>;
  toneColor: LayerScopedToneAdjustmentV1;
}

export interface ColorRangeLocalAdjustmentLayerReceipt {
  afterPreviewHash: string;
  appliedGraphRevision: string;
  attachMaskCommandId: string;
  beforePreviewHash: string;
  colorMath: 'encoded_rgb_hsv_rec709_luma_v1';
  colorRangeApplyCommandId: string;
  colorRangeContentHash: string;
  colorRangeDryRunPlanId: string;
  colorRangeMaskId: string;
  createLayerCommandId: string;
  graphRevision: string;
  imagePath: string;
  layerId: string;
  maskStats: {
    maxAlpha: number;
    meanAlpha: number;
    nonzeroAlphaRatio: number;
    warningCodes: Array<'empty_selection' | 'tiny_selection'>;
  };
  operationId: string;
  receiptVersion: 1;
  replayKey: string;
  rollbackGraphRevision: string;
  selectedImagePath: string;
  sessionId: string;
  source: 'working_rgb';
  sourceColorRangeParameters: ColorRangeMaskParameters;
  sourceRangeKey: SelectiveColorRangeKey;
  toneCommandId: string;
}

export interface ColorRangeLocalAdjustmentLayerResult {
  attachMaskResult: LayerStackCommandBridgeResult;
  colorRangeApplyResult: LayerMaskMutationResultV1;
  colorRangeDryRunResult: LayerMaskDryRunResultV1;
  createLayerResult: LayerStackCommandBridgeResult;
  masks: Array<MaskContainer>;
  receipt: ColorRangeLocalAdjustmentLayerReceipt;
  toneResult: LayerStackCommandBridgeResult;
}

const receiptSchema = z
  .object({
    afterPreviewHash: z.string().trim().min(1),
    appliedGraphRevision: z.string().trim().min(1),
    attachMaskCommandId: z.string().trim().min(1),
    beforePreviewHash: z.string().trim().min(1),
    colorMath: z.literal('encoded_rgb_hsv_rec709_luma_v1'),
    colorRangeApplyCommandId: z.string().trim().min(1),
    colorRangeContentHash: z.string().trim().min(1),
    colorRangeDryRunPlanId: z.string().trim().min(1),
    colorRangeMaskId: z.string().trim().min(1),
    createLayerCommandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    layerId: z.string().trim().min(1),
    maskStats: z
      .object({
        maxAlpha: z.number().min(0).max(1),
        meanAlpha: z.number().min(0).max(1),
        nonzeroAlphaRatio: z.number().min(0).max(1),
        warningCodes: z.array(z.enum(['empty_selection', 'tiny_selection'])),
      })
      .strict(),
    operationId: z.string().trim().min(1),
    receiptVersion: z.literal(1),
    replayKey: z.string().trim().min(1),
    rollbackGraphRevision: z.string().trim().min(1),
    selectedImagePath: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    source: z.literal('working_rgb'),
    sourceColorRangeParameters: colorRangeMaskParametersSchema,
    sourceRangeKey: z.enum(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas']),
    toneCommandId: z.string().trim().min(1),
  })
  .strict();

export function createColorRangeLocalAdjustmentSubMask(
  id: string,
  name: string,
  parameters: ColorRangeMaskParameters,
): SubMask {
  return {
    id,
    invert: false,
    mode: SubMaskMode.Additive,
    name,
    opacity: 100,
    parameters,
    type: Mask.Color,
    visible: true,
  };
}

export function createColorRangeLocalAdjustmentLayerDraft({
  layerId,
  maskId,
  maskName,
  name,
  parameters,
}: {
  layerId: string;
  maskId: string;
  maskName: string;
  name: string;
  parameters: ColorRangeMaskParameters;
}): MaskContainer {
  return {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: layerId,
    invert: false,
    name,
    opacity: 100,
    subMasks: [createColorRangeLocalAdjustmentSubMask(maskId, maskName, parameters)],
    visible: true,
  };
}

export function applyColorRangeLocalAdjustmentLayerFlow(
  masks: ReadonlyArray<MaskContainer>,
  input: ColorRangeLocalAdjustmentLayerInput,
): ColorRangeLocalAdjustmentLayerResult {
  const beforePreviewHash = hashJson({ context: input.context, masks });
  const createLayerResult = applyLayerStackCommandBridgeOperation(
    masks,
    { layer: input.layer, type: 'create' },
    input.context,
  );
  const createdLayer = createLayerResult.masks.find((mask) => mask.id === input.layer.id);
  const colorRangeMask = createdLayer?.subMasks.find((subMask) => subMask.type === Mask.Color);
  if (createdLayer === undefined || colorRangeMask === undefined) {
    throw new Error('Color range local adjustment flow requires a created layer with a color sub-mask.');
  }

  const runtime = new RangeMaskCommandRuntime();
  const rangeContext = {
    expectedGraphRevision: createLayerResult.graphRevision,
    imagePath: input.context.imagePath,
    maskId: colorRangeMask.id,
    maskName: input.maskName,
    operationId: `${input.context.operationId}_range`,
    sessionId: input.context.sessionId,
  };
  const dryRunCommand = buildColorRangeMaskCommand(input.colorRangeParameters, rangeContext, { dryRun: true });
  const colorRangeDryRunResult = runtime.dispatch(dryRunCommand, {
    ...input.imageSize,
    maskId: colorRangeMask.id,
    sourceRgbPixels: input.sourceRgbPixels,
  });
  if (!colorRangeDryRunResult.dryRun) throw new Error('Color range flow expected a range-mask dry-run.');
  const applyCommand = buildColorRangeMaskCommand(input.colorRangeParameters, rangeContext, { dryRun: false });
  const colorRangeApplyResult = runtime.dispatch(applyCommand, {
    ...input.imageSize,
    maskId: colorRangeMask.id,
    sourceRgbPixels: input.sourceRgbPixels,
  });
  if (colorRangeApplyResult.dryRun) throw new Error('Color range flow expected a range-mask mutation.');
  const artifact = colorRangeDryRunResult.maskArtifacts[0];
  if (artifact === undefined) throw new Error('Color range flow expected a mask artifact receipt.');
  const stats = readRangeMaskStats(colorRangeDryRunResult);

  const masksWithRange = createLayerResult.masks.map((mask) =>
    mask.id === input.layer.id
      ? {
          ...mask,
          subMasks: mask.subMasks.map((subMask) =>
            subMask.id === colorRangeMask.id
              ? {
                  ...subMask,
                  parameters: {
                    ...input.colorRangeParameters,
                    rawEngine: {
                      colorMath: 'encoded_rgb_hsv_rec709_luma_v1',
                      commandId: applyCommand.commandId,
                      contentHash: artifact.contentHash,
                      height: input.imageSize.height,
                      source: 'working_rgb',
                      width: input.imageSize.width,
                    },
                  },
                }
              : subMask,
          ),
        }
      : mask,
  );
  const materializedSubMask = masksWithRange
    .find((mask) => mask.id === input.layer.id)
    ?.subMasks.find((subMask) => subMask.id === colorRangeMask.id);
  if (materializedSubMask === undefined) {
    throw new Error('Color range flow could not materialize color range sub-mask.');
  }
  const preAttachMasks = createLayerResult.masks.map((mask) =>
    mask.id === input.layer.id ? { ...mask, subMasks: [] } : mask,
  );
  const attachMaskResult = applyLayerStackCommandBridgeOperation(
    preAttachMasks,
    {
      layerId: input.layer.id,
      replaceExisting: false,
      subMask: materializedSubMask,
      type: 'attachMask',
    },
    {
      ...input.context,
      graphRevision: colorRangeApplyResult.appliedGraphRevision,
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
    attachMaskCommandId: attachMaskResult.command.commandId,
    beforePreviewHash,
    colorMath: 'encoded_rgb_hsv_rec709_luma_v1',
    colorRangeApplyCommandId: applyCommand.commandId,
    colorRangeContentHash: artifact.contentHash,
    colorRangeDryRunPlanId: colorRangeDryRunResult.predictedGraphRevision,
    colorRangeMaskId: colorRangeMask.id,
    createLayerCommandId: createLayerResult.command.commandId,
    graphRevision: toneResult.graphRevision,
    imagePath: input.context.imagePath,
    layerId: input.layer.id,
    maskStats: stats,
    operationId: input.context.operationId,
    receiptVersion: 1,
    replayKey: hashJson({
      layerId: input.layer.id,
      range: input.colorRangeParameters,
      sourceHash: hashJson(input.sourceRgbPixels),
      tone: input.toneColor,
    }),
    rollbackGraphRevision: input.context.graphRevision,
    selectedImagePath: input.context.imagePath,
    sessionId: input.context.sessionId,
    source: 'working_rgb',
    sourceColorRangeParameters: input.colorRangeParameters,
    sourceRangeKey: input.colorRangeParameters.sourceRangeKey,
    toneCommandId: toneResult.command.commandId,
  });
  const masksWithReceipt = toneResult.masks.map((mask) =>
    mask.id === input.layer.id
      ? {
          ...mask,
          subMasks: mask.subMasks.map((subMask) =>
            subMask.id === colorRangeMask.id
              ? {
                  ...subMask,
                  parameters: {
                    ...(subMask.parameters ?? {}),
                    rawEngine: {
                      ...((subMask.parameters as { rawEngine?: Record<string, unknown> } | undefined)?.rawEngine ?? {}),
                      [COLOR_RANGE_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY]: receipt,
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
    colorRangeApplyResult,
    colorRangeDryRunResult,
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

export function readColorRangeLocalAdjustmentReceipt(
  parameters: unknown,
): ColorRangeLocalAdjustmentLayerReceipt | null {
  if (typeof parameters !== 'object' || parameters === null) return null;
  const rawEngine = (parameters as { rawEngine?: unknown }).rawEngine;
  if (typeof rawEngine !== 'object' || rawEngine === null) return null;
  const value = (rawEngine as Record<string, unknown>)[COLOR_RANGE_LOCAL_ADJUSTMENT_RECEIPT_PARAMETER_KEY];
  const parsed = receiptSchema.safeParse(value);
  return parsed.success ? (parsed.data as ColorRangeLocalAdjustmentLayerReceipt) : null;
}

export function buildColorRangeProposalSourcePixels(rangeKey: SelectiveColorRangeKey): Array<number> {
  const range = getSelectiveColorRange(rangeKey);
  const pixels: Array<number> = [];
  for (let index = 0; index < 64; index += 1) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    const inRange = column < 5 && row > 0 && row < 7;
    const hueOffset = inRange ? (column - 2) * (range.widthDegrees / 8) : 180;
    const saturation = inRange ? 0.72 + row * 0.025 : 0.08;
    const value = inRange ? 0.72 : 0.34;
    pixels.push(...hsvToRgb((((range.centerHueDegrees + hueOffset) % 360) + 360) % 360, saturation, value));
  }
  return pixels;
}

function buildColorRangeMaskCommand(
  parameters: ColorRangeMaskParameters,
  context: {
    expectedGraphRevision: string;
    imagePath: string;
    maskId: string;
    maskName: string;
    operationId: string;
    sessionId: string;
  },
  options: { dryRun: boolean },
): LayerMaskCommandEnvelopeV1 {
  return layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rapidraw-ui',
      kind: ActorKind.Ui,
      sessionId: context.sessionId,
    },
    approval: {
      approvalClass: options.dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: options.dryRun ? 'Preview color range mask.' : 'Apply color range mask.',
      state: options.dryRun ? 'not_required' : 'approved',
    },
    commandId: `color_range_mask_${context.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    commandType: 'layerMask.createRangeMask',
    correlationId: `color_range_mask_corr_${context.operationId}`,
    dryRun: options.dryRun,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: `color_range_mask_idem_${context.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    parameters: {
      maskName: context.maskName,
      selection: {
        centerHueDegrees: parameters.centerHueDegrees,
        feather: parameters.feather,
        hueToleranceDegrees: parameters.hueToleranceDegrees,
        maxLuma: parameters.maxLuma,
        maxSaturation: parameters.maxSaturation,
        minLuma: parameters.minLuma,
        minSaturation: parameters.minSaturation,
        rangeKind: 'color',
      },
      source: 'working_rgb',
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: context.imagePath,
      kind: 'image',
    },
  });
}

function readRangeMaskStats(result: LayerMaskDryRunResultV1): ColorRangeLocalAdjustmentLayerReceipt['maskStats'] {
  const diff = result.parameterDiff.find((candidate) => candidate.path === '/masks/-');
  const value = diff?.value;
  if (typeof value !== 'object' || value === null) {
    throw new Error('Color range dry-run result did not include mask stats.');
  }
  const stats = (value as { stats?: unknown }).stats;
  return receiptSchema.shape.maskStats.parse(stats);
}

function hsvToRgb(hueDegrees: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation;
  const huePrime = hueDegrees / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [red1, green1, blue1] =
    huePrime < 1
      ? [chroma, x, 0]
      : huePrime < 2
        ? [x, chroma, 0]
        : huePrime < 3
          ? [0, chroma, x]
          : huePrime < 4
            ? [0, x, chroma]
            : huePrime < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const match = value - chroma;
  return [red1 + match, green1 + match, blue1 + match];
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
