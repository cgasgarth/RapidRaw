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

const superResolutionNativeRegionClassSchema = z.enum([
  'supported_static',
  'weak_support',
  'motion_rejected',
  'occlusion_or_parallax',
  'edge_risk',
  'noise_limited',
  'clipped_or_defective',
  'reference_fallback',
]);

const superResolutionNativeReconstructionSchema = z
  .object({
    algorithmId: z.literal('positive_adaptive_cfa_kernel_huber2_v1'),
    capability: z.literal('native_burst_cfa_preview'),
    colorAlgorithmId: z.literal('support_aware_post_fusion_rgb_v1'),
    decision: z.enum(['review_required', 'preview_only', 'blocked']),
    fallbackAlgorithmId: z.literal('reference_baseline_hard_core_taper_v1'),
    fallbackComposited: superResolutionNativeArtifactSchema,
    fallbackRatio: z.number().min(0).max(1),
    finalPreview: superResolutionNativeArtifactSchema,
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
    policyHash: blake3HashSchema,
    preview: superResolutionNativeArtifactSchema,
    quality: z
      .object({
        blockCodes: z.array(z.string()),
        decision: z.enum(['review_required', 'preview_only', 'blocked']),
        metrics: z
          .object({
            downsampleReprojectionMae: z.number().nonnegative(),
            fallbackCoverage: z.number().min(0).max(1),
            falseFrequencyResponse: z.number().nonnegative(),
            finalMtf50Gain: z.number().nonnegative(),
            lumaVarianceRatio: z.number().nonnegative(),
            meanDeltaE00: z.number().nonnegative(),
            normalizedOvershoot: z.number().nonnegative(),
            staticCoverage: z.number().min(0).max(1),
            unsharpenedMtf50Gain: z.number().nonnegative(),
            zipperFalseColorDelta: z.number().nonnegative(),
          })
          .strict(),
        policyHash: blake3HashSchema,
      })
      .strict(),
    referenceBaseline: superResolutionNativeArtifactSchema,
    regionArtifact: superResolutionNativeArtifactSchema,
    regions: z.array(
      z
        .object({
          bounds: z.tuple([
            z.number().int().nonnegative(),
            z.number().int().nonnegative(),
            z.number().int().positive(),
            z.number().int().positive(),
          ]),
          class: superResolutionNativeRegionClassSchema,
          contributingSourceMask: z.number().int().min(0).max(255),
          maskHash: blake3HashSchema,
          normalizedResidualMad: z.number().nonnegative(),
          normalizedResidualMedian: z.number().nonnegative(),
          perPlaneSupport: z.tuple([z.number(), z.number(), z.number(), z.number()]),
          reasonCodes: z.array(z.string()).min(1),
          registrationUncertainty: z.number().nonnegative(),
          selectedAction: z.enum(['retain_fused_detail', 'reference_fallback']),
        })
        .strict(),
    ),
    registrationPlanHash: blake3HashSchema,
    motionAlgorithmId: z.literal('cfa_block_residual_motion_v1'),
    sharpeningAlgorithmId: z.literal('support_noise_unsharp_3x3_v1'),
    sharpeningArtifact: superResolutionNativeArtifactSchema,
    unsharpenedPreview: superResolutionNativeArtifactSchema,
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
