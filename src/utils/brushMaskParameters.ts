import {
  type BrushLine,
  type BrushMaskParameters,
  brushMaskParametersSchema,
  type FlowBrushMaskParameters,
  flowBrushMaskParametersSchema,
} from '../schemas/masks/maskParameterSchemas';

export type BrushTool = BrushLine['tool'];

export interface BrushStrokeInput {
  feather: number;
  points: BrushLine['points'];
  size: number;
  tool: BrushTool;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizeBrushStroke(input: BrushStrokeInput): BrushLine {
  return {
    feather: clamp(input.feather, 0, 100, 50),
    points: input.points.map((point) => ({
      pressure: point.pressure === undefined ? undefined : clamp(point.pressure, 0, 1, 1),
      x: point.x,
      y: point.y,
    })),
    size: clamp(input.size, 1, 1024, 50),
    tool: input.tool,
  };
}

export function parseBrushMaskParameters(parameters: unknown): BrushMaskParameters {
  return brushMaskParametersSchema.parse(parameters);
}

export function parseFlowBrushMaskParameters(parameters: unknown): FlowBrushMaskParameters {
  return flowBrushMaskParametersSchema.parse(parameters);
}

export function appendBrushStroke(parameters: unknown, stroke: BrushStrokeInput): BrushMaskParameters {
  const parsed = brushMaskParametersSchema.catch({ lines: [] }).parse(parameters);
  return brushMaskParametersSchema.parse({
    lines: [...parsed.lines, normalizeBrushStroke(stroke)],
  });
}

export function setFlowBrushFlow(parameters: unknown, flow: number): FlowBrushMaskParameters {
  const parsed = flowBrushMaskParametersSchema.catch({ lines: [], flow: 10 }).parse(parameters);
  return flowBrushMaskParametersSchema.parse({
    ...parsed,
    flow: clamp(flow, 0, 100, 10),
  });
}
