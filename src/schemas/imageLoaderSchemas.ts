import { z } from 'zod';

import type { Adjustments } from '../utils/adjustments';

const legacyAdjustmentSnapshotSchema = z.custom<Partial<Adjustments>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'Expected adjustment snapshot object' },
);

const nullAdjustmentSnapshotSchema = z
  .object({
    is_null: z.literal(true),
  })
  .loose();

const exifSchema = z.record(z.string(), z.string()).nullable();

export const rawDemosaicPathSchema = z.enum(['bayer_hq', 'fast', 'linear_bypass', 'standard', 'x_trans_hq']);

export const rawProcessingProfileSchema = z.enum(['balanced', 'fast', 'maximum']);

export const rawCameraProfileStatusSchema = z.enum(['fallback', 'interpolated', 'single_illuminant', 'unavailable']);

export const rawCameraProfileColorCheckerGateStatusSchema = z.enum([
  'gated_fail',
  'gated_pass',
  'gated_warn',
  'not_available',
  'runtime_smoke_only',
]);

export const rawCameraProfileColorCheckerGateSchema = z
  .object({
    fallbackReason: z.string().trim().min(1).nullable().optional(),
    maxDeltaE00: z.number().nonnegative().nullable().optional(),
    meanDeltaE00: z.number().nonnegative().nullable().optional(),
    medianDeltaE00: z.number().nonnegative().nullable().optional(),
    patchCount: z.number().int().nonnegative().nullable().optional(),
    p95DeltaE00: z.number().nonnegative().nullable().optional(),
    status: rawCameraProfileColorCheckerGateStatusSchema,
    thresholdMeanDeltaE00: z.number().positive().nullable().optional(),
    thresholdP95DeltaE00: z.number().positive().nullable().optional(),
  })
  .strict()
  .superRefine((gate, context) => {
    if (
      gate.meanDeltaE00 !== null &&
      gate.meanDeltaE00 !== undefined &&
      gate.p95DeltaE00 !== null &&
      gate.p95DeltaE00 !== undefined
    ) {
      if (gate.meanDeltaE00 > gate.p95DeltaE00) {
        context.addIssue({ code: 'custom', message: 'ColorChecker mean DeltaE00 cannot exceed p95 DeltaE00.' });
      }
    }
    if (
      gate.p95DeltaE00 !== null &&
      gate.p95DeltaE00 !== undefined &&
      gate.maxDeltaE00 !== null &&
      gate.maxDeltaE00 !== undefined
    ) {
      if (gate.p95DeltaE00 > gate.maxDeltaE00) {
        context.addIssue({ code: 'custom', message: 'ColorChecker p95 DeltaE00 cannot exceed max DeltaE00.' });
      }
    }
  });

