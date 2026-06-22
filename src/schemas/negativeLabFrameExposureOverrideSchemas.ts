import { z } from 'zod';

export const NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION = 1;
export const NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV = -2;
export const NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV = 2;
export const NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV = 0.05;

export const negativeLabFrameExposureOverrideSchema = z
  .object({
    effectiveExposure: z.number().min(-4).max(4),
    exposureOffset: z.number().min(NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV).max(NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV),
    frameId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
  })
  .strict()
  .superRefine((override, context) => {
    const normalizedSteps = Math.round(override.exposureOffset / NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV);
    const snappedOffset = Number((normalizedSteps * NEGATIVE_LAB_FRAME_EXPOSURE_STEP_EV).toFixed(2));
    if (Math.abs(snappedOffset - override.exposureOffset) > 0.000_001) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab frame exposure offsets must be snapped to 0.05 EV.',
        path: ['exposureOffset'],
      });
    }
  });

export const negativeLabFrameExposureOverridePayloadSchema = z
  .object({
    overrides: z.array(negativeLabFrameExposureOverrideSchema),
    schemaVersion: z.literal(NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((payload, context) => {
    const frameIds = new Set<string>();
    const sourcePaths = new Set<string>();
    for (const [index, override] of payload.overrides.entries()) {
      if (frameIds.has(override.frameId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Negative Lab frame exposure override for ${override.frameId}.`,
          path: ['overrides', index, 'frameId'],
        });
      }
      if (sourcePaths.has(override.sourcePath)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Negative Lab frame exposure override for ${override.sourcePath}.`,
          path: ['overrides', index, 'sourcePath'],
        });
      }
      frameIds.add(override.frameId);
      sourcePaths.add(override.sourcePath);
    }
  });

export type NegativeLabFrameExposureOverride = z.infer<typeof negativeLabFrameExposureOverrideSchema>;
export type NegativeLabFrameExposureOverridePayload = z.infer<typeof negativeLabFrameExposureOverridePayloadSchema>;

export const parseNegativeLabFrameExposureOverridePayload = (value: unknown): NegativeLabFrameExposureOverridePayload =>
  negativeLabFrameExposureOverridePayloadSchema.parse(value);
