import { z } from 'zod';

const finiteNumber = z.number().finite();
const axisBoundsSchema = z
  .object({ min: finiteNumber, max: finiteNumber })
  .strict()
  .refine((bounds) => bounds.min <= bounds.max, 'Bounds min must not exceed max.');

export const negativeLabRollBoundsSetSchema = z
  .object({
    axisBounds: z.object({ color: axisBoundsSchema, luma: axisBoundsSchema }).strict(),
    channelBounds: z.object({ b: axisBoundsSchema, g: axisBoundsSchema, r: axisBoundsSchema }).strict(),
  })
  .strict();

export const negativeLabRollBoundsFrameSchema = z
  .object({
    anchor: z.boolean(),
    eligible: z.boolean(),
    frameId: z.string().trim().min(1),
    localBounds: negativeLabRollBoundsSetSchema,
    sourceInterpretationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const negativeLabRollBoundsRequestSchema = z
  .object({
    analysisVersion: z.literal('fixed_grid_block_median_luma_color_v1'),
    frames: z.array(negativeLabRollBoundsFrameSchema).min(1),
    sourceInterpretationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    useRollColour: z.boolean(),
    useRollLuma: z.boolean(),
  })
  .strict();

export const negativeLabRollBoundsFrameResultSchema = z
  .object({
    anchor: z.boolean(),
    eligible: z.boolean(),
    finalBounds: negativeLabRollBoundsSetSchema,
    frameId: z.string().trim().min(1),
    localBounds: negativeLabRollBoundsSetSchema,
    rollBounds: negativeLabRollBoundsSetSchema,
  })
  .strict();

export const negativeLabRollBoundsReceiptSchema = z
  .object({
    algorithmId: z.literal('native_negative_lab_roll_bounds_v1'),
    analysisVersion: z.literal('fixed_grid_block_median_luma_color_v1'),
    frameResults: z.array(negativeLabRollBoundsFrameResultSchema).min(1),
    planHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    rollBounds: negativeLabRollBoundsSetSchema,
    schemaVersion: z.literal(1),
    sourceInterpretationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    useRollColour: z.boolean(),
    useRollLuma: z.boolean(),
    warningCodes: z.array(z.literal('single_frame_identity_plan')),
  })
  .strict();

export type NegativeLabRollBoundsRequest = z.infer<typeof negativeLabRollBoundsRequestSchema>;
export type NegativeLabRollBoundsReceipt = z.infer<typeof negativeLabRollBoundsReceiptSchema>;
