import { z } from 'zod';

import { brushMaskParametersSchema, flowBrushMaskParametersSchema } from '../schemas/maskParameterSchemas';

export const BRUSH_MASK_COMMAND_SCHEMA_VERSION = 1;
export const BRUSH_MASK_COMMAND_COORDINATE_SPACE = 'normalized_image' as const;

const brushMaskPointCommandSchema = z
  .object({
    pressure: z.number().min(0).max(1).optional(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

const brushMaskStrokeCommandSchema = z
  .object({
    flow: z.number().min(0).max(1),
    hardness: z.number().min(0).max(1),
    mode: z.enum(['paint', 'erase']),
    points: z.array(brushMaskPointCommandSchema).min(2).max(4096),
    radiusPx: z.number().positive().max(2000),
    strokeId: z.string().trim().min(1),
  })
  .strict();

export const brushMaskCommandEnvelopeSchema = z
  .object({
    actor: z
      .object({
        id: z.string().trim().min(1),
        kind: z.literal('ui'),
        sessionId: z.string().trim().min(1).optional(),
      })
      .strict(),
    approval: z
      .object({
        approvalClass: z.enum(['edit_apply', 'preview_only']),
        reason: z.string().trim().min(1),
        state: z.enum(['approved', 'not_required']),
      })
      .strict(),
    commandId: z.string().trim().min(1),
    commandType: z.literal('layerMask.createBrushMask'),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        baseMaskId: z.string().trim().min(1).optional(),
        maskName: z.string().trim().min(1),
        strokes: z.array(brushMaskStrokeCommandSchema).min(1),
      })
      .strict(),
    schemaVersion: z.literal(BRUSH_MASK_COMMAND_SCHEMA_VERSION),
    target: z
      .object({
        imagePath: z.string().trim().min(1),
        kind: z.literal('image'),
      })
      .strict(),
  })
  .strict();

export type BrushMaskCommandEnvelope = z.infer<typeof brushMaskCommandEnvelopeSchema>;

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const normalizeCoordinate = (value: number, extent: number): number => clamp(value / Math.max(1, extent), 0, 1);
const roundMetric = (value: number): number => Number(value.toFixed(6));

export function buildBrushMaskCommandFromParameters(
  parameters: unknown,
  context: BrushMaskCommandContext,
  options: { dryRun: boolean },
): BrushMaskCommandEnvelope {
  const parsedParameters = parseBrushParameters(parameters);
  const envelope: BrushMaskCommandEnvelope = {
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

  return brushMaskCommandEnvelopeSchema.parse(envelope);
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
