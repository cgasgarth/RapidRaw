import { z } from 'zod';

const blake3HashSchema = z.string().regex(/^blake3:[a-f0-9]{64}$/u);

const superResolutionNativeCalibrationSchema = z
  .object({
    bayerPattern: z.string().min(1),
    bitsPerSample: z.number().int().positive(),
    blackLevel: z.array(z.number()).min(1),
    blackLevelRepeat: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]),
    whiteBalance: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    whiteLevel: z.array(z.number().int().nonnegative()).min(1),
  })
  .strict();

const superResolutionNativeSourceSchema = z
  .object({
    blockCodes: z.array(z.string()),
    calibration: superResolutionNativeCalibrationSchema,
    calibrationIdentity: blake3HashSchema,
    cameraMake: z.string(),
    cameraModel: z.string(),
    contentHash: blake3HashSchema,
    graphRevision: z.string().min(1),
    height: z.number().int().positive(),
    path: z.string().min(1),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

const superResolutionNativeTransformSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    correlationPeakRatio: z.number().positive(),
    inlierRatio: z.number().min(0).max(1),
    overlapRatio: z.number().min(0).max(1),
    p50ResidualPx: z.number().min(0),
    p95ResidualPx: z.number().min(0),
    rotationDegrees: z.number(),
    sourceIndex: z.number().int().nonnegative(),
    translationXPx: z.number(),
    translationYPx: z.number(),
  })
  .strict();

const superResolutionNativeArtifactSchema = z
  .object({
    contentHash: blake3HashSchema,
    dataUrl: z.string().startsWith('data:image/png;base64,'),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

const superResolutionNativeReconstructionSchema = z
  .object({
    algorithmId: z.literal('positive_adaptive_cfa_kernel_huber2_v1'),
    capability: z.literal('native_burst_cfa_preview'),
    colorAlgorithmId: z.literal('support_aware_post_fusion_rgb_v1'),
    decision: z.literal('quality_gate_pending'),
    fallbackRatio: z.number().min(0).max(1),
    greenPhaseGain: z
      .object({
        accepted: z.boolean(),
        gain: z.number().positive(),
        residual: z.number().nonnegative(),
        sampleCount: z.number().int().nonnegative(),
      })
      .strict(),
    height: z.number().int().positive(),
    planeArtifacts: z
      .array(
        z
          .object({
            averageOutlierRatio: z.number().min(0).max(1),
            averageVariance: z.number().nonnegative(),
            class: z.enum(['R', 'G1', 'G2', 'B']),
            contributingSourceMask: z.number().int().min(0).max(255),
            coverageRatio: z.number().min(0).max(1),
            residual: superResolutionNativeArtifactSchema,
            support: superResolutionNativeArtifactSchema,
            weakSupportRatio: z.number().min(0).max(1),
          })
          .strict(),
      )
      .length(4),
    preview: superResolutionNativeArtifactSchema,
    referenceBaseline: superResolutionNativeArtifactSchema,
    registrationPlanHash: blake3HashSchema,
    width: z.number().int().positive(),
  })
  .strict();

export const superResolutionNativeRegistrationPlanSchema = z
  .object({
    accepted: z.boolean(),
    acceptedDryRunPlanHash: blake3HashSchema,
    acceptedDryRunPlanId: z.string().min(1),
    blockCodes: z.array(z.string()),
    intake: z
      .object({
        algorithmId: z.literal('calibrated_bayer_burst_intake_v2'),
        calibrationConsistent: z.boolean(),
        sourceCount: z.number().int().positive(),
        sources: z.array(superResolutionNativeSourceSchema).min(2),
      })
      .strict(),
    registration: z
      .object({
        algorithmId: z.literal('native_green_phase_global_se2_registration_v1'),
        excludedSources: z
          .array(
            z
              .object({
                code: z.string().min(1),
                confidence: z.number().min(0).max(1).nullable(),
                overlapRatio: z.number().min(0).max(1).nullable(),
                p95ResidualPx: z.number().min(0).nullable(),
                rotationDegrees: z.number().nullable(),
                sourceIndex: z.number().int().nonnegative(),
                translationXPx: z.number().nullable(),
                translationYPx: z.number().nullable(),
              })
              .strict(),
          )
          .max(8),
        preview: z
          .object({
            contentHash: blake3HashSchema,
            dataUrl: z.string().startsWith('data:image/png;base64,'),
            height: z.number().int().positive(),
            width: z.number().int().positive(),
          })
          .strict(),
        proxy: z
          .object({
            algorithmId: z.literal('calibrated_green_phase_proxy_v1'),
            cropVersion: z.literal('full_sensor_even_green_cells_v1'),
            height: z.number().int().positive(),
            normalizationVersion: z.literal('black_white_normalized_green_v1'),
            pyramidLevels: z.number().int().positive(),
            width: z.number().int().positive(),
          })
          .strict(),
        referenceSelectionScores: z
          .array(
            z
              .object({
                clippingScore: z.number().min(0).max(1),
                overlapScore: z.number().min(0).max(1),
                qualityScore: z.number().min(0).max(1),
                sourceIndex: z.number().int().nonnegative(),
                totalScore: z.number().min(0).max(1),
              })
              .strict(),
          )
          .min(2),
        referenceSourceIndex: z.number().int().nonnegative(),
        selectedSourceIndexes: z.array(z.number().int().nonnegative()).min(1),
        summary: z
          .object({
            confidence: z.number().min(0).max(1),
            coverageRatio: z.number().min(0).max(1),
            p50ResidualPx: z.number().min(0),
            p95ResidualPx: z.number().min(0),
            samplingDiversityRatio: z.number().min(0).max(1),
            uniqueX2SamplingPhases: z.number().int().min(1).max(4),
          })
          .strict(),
        transforms: z.array(superResolutionNativeTransformSchema).min(1),
      })
      .strict()
      .nullable(),
    registrationInputHash: blake3HashSchema,
    reconstruction: superResolutionNativeReconstructionSchema.nullable(),
    warningCodes: z.array(z.string()),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.intake.sources.length !== plan.intake.sourceCount) {
      context.addIssue({
        code: 'custom',
        message: 'Native SR intake source count must match its ordered source identities.',
        path: ['intake', 'sources'],
      });
    }
    if (plan.accepted && plan.registration === null) {
      context.addIssue({
        code: 'custom',
        message: 'An accepted native SR plan must include a measured registration result.',
        path: ['registration'],
      });
    }
    if (plan.accepted && plan.reconstruction === null) {
      context.addIssue({
        code: 'custom',
        message: 'An accepted native SR plan must include measured CFA reconstruction.',
        path: ['reconstruction'],
      });
    }
    if (plan.reconstruction !== null && plan.reconstruction.registrationPlanHash !== plan.acceptedDryRunPlanHash) {
      context.addIssue({
        code: 'custom',
        message: 'Native SR reconstruction must bind to the immutable registration plan hash.',
        path: ['reconstruction', 'registrationPlanHash'],
      });
    }
  });

export type SuperResolutionNativeReadiness = z.infer<typeof superResolutionNativeRegistrationPlanSchema>;
