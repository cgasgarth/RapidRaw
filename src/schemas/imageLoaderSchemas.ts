import { z } from 'zod';

import { rawInputTransformReceiptV2Schema } from '../../packages/rawengine-schema/src/color/rawInputTransformSchemas';
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

export const rawCameraProfileAlgorithmIdSchema = z.enum([
  'dual_illuminant_mired_v1',
  'dual_illuminant_camera_neutral_mired_v2',
]);

export const rawIlluminantEstimateMethodSchema = z.enum([
  'as_shot_white_xy',
  'camera_neutral_iterative',
  'wb_coeff_ratio',
  'fallback',
  'camera_neutral_profile_projection',
  'white_balance_plan_v1',
]);

const rawProfileIlluminantXySchema = z
  .tuple([z.number().positive().max(1), z.number().positive().max(1)])
  .refine(([x, y]) => x + y < 1, 'Chromaticity x + y must be less than 1.');

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
    algorithmId: rawCameraProfileAlgorithmIdSchema,
    candidateCount: z.number().int().nonnegative(),
    cctClamped: z.boolean().nullable().optional(),
    colorCheckerGate: rawCameraProfileColorCheckerGateSchema.nullable().optional(),
    coolIlluminant: z.string().trim().min(1).nullable().optional(),
    coolWeight: z.number().min(0).max(1).nullable().optional(),
    estimatedCctKelvin: z.number().positive().nullable().optional(),
    fallbackReason: z.string().trim().min(1).nullable().optional(),
    illuminantEstimateConfidence: z.enum(['high', 'medium', 'low']),
    illuminantEstimateMethod: rawIlluminantEstimateMethodSchema,
    matrixHash: z
      .string()
      .regex(/^blake3:[0-9a-f]+$/u)
      .nullable()
      .optional(),
    profileIlluminantDuv: z.number().finite().min(-0.05).max(0.05).nullable().optional(),
    profileIlluminantXy: rawProfileIlluminantXySchema.nullable().optional(),
    status: rawCameraProfileStatusSchema,
    warmIlluminant: z.string().trim().min(1).nullable().optional(),
    whiteBalancePlanFingerprint: z
      .string()
      .regex(/^blake3:[0-9a-f]{64}$/u)
      .nullable()
      .optional(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rawDevelopmentReportSchema = z
  .object({
    cameraProfile: rawCameraProfileReportSchema,
    inputTransform: rawInputTransformReceiptV2Schema.nullable().optional(),
    demosaicAlgorithmId: z.string().trim().min(1).nullable().optional(),
    demosaicPath: rawDemosaicPathSchema,
    highlightReconstruction: z
      .object({
        algorithmId: z.literal('sensor_linear_confidence_hierarchy_v2'),
        cfaKind: z.enum(['bayer', 'x_trans', 'other_rgb', 'unsupported']),
        clippedSamples: z.number().int().nonnegative(),
        confidencePercentiles: z.tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
        ]),
        implementationVersion: z.literal(2),
        invalidSamples: z.number().int().nonnegative(),
        largestClippedRegion: z.number().int().nonnegative(),
        methodCounts: z.partialRecord(
          z.enum([
            'same_channel_spatial',
            'cross_channel_ratio',
            'color_line',
            'region_propagation',
            'post_demosaic_chroma',
            'neutral_specular_fallback',
          ]),
          z.number().int().nonnegative(),
        ),
        mode: z.enum(['off', 'conservative', 'auto', 'strong']),
        nearClippedSamples: z.number().int().nonnegative(),
        partiallyReconstructedSamples: z.number().int().nonnegative(),
        postDemosaicFallbackSamples: z.number().int().nonnegative(),
        reconstructedSamples: z.number().int().nonnegative(),
        unrecoverableSamples: z.number().int().nonnegative(),
        warningCodes: z.array(z.string().trim().min(1)),
      })
      .strict()
      .optional(),
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
  .strict()
  .superRefine((report, context) => {
    if (report.inputTransform && report.cameraProfile.algorithmId !== report.inputTransform.resolverAlgorithmId) {
      context.addIssue({
        code: 'custom',
        message: 'Camera-profile and input-transform resolver algorithm IDs must match.',
        path: ['inputTransform', 'resolverAlgorithmId'],
      });
    }
  });

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
