import { z } from 'zod';

const normalizedPercentSchema = z.number().min(0).max(100);

export const brushStrokePointSchema = z
  .object({
    pressure: z.number().min(0).max(1).optional(),
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const brushLineSchema = z
  .object({
    feather: normalizedPercentSchema,
    points: z.array(brushStrokePointSchema).min(1).max(4096),
    size: z.number().positive().max(1024),
    tool: z.enum(['brush', 'eraser']),
  })
  .strict();

export const brushMaskParametersSchema = z
  .object({
    lines: z.array(brushLineSchema).max(1024),
  })
  .strict();

export const flowBrushMaskParametersSchema = brushMaskParametersSchema
  .extend({
    flow: normalizedPercentSchema,
  })
  .strict();

export const aiDepthMaskParametersSchema = z.object({
  feather: z.number(),
  maxDepth: z.number(),
  maxFade: z.number(),
  minDepth: z.number(),
  minFade: z.number(),
});

export type AiDepthMaskParameters = z.infer<typeof aiDepthMaskParametersSchema>;
export type BrushLine = z.infer<typeof brushLineSchema>;
export type BrushMaskParameters = z.infer<typeof brushMaskParametersSchema>;
export type FlowBrushMaskParameters = z.infer<typeof flowBrushMaskParametersSchema>;
