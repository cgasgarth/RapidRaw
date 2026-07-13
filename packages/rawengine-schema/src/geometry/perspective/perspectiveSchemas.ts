import { z } from 'zod';

export const perspectiveCorrectionModeSchema = z.enum([
  'off',
  'manual_legacy',
  'auto_level',
  'auto_vertical',
  'auto_horizontal',
  'auto_full',
  'guided',
]);
export const perspectiveCropPolicySchema = z.enum([
  'show_all',
  'constrain',
  'auto_crop',
  'preserve_current_crop',
  'manual_after_correction',
]);
export const perspectiveLineClassSchema = z.enum(['horizontal', 'vertical']);
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const matrixSchema = z.tuple([
  z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
]);
const analysisIdentitySchema = z.object({
  analysisDimensions: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  implementationVersion: z.literal(1),
  lensGeometryFingerprint: z.number().int().nonnegative(),
  orientationFingerprint: z.number().int().nonnegative(),
  sourceRevision: z.number().int().nonnegative(),
});

export const perspectiveGuideSchema = z.object({
  class: perspectiveLineClassSchema,
  endpointsSourceNormalized: z.tuple([pointSchema, pointSchema]),
  id: z.string().min(1),
  weight: z.number().finite().positive().default(1),
});

export const perspectivePlanSchema = z.object({
  analysisIdentity: analysisIdentitySchema.nullable(),
  confidence: z.number().finite().min(0).max(1),
  correctedToSource: matrixSchema,
  fingerprint: z.number().int().nonnegative(),
  implementationVersion: z.literal(1),
  retainedArea: z.number().finite().min(0).max(1),
  sourceToCorrected: matrixSchema,
  suggestedCrop: z
    .object({
      height: z.number().finite().positive(),
      width: z.number().finite().positive(),
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .nullable(),
  validPolygon: z.array(pointSchema).min(4),
  warningCodes: z.array(z.string()),
});

export const perspectiveCorrectionSettingsSchema = z.object({
  amount: z.number().finite().min(0).max(100),
  cropPolicy: perspectiveCropPolicySchema,
  guides: z.array(perspectiveGuideSchema).max(8),
  mode: perspectiveCorrectionModeSchema,
  resolvedPlan: perspectivePlanSchema.nullable(),
});

const detectedLineSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
  edgeStrength: z.number().finite().nonnegative(),
  endpointsSourceNormalized: z.tuple([pointSchema, pointSchema]),
  lengthWeight: z.number().finite().nonnegative(),
  orientationClass: perspectiveLineClassSchema,
});

export const perspectiveAnalysisResultSchema = z.object({
  analysis: z.object({
    confidence: z.number().finite().min(0).max(1),
    horizonAngleDegrees: z.number().finite().nullable(),
    identity: analysisIdentitySchema,
    lines: z.array(detectedLineSchema),
    warningCodes: z.array(z.string()),
  }),
  receipt: z.object({
    abstentionReason: z.string().nullable(),
    conditionEstimate: z.number().finite().positive(),
    guideCount: z.number().int().nonnegative(),
    horizontalGuideCount: z.number().int().nonnegative(),
    plan: perspectivePlanSchema,
    residualDegreesP95: z.number().finite().nonnegative(),
    verticalGuideCount: z.number().int().nonnegative(),
  }),
});

export type PerspectiveAnalysisResult = z.infer<typeof perspectiveAnalysisResultSchema>;
export type PerspectiveCorrectionSettings = z.infer<typeof perspectiveCorrectionSettingsSchema>;
export type PerspectiveCorrectionMode = z.infer<typeof perspectiveCorrectionModeSchema>;
export type PerspectiveCropPolicy = z.infer<typeof perspectiveCropPolicySchema>;
