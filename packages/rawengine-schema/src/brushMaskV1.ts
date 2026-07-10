import { z } from 'zod';

const finite01 = z.number().finite().min(0).max(1);

export const brushMaskPointV1Schema = z.object({ pressure: finite01.optional(), x: finite01, y: finite01 }).strict();

export const brushMaskStrokeV1Schema = z
  .object({
    flow: finite01,
    hardness: finite01,
    id: z.string().trim().min(1),
    points: z.array(brushMaskPointV1Schema).min(1).max(4096),
    radius: z.number().finite().positive().max(1),
  })
  .strict();

export const brushMaskV1Schema = z
  .object({
    coordinateSpace: z.literal('oriented_active_image_normalized_v1'),
    id: z.string().trim().min(1),
    mode: z.literal('add'),
    opacity: finite01,
    radiusUnit: z.literal('normalized_max_dimension'),
    strokes: z.array(brushMaskStrokeV1Schema).min(1).max(1024),
    type: z.literal('brush_v1'),
  })
  .strict();

export type BrushMaskV1 = z.infer<typeof brushMaskV1Schema>;
