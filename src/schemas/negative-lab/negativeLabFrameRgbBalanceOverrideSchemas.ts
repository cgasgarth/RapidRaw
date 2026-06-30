import { z } from 'zod';

export const NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION = 1;
export const NEGATIVE_LAB_FRAME_RGB_BALANCE_MIN_WEIGHT = 0.5;
export const NEGATIVE_LAB_FRAME_RGB_BALANCE_MAX_WEIGHT = 2;
export const NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP = 0.01;

const snappedWeightSchema = z
  .number()
  .min(NEGATIVE_LAB_FRAME_RGB_BALANCE_MIN_WEIGHT)
  .max(NEGATIVE_LAB_FRAME_RGB_BALANCE_MAX_WEIGHT);
const snappedOffsetSchema = z.number().min(-1.5).max(1.5);

export const negativeLabFrameRgbBalanceSchema = z
  .object({
    blueWeight: snappedWeightSchema,
    greenWeight: snappedWeightSchema,
    redWeight: snappedWeightSchema,
  })
  .strict()
  .superRefine((balance, context) => {
    for (const channel of ['blueWeight', 'greenWeight', 'redWeight'] as const) {
      const snappedValue = Number(
        (
          Math.round(balance[channel] / NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP) * NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP
        ).toFixed(2),
      );
      if (Math.abs(snappedValue - balance[channel]) > 0.000_001) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab frame RGB balance weights must be snapped to 0.01.',
          path: [channel],
        });
      }
    }
  });

export const negativeLabFrameRgbBalanceOffsetSchema = z
  .object({
    blueWeight: snappedOffsetSchema,
    greenWeight: snappedOffsetSchema,
    redWeight: snappedOffsetSchema,
  })
  .strict()
  .superRefine((balance, context) => {
    for (const channel of ['blueWeight', 'greenWeight', 'redWeight'] as const) {
      const snappedValue = Number(
        (
          Math.round(balance[channel] / NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP) * NEGATIVE_LAB_FRAME_RGB_BALANCE_STEP
        ).toFixed(2),
      );
      if (Math.abs(snappedValue - balance[channel]) > 0.000_001) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab frame RGB balance offsets must be snapped to 0.01.',
          path: [channel],
        });
      }
    }
  });

export const negativeLabFrameRgbBalanceOverrideSchema = z
  .object({
    frameId: z.string().trim().min(1),
    rgbBalanceOffset: negativeLabFrameRgbBalanceOffsetSchema,
    sourcePath: z.string().trim().min(1),
  })
  .strict();

export const negativeLabFrameRgbBalanceOverridePayloadSchema = z
  .object({
    overrides: z.array(negativeLabFrameRgbBalanceOverrideSchema),
    schemaVersion: z.literal(NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((payload, context) => {
    const frameIds = new Set<string>();
    const sourcePaths = new Set<string>();
    for (const [index, override] of payload.overrides.entries()) {
      if (frameIds.has(override.frameId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Negative Lab frame RGB balance override for ${override.frameId}.`,
          path: ['overrides', index, 'frameId'],
        });
      }
      if (sourcePaths.has(override.sourcePath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Negative Lab frame RGB balance override for ${override.sourcePath}.`,
          path: ['overrides', index, 'sourcePath'],
        });
      }
      frameIds.add(override.frameId);
      sourcePaths.add(override.sourcePath);
    }
  });

export type NegativeLabFrameRgbBalance = z.infer<typeof negativeLabFrameRgbBalanceSchema>;
export type NegativeLabFrameRgbBalanceOffset = z.infer<typeof negativeLabFrameRgbBalanceOffsetSchema>;
export type NegativeLabFrameRgbBalanceOverride = z.infer<typeof negativeLabFrameRgbBalanceOverrideSchema>;
export type NegativeLabFrameRgbBalanceOverridePayload = z.infer<typeof negativeLabFrameRgbBalanceOverridePayloadSchema>;

export const parseNegativeLabFrameRgbBalanceOverridePayload = (
  value: unknown,
): NegativeLabFrameRgbBalanceOverridePayload => negativeLabFrameRgbBalanceOverridePayloadSchema.parse(value);
