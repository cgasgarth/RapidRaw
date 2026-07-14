import { z } from 'zod';

import {
  type LayerMaskCommandEnvelopeV1,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src';
import { brushMaskParametersSchema, flowBrushMaskParametersSchema } from '../../schemas/masks/maskParameterSchemas';

export const BRUSH_MASK_COMMAND_SCHEMA_VERSION = RAW_ENGINE_SCHEMA_VERSION;
export const BRUSH_MASK_COMMAND_COORDINATE_SPACE = 'normalized_image' as const;

export type BrushMaskCommandEnvelope = Extract<
  LayerMaskCommandEnvelopeV1,
  { commandType: 'layerMask.createBrushMask' }
>;

const capturedBrushPointSchema = z
  .object({
    pressure: z.number().min(0).max(1).optional(),
    x: z.number(),
    y: z.number(),
  })
  .strict();

const capturedBrushLineSchema = z.union([
  z
    .object({
      brushSize: z.number().positive().max(4096),
      feather: z.number().min(0).max(1).optional(),
      flow: z.number().min(0).max(100).optional(),
      points: z.array(capturedBrushPointSchema).min(1).max(4096),
      tool: z.enum(['brush', 'eraser']),
    })
    .strict(),
  z
    .object({
      feather: z.number().min(0).max(100),
      points: z.array(capturedBrushPointSchema).min(1).max(4096),
      size: z.number().positive().max(1024),
      tool: z.enum(['brush', 'eraser']),
    })
    .strict(),
]);

const capturedBrushParametersSchema = z
  .object({
    flow: z.number().min(0).max(100).optional(),
    lines: z.array(capturedBrushLineSchema).min(1).max(1024),
    rawEngine: z.unknown().optional(),
  })
  .strict();

type CapturedBrushLine = z.infer<typeof capturedBrushLineSchema>;
type CapturedBrushParameters = z.infer<typeof capturedBrushParametersSchema>;

export interface BrushMaskCommandContext {
  expectedGraphRevision: string;
  imagePath: string;
  imageSize: {
    height: number;
    width: number;
  };
  maskId: string;
  maskName: string;
  operationId: string;
  sessionId: string;
}

export interface BrushMaskCommandReceipt {
  command: BrushMaskCommandEnvelope;
  commandHash: string;
  commandId: string;
  commandType: BrushMaskCommandEnvelope['commandType'];
  coordinateSpace: typeof BRUSH_MASK_COMMAND_COORDINATE_SPACE;
  dryRun: boolean;
  expectedGraphRevision: string;
  imagePath: string;
  lastPointCount: number;
  lastStrokeMode: BrushMaskCommandEnvelope['parameters']['strokes'][number]['mode'];
  maskId: string;
  operationId: string;
  pressurePointCount: number;
  receiptVersion: 1;
  schemaVersion: typeof RAW_ENGINE_SCHEMA_VERSION;
  strokeCount: number;
  validationStatus: 'shared-schema-valid';
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const normalizeCoordinate = (value: number, extent: number): number => clamp(value / Math.max(1, extent), 0, 1);
const roundMetric = (value: number): number => Number(value.toFixed(6));

export function buildBrushMaskCommandFromParameters(
  parameters: unknown,
  context: BrushMaskCommandContext,
  options: { dryRun: boolean },
): BrushMaskCommandEnvelope {
  const parsedParameters = parseBrushParameters(parameters);
  const envelope = {
    actor: {
      id: 'rapidraw-ui',
      kind: 'ui',
      sessionId: context.sessionId,
    },
    approval: {
      approvalClass: options.dryRun ? 'preview_only' : 'edit_apply',
      reason: options.dryRun ? 'Preview captured brush stroke mask.' : 'Apply captured brush stroke mask.',
      state: options.dryRun ? 'not_required' : 'approved',
    },
    commandId: `brush_mask_${context.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    commandType: 'layerMask.createBrushMask',
    correlationId: `brush_mask_corr_${context.operationId}`,
    dryRun: options.dryRun,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: `brush_mask_idem_${context.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    parameters: {
      baseMaskId: context.maskId,
      maskName: context.maskName,
      strokes: parsedParameters.lines.map((line, index) => lineToCommandStroke(line, parsedParameters, context, index)),
    },
    schemaVersion: BRUSH_MASK_COMMAND_SCHEMA_VERSION,
    target: {
      imagePath: context.imagePath,
      kind: 'image',
    },
  };

  const parsedEnvelope = layerMaskCommandEnvelopeV1Schema.parse(envelope);
  if (parsedEnvelope.commandType !== 'layerMask.createBrushMask') {
    throw new Error('Brush mask command bridge built an unexpected command type.');
  }
  return parsedEnvelope;
}

export function buildBrushMaskCommandReceiptFromParameters(
  parameters: unknown,
  context: BrushMaskCommandContext,
  options: { dryRun: boolean },
): BrushMaskCommandReceipt {
  const command = buildBrushMaskCommandFromParameters(parameters, context, options);
  const lastStroke = command.parameters.strokes.at(-1);
  const pressurePointCount = command.parameters.strokes.reduce(
    (count, stroke) => count + stroke.points.filter((point) => point.pressure !== undefined).length,
    0,
  );

  return {
    command,
    commandHash: hashStableJson(command),
    commandId: command.commandId,
    commandType: command.commandType,
    coordinateSpace: BRUSH_MASK_COMMAND_COORDINATE_SPACE,
    dryRun: command.dryRun,
    expectedGraphRevision: command.expectedGraphRevision,
    imagePath: context.imagePath,
    lastPointCount: lastStroke?.points.length ?? 0,
    lastStrokeMode: lastStroke?.mode ?? 'paint',
    maskId: context.maskId,
    operationId: context.operationId,
    pressurePointCount,
    receiptVersion: 1,
    schemaVersion: command.schemaVersion,
    strokeCount: command.parameters.strokes.length,
    validationStatus: 'shared-schema-valid',
  };
}

function parseBrushParameters(parameters: unknown): CapturedBrushParameters {
  const capturedResult = capturedBrushParametersSchema.safeParse(parameters);
  if (capturedResult.success) return capturedResult.data;
  const flowResult = flowBrushMaskParametersSchema.safeParse(parameters);
  if (flowResult.success) return capturedBrushParametersSchema.parse(flowResult.data);
  return capturedBrushParametersSchema.parse(brushMaskParametersSchema.parse(parameters));
}

function lineToCommandStroke(
  line: CapturedBrushLine,
  parameters: CapturedBrushParameters,
  context: BrushMaskCommandContext,
  index: number,
): BrushMaskCommandEnvelope['parameters']['strokes'][number] {
  const flowPercent = 'flow' in line && line.flow !== undefined ? line.flow : (parameters.flow ?? 100);
  const featherNormalized = 'brushSize' in line ? (line.feather ?? 0) : line.feather / 100;
  const radiusPx = 'brushSize' in line ? line.brushSize * 0.5 : line.size * 0.5;
  const firstPoint = line.points[0];
  if (firstPoint === undefined) {
    throw new Error('Brush command capture requires at least one point.');
  }
  const commandPoints = line.points.length === 1 ? [firstPoint, firstPoint] : line.points;

  return {
    flow: roundMetric(clamp(flowPercent / 100, 0, 1)),
    hardness: roundMetric(1 - featherNormalized),
    mode: line.tool === 'eraser' ? 'erase' : 'paint',
    points: commandPoints.map((point) => ({
      ...(point.pressure !== undefined ? { pressure: roundMetric(clamp(point.pressure, 0, 1)) } : {}),
      x: roundMetric(normalizeCoordinate(point.x, context.imageSize.width)),
      y: roundMetric(normalizeCoordinate(point.y, context.imageSize.height)),
    })),
    radiusPx: roundMetric(radiusPx),
    strokeId: `${context.maskId}_stroke_${index + 1}`,
  };
}

function hashStableJson(value: unknown): string {
  return `fnv1a32:${fnv1a32(JSON.stringify(value))}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
