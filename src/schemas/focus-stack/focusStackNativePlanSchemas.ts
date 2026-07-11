import { z } from 'zod';

const rectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const scoreSchema = z
  .object({
    orderDelta: z.number().int().nonnegative(),
    clippingInvalidRatio: z.number().nonnegative(),
    lumaNoiseEstimate: z.number().nonnegative(),
  })
  .strict();
const sourceSchema = z
  .object({
    sourceIndex: z.number().int().nonnegative(),
    pathHandle: z.string().min(1),
    sourceKind: z.enum(['raw_sensor_source', 'rendered_rgb_source']),
    contentHash: z.string().startsWith('blake3:'),
    graphRevision: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    activeArea: rectSchema,
    orientation: z.string().min(1),
    cameraMake: z.string(),
    cameraModel: z.string(),
    lensModel: z.string().nullable(),
    focalLengthMm: z.number().positive().nullable(),
    aperture: z.number().positive().nullable(),
    focusDistanceMm: z.number().positive().nullable(),
    exposureEv: z.number().nullable(),
    iso: z.number().int().positive().nullable(),
    calibrationIdentity: z.string().min(1),
    effectiveCalibrationIdentity: z.string().min(1),
    sceneLinearRenderIdentity: z.string().min(1),
    clippingRatio: z.number().min(0).max(1),
    invalidBorderRatio: z.number().min(0).max(1),
    finitePixelRatio: z.number().min(0).max(1),
    lumaNoiseEstimate: z.number().nonnegative(),
    proxyHash: z.string().startsWith('blake3:'),
    referenceScore: scoreSchema,
    warnings: z.array(z.string()),
  })
  .strict();

export const focusStackNativeInputPlanSchema = z
  .object({
    accepted: z.boolean(),
    acceptedDryRunPlanHash: z.string().startsWith('blake3:'),
    acceptedDryRunPlanId: z.string().min(1),
    schemaVersion: z.literal(1),
    policyId: z.literal('focus_stack_intake_policy_v1'),
    proxyAlgorithmId: z.literal('focus_luma_proxy_v1'),
    focusOrderSource: z.literal('user_selection'),
    coordinateConvention: z.literal('reference_active_area_pixels_xywh_half_open'),
    referenceSourceIndex: z.number().int().nonnegative(),
    commonGeometry: rectSchema,
    effectiveCalibrationIdentity: z.string().min(1),
    settings: z
      .object({
        commonCropIdentity: z.string(),
        lensCorrectionIdentity: z.string(),
        neutralRawState: z.boolean(),
        orientationIdentity: z.string(),
      })
      .strict(),
    sources: z.array(sourceSchema).min(2).max(128),
    warningCodes: z.array(z.string()),
    blockCodes: z.array(z.string()),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.accepted === plan.blockCodes.length > 0)
      context.addIssue({ code: 'custom', message: 'accepted must match blockCodes' });
    if (plan.referenceSourceIndex >= plan.sources.length)
      context.addIssue({ code: 'custom', message: 'referenceSourceIndex is out of range' });
  });

export type FocusStackNativeInputPlan = z.infer<typeof focusStackNativeInputPlanSchema>;