export const rawCameraProfileReportSchema = z
  .object({
    algorithmId: z.string().trim().min(1),
    candidateCount: z.number().int().nonnegative(),
    cctClamped: z.boolean().nullable().optional(),
    colorCheckerGate: rawCameraProfileColorCheckerGateSchema.nullable().optional(),
    coolIlluminant: z.string().trim().min(1).nullable().optional(),
    coolWeight: z.number().min(0).max(1).nullable().optional(),
    estimatedCctKelvin: z.number().positive().nullable().optional(),
    fallbackReason: z.string().trim().min(1).nullable().optional(),
    illuminantEstimateConfidence: z.enum(['high', 'medium', 'low']),
    illuminantEstimateMethod: z.enum(['as_shot_white_xy', 'camera_neutral_iterative', 'wb_coeff_ratio', 'fallback']),
    matrixHash: z
      .string()
      .regex(/^blake3:[0-9a-f]+$/u)
      .nullable()
      .optional(),
    status: rawCameraProfileStatusSchema,
    warmIlluminant: z.string().trim().min(1).nullable().optional(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rawDevelopmentReportSchema = z
  .object({
    cameraProfile: rawCameraProfileReportSchema,
    inputTransform: z
      .object({
        asShotCameraWbGains: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
        cameraMakeModelId: z.string().trim().min(1),
        chromaticAdaptation: z.enum(['none_same_white', 'bradford_v1', 'already_adapted']),
        contract: z.literal('rapidraw.raw_input_transform.v1'),
        destinationDomain: z.literal('acescg_linear_v1'),
        destinationWhiteXy: z.tuple([z.literal(0.32168), z.literal(0.33767)]),
        greaterThanOneAp1ComponentCount: z.number().int().nonnegative(),
        limitationCodes: z.array(z.string().trim().min(1)),
        negativeAp1ComponentCount: z.number().int().nonnegative(),
        nonFiniteCount: z.literal(0),
        numericPolicyVersion: z.string().trim().min(1),
        profileSource: z.enum(['raw_metadata', 'project_profile']),
        resolverAlgorithmId: z.literal('dual_illuminant_mired_v1'),
        selectedCalibrationWhiteXy: z.tuple([z.number().positive(), z.number().positive()]),
        selectedMatrixDirection: z.literal('xyz_to_camera'),
        selectedMatrixSha256: z.string().regex(/^blake3:[0-9a-f]+$/u),
        sensorFloorCount: z.number().int().nonnegative(),
        sourceDomain: z.literal('linear_camera_rgb_v1'),
        transformContentSha256: z.string().regex(/^blake3:[0-9a-f]+$/u),
        workingPixelsBlake3: z.string().regex(/^blake3:[0-9a-f]+$/u),
        xyzToAp1MatrixVersion: z.string().trim().min(1),
      })
      .strict()
      .nullable()
      .optional(),
    demosaicAlgorithmId: z.string().trim().min(1).nullable().optional(),
    demosaicPath: rawDemosaicPathSchema,
    processingProfile: rawProcessingProfileSchema,
    runtime: z
      .object({
        cacheHit: z.boolean(),
        decodeElapsedMs: z.number().int().nonnegative().nullable().optional(),
        exportElapsedMs: z.number().int().nonnegative().nullable().optional(),
        outputDimensions: z
          .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
          .nullable()
          .optional(),
        previewElapsedMs: z.number().int().nonnegative().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    xtransHq: z
      .object({
        reconstruction: z
          .object({
            borderFallbackPixels: z.number().int().nonnegative(),
            chromaInterpolatedPixels: z.number().int().nonnegative(),
            chromaLimitedPixels: z.number().int().nonnegative(),
            chromaRefinedPixels: z.number().int().nonnegative(),
            evaluatedPixels: z.number().int().nonnegative(),
            greenDirectionalPixels: z.number().int().nonnegative(),
            greenHighConfidencePixels: z.number().int().nonnegative(),
            greenLowConfidencePixels: z.number().int().nonnegative(),
            greenMediumConfidencePixels: z.number().int().nonnegative(),
            greenSecondOrderCorrectedPixels: z.number().int().nonnegative(),
            period6ChromaSuppressedPixels: z.number().int().nonnegative(),
            scratchMemory: z
              .object({
                chromaWorkingBytes: z.number().int().nonnegative(),
                greenPlaneBytes: z.number().int().nonnegative(),
                inputPlaneBytes: z.number().int().nonnegative(),
                outputRgbBytes: z.number().int().nonnegative(),
                roiPixelCount: z.number().int().nonnegative(),
                sensorPixelCount: z.number().int().nonnegative(),
                totalEstimatedPeakBytes: z.number().int().nonnegative(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const rawCameraProfileProvenanceReceiptSchema = z
  .object({
    algorithmId: rawCameraProfileReportSchema.shape.algorithmId,
    candidateCount: rawCameraProfileReportSchema.shape.candidateCount,
    cctClamped: rawCameraProfileReportSchema.shape.cctClamped,
    colorCheckerFallbackReason: z.string().trim().min(1).nullable(),
    colorCheckerGateStatus: rawCameraProfileColorCheckerGateStatusSchema,
    colorCheckerMaxDeltaE00: z.number().nonnegative().nullable(),
    colorCheckerMeanDeltaE00: z.number().nonnegative().nullable(),
    colorCheckerMedianDeltaE00: z.number().nonnegative().nullable(),
    colorCheckerPatchCount: z.number().int().nonnegative().nullable(),
    colorCheckerP95DeltaE00: z.number().nonnegative().nullable(),
    colorCheckerThresholdMeanDeltaE00: z.number().positive().nullable(),
    colorCheckerThresholdP95DeltaE00: z.number().positive().nullable(),
    coolIlluminant: rawCameraProfileReportSchema.shape.coolIlluminant,
    coolWeight: rawCameraProfileReportSchema.shape.coolWeight,
    demosaicPath: rawDemosaicPathSchema,
    demosaicAlgorithmId: rawDevelopmentReportSchema.shape.demosaicAlgorithmId,
    estimatedCctKelvin: rawCameraProfileReportSchema.shape.estimatedCctKelvin,
    fallbackReason: rawCameraProfileReportSchema.shape.fallbackReason,
    illuminantEstimateConfidence: rawCameraProfileReportSchema.shape.illuminantEstimateConfidence,
    illuminantEstimateMethod: rawCameraProfileReportSchema.shape.illuminantEstimateMethod,
    inputTransform: rawDevelopmentReportSchema.shape.inputTransform,
    matrixHash: rawCameraProfileReportSchema.shape.matrixHash,
    receiptVersion: z.literal(1),
    processingProfile: rawProcessingProfileSchema,
    cacheHit: z.boolean().nullable(),
    decodeElapsedMs: z.number().int().nonnegative().nullable(),
    exportElapsedMs: z.number().int().nonnegative().nullable(),
    status: rawCameraProfileStatusSchema,
    outputDimensions: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
    previewElapsedMs: z.number().int().nonnegative().nullable(),
    profileConfidenceBasis: z.enum(['colorchecker_gated', 'metadata_only_fallback', 'runtime_smoke_only']),
    scratchMemoryBytes: z.number().int().nonnegative().nullable(),
    warmIlluminant: rawCameraProfileReportSchema.shape.warmIlluminant,
    warningCount: z.number().int().nonnegative(),
  })
  .strict();

export const loadedMetadataSchema = z
  .object({
    adjustments: z.union([legacyAdjustmentSnapshotSchema, nullAdjustmentSnapshotSchema]).nullable().optional(),
  })
  .loose();

export const loadImageResultSchema = z
  .object({
    exif: exifSchema.optional(),
    height: z.number().nonnegative(),
    is_offline_smart_preview: z.boolean().optional(),
    is_raw: z.boolean(),
    metadata: z.unknown().optional(),
    raw_development_report: rawDevelopmentReportSchema.nullable().optional(),
    width: z.number().nonnegative(),
  })
  .loose();

export type LoadedMetadata = z.infer<typeof loadedMetadataSchema>;
export type LoadImageResult = z.infer<typeof loadImageResultSchema>;
export type RawCameraProfileProvenanceReceipt = z.infer<typeof rawCameraProfileProvenanceReceiptSchema>;
export type RawDevelopmentReport = z.infer<typeof rawDevelopmentReportSchema>;

export const isNullAdjustmentSnapshot = (
  value: LoadedMetadata['adjustments'],
): value is z.infer<typeof nullAdjustmentSnapshotSchema> =>
  typeof value === 'object' && value !== null && 'is_null' in value && value.is_null === true;

export const parseLoadedMetadata = (value: unknown): LoadedMetadata => loadedMetadataSchema.parse(value);

export const parseLoadImageResult = (value: unknown): LoadImageResult => loadImageResultSchema.parse(value);
