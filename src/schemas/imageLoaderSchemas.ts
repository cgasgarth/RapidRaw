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

export const rawCameraProfileStatusSchema = z.enum([
  'fallback',
  'interpolated',
  'selected_dcp',
  'single_illuminant',
  'unavailable',
]);

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
    cameraModel: z.string().trim().min(1).nullable().optional(),
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
      .regex(/^(?:blake3|sha256):[0-9a-f]+$/u)
      .nullable()
      .optional(),
    status: rawCameraProfileStatusSchema,
    warmIlluminant: z.string().trim().min(1).nullable().optional(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

const selectedCameraProfileReceiptSchema = z
  .object({
    baselineExposureEv: z.number().finite(),
    cameraMatch: z.enum([
      'exact',
      'unrestricted',
      'compatible_alias',
      'user_forced_compatible',
      'user_forced_unverified',
      'matrix_fallback',
      'unsupported_channels',
    ]),
    contract: z.literal('rapidraw.camera_profile.v1'),
    creativeAmount: z.number().min(0).max(1),
    creativeTableApplied: z.boolean(),
    defaultBlackRender: z.number().int().min(0).max(1).nullable().optional(),
    embedPolicy: z.number().int().min(0).max(3).nullable().optional(),
    illuminantWeight: z.number().min(0).max(1),
    implementationVersion: z.literal(1),
    limitationCodes: z.array(z.string().trim().min(1)),
    profileName: z.string().trim().min(1),
    profileSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    source: z.enum(['embedded', 'open', 'user', 'generated', 'matrix_fallback']),
    technicalTableApplied: z.boolean(),
    toneCurveApplied: z.boolean(),
    unsupportedTagIds: z.array(z.number().int().min(0).max(65535)),
  })
  .strict();

export const rawDevelopmentReportSchema = z
  .object({
    cameraProfile: rawCameraProfileReportSchema,
    selectedCameraProfile: selectedCameraProfileReceiptSchema.nullable().optional(),
    inputTransform: z
      .object({
        asShotCameraWbGains: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
        cameraMakeModelId: z.string().trim().min(1),
        chromaticAdaptation: z.enum(['none_same_white', 'bradford_v1', 'already_adapted']),
        contract: z.literal('rapidraw.raw_input_transform.v2'),
        destinationDomain: z.literal('acescg_linear_v1'),
        destinationWhiteXy: z.tuple([z.literal(0.32168), z.literal(0.33767)]),
        greaterThanOneAp1ComponentCount: z.number().int().nonnegative(),
        invariantPolicyVersion: z.literal('camera_input_physical_invariants_v1'),
        limitationCodes: z.array(z.string().trim().min(1)),
        negativeAp1ComponentCount: z.number().int().nonnegative(),
        nonFiniteCount: z.literal(0),
        numericPolicyVersion: z.string().trim().min(1),
        outcome: z.literal('primary_calibrated_ap1'),
        outcomeReason: z.literal('validated_camera_profile'),
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

export const imageOpenSessionIdSchema = z
  .object({
    imageSession: z.number().int().nonnegative(),
    selectionGeneration: z.number().int().nonnegative(),
  })
  .strict();

export const progressiveImageFrameReceiptSchema = z
  .object({
    colorAssumption: z.string().min(1),
    frameGeneration: z.number().int().positive(),
    height: z.number().int().nonnegative(),
    imageSession: z.number().int().nonnegative(),
    orientationApplied: z.boolean(),
    provisionalReason: z.string().min(1).nullable(),
    quality: z.enum(['embeddedProvisional', 'fastDeveloped', 'settledDeveloped']),
    selectionGeneration: z.number().int().nonnegative(),
    sourceKind: z.string().min(1),
    sourceRevision: z.string().startsWith('source-revision-v1:'),
    width: z.number().int().nonnegative(),
  })
  .strict();

export const beginImageOpenRequestSchema = z
  .object({
    expectedCatalogRevision: z.number().int().nonnegative().nullable(),
    expectedEntityRevision: z.number().int().nonnegative().nullable(),
    imageId: z.string().min(1),
    path: z.string().min(1),
    sessionId: imageOpenSessionIdSchema,
  })
  .strict();

export const beginImageOpenResultSchema = z
  .object({
    decodeReadyMillis: z.number().int().nonnegative(),
    decoded: loadImageResultSchema,
    imageId: z.string().min(1),
    joinedPrefetch: z.boolean(),
    metadataFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    metadataReadyMillis: z.number().int().nonnegative(),
    sessionId: imageOpenSessionIdSchema,
  })
  .strict();

export const imageOpenUpdateSchema = z.discriminatedUnion('phase', [
  z
    .object({
      imageId: z.string().min(1),
      metadata: loadedMetadataSchema,
      metadataFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
      path: z.string().min(1),
      phase: z.literal('metadataReady'),
      sessionId: imageOpenSessionIdSchema,
    })
    .strict(),
  z
    .object({
      imageId: z.string().min(1),
      path: z.string().min(1),
      phase: z.literal('fallbackFrameReady'),
      receipt: progressiveImageFrameReceiptSchema,
      sessionId: imageOpenSessionIdSchema,
    })
    .strict(),
  z
    .object({
      height: z.number().int().nonnegative(),
      imageId: z.string().min(1),
      isRaw: z.boolean(),
      path: z.string().min(1),
      phase: z.literal('decodeReady'),
      receipt: progressiveImageFrameReceiptSchema,
      sessionId: imageOpenSessionIdSchema,
      width: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      dataUrl: z.string().startsWith('data:image/jpeg;base64,'),
      imageId: z.string().min(1),
      path: z.string().min(1),
      phase: z.literal('frameReady'),
      receipt: progressiveImageFrameReceiptSchema,
      sessionId: imageOpenSessionIdSchema,
    })
    .strict(),
  z
    .object({
      imageId: z.string().min(1),
      path: z.string().min(1),
      phase: z.literal('superseded'),
      sessionId: imageOpenSessionIdSchema,
    })
    .strict(),
]);

export type LoadedMetadata = z.infer<typeof loadedMetadataSchema>;
export type LoadImageResult = z.infer<typeof loadImageResultSchema>;
export type BeginImageOpenRequest = z.infer<typeof beginImageOpenRequestSchema>;
export type BeginImageOpenResult = z.infer<typeof beginImageOpenResultSchema>;
export type ImageOpenUpdate = z.infer<typeof imageOpenUpdateSchema>;
export type ProgressiveImageFrameReceipt = z.infer<typeof progressiveImageFrameReceiptSchema>;
export type RawCameraProfileProvenanceReceipt = z.infer<typeof rawCameraProfileProvenanceReceiptSchema>;
export type RawDevelopmentReport = z.infer<typeof rawDevelopmentReportSchema>;

export const isNullAdjustmentSnapshot = (
  value: LoadedMetadata['adjustments'],
): value is z.infer<typeof nullAdjustmentSnapshotSchema> =>
  typeof value === 'object' && value !== null && 'is_null' in value && value.is_null === true;

export const parseLoadedMetadata = (value: unknown): LoadedMetadata => loadedMetadataSchema.parse(value);

export const parseLoadImageResult = (value: unknown): LoadImageResult => loadImageResultSchema.parse(value);
export const parseBeginImageOpenResult = (value: unknown): BeginImageOpenResult =>
  beginImageOpenResultSchema.parse(value);
export const parseImageOpenUpdate = (value: unknown): ImageOpenUpdate => imageOpenUpdateSchema.parse(value);
