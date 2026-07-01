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
    rawEngine: z
      .object({
        brushLocalAdjustmentReceipt: z.unknown().optional(),
        commandId: z.string().trim().min(1).optional(),
        contentHash: z.string().trim().min(1).optional(),
        coordinateSpace: z.string().trim().min(1).optional(),
        height: z.number().int().positive().optional(),
        width: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const flowBrushMaskParametersSchema = brushMaskParametersSchema
  .extend({
    flow: normalizedPercentSchema,
  })
  .strict();

export const linearGradientMaskParametersSchema = z
  .object({
    endX: z.number(),
    endY: z.number(),
    range: z.number().min(0).max(4096),
    startX: z.number(),
    startY: z.number(),
  })
  .strict();

export const radialGradientMaskParametersSchema = z
  .object({
    centerX: z.number(),
    centerY: z.number(),
    feather: z.number().min(0).max(1),
    radiusX: z.number().min(1).max(100_000),
    radiusY: z.number().min(1).max(100_000),
    rotation: z.number().min(-180).max(180),
  })
  .strict();

export const luminanceRangeMaskParametersSchema = z
  .object({
    maxLuma: z.number().min(0).max(1),
    minLuma: z.number().min(0).max(1),
    softness: z.number().min(0).max(1),
  })
  .strict()
  .refine((range) => range.minLuma < range.maxLuma, {
    message: 'Luminance range masks require minLuma below maxLuma.',
    path: ['minLuma'],
  });

export const colorRangeMaskParametersSchema = z
  .object({
    centerHueDegrees: z.number().min(0).max(360),
    feather: z.number().min(0).max(1),
    hueToleranceDegrees: z.number().min(1).max(180),
    maxLuma: z.number().min(0).max(1),
    maxSaturation: z.number().min(0).max(1),
    minLuma: z.number().min(0).max(1),
    minSaturation: z.number().min(0).max(1),
    rangeKind: z.literal('color'),
    rawEngine: z
      .object({
        colorMath: z.string().trim().min(1).optional(),
        colorRangeLocalAdjustmentReceipt: z.unknown().optional(),
        commandId: z.string().trim().min(1).optional(),
        contentHash: z.string().trim().min(1).optional(),
        height: z.number().int().positive().optional(),
        source: z.string().trim().min(1).optional(),
        width: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    sourceRangeKey: z.enum(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas']),
  })
  .strict()
  .refine((range) => range.minLuma < range.maxLuma, {
    message: 'Color range masks require minLuma below maxLuma.',
    path: ['minLuma'],
  })
  .refine((range) => range.minSaturation < range.maxSaturation, {
    message: 'Color range masks require minSaturation below maxSaturation.',
    path: ['minSaturation'],
  });

export const maskRefinementParametersSchema = z
  .object({
    density: z.number().min(0).max(1),
    edgeContrast: z.number().min(0).max(1),
    edgeShiftPx: z.number().min(-512).max(512),
    featherPx: z.number().min(0).max(4096),
    hairDetail: z.number().min(0).max(1),
    smoothness: z.number().min(0).max(1),
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
export type LinearGradientMaskParameters = z.infer<typeof linearGradientMaskParametersSchema>;
export type RadialGradientMaskParameters = z.infer<typeof radialGradientMaskParametersSchema>;
export type LuminanceRangeMaskParameters = z.infer<typeof luminanceRangeMaskParametersSchema>;
export type ColorRangeMaskParameters = z.infer<typeof colorRangeMaskParametersSchema>;
export type MaskRefinementParameters = z.infer<typeof maskRefinementParametersSchema>;
