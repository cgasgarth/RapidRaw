import { z } from 'zod';
import type { CullingSuggestions, Progress } from '../components/ui/AppProperties';
import { panoramaRenderedReviewSchema } from './computational-merge/panoramaUiSchemas';
import { denoiseOperationHandleSchema } from './denoiseWorkflowSchemas';
import { importJobAuthoritySchema } from './fileOperationSchemas';
import { rawDevelopmentReportSchema } from './imageLoaderSchemas';

const nonnegativeNumberSchema = z.number().nonnegative();
type ProgressPayload = z.infer<typeof progressPayloadSchema>;
type CullingProgressPayload = Progress & { stage: string };

export const stringPayloadSchema = z.string();
export const countPayloadSchema = nonnegativeNumberSchema;

export const displayTargetChangePayloadSchema = z
  .object({
    deviceGeneration: nonnegativeNumberSchema,
    displayResourceGeneration: nonnegativeNumberSchema,
    target: z
      .object({
        colorSpace: z.literal('display_encoded_srgb'),
        displayId: z.number().int().nonnegative().nullable(),
        profileSha256: z.string().min(1),
        scaleFactorBits: nonnegativeNumberSchema,
      })
      .strict(),
  })
  .strict();

export const progressPayloadSchema = z
  .object({
    completed: nonnegativeNumberSchema.optional(),
    current: nonnegativeNumberSchema,
    stage: z.string().optional(),
    total: nonnegativeNumberSchema,
  })
  .loose();

export const thumbnailSmartPreviewPayloadSchema = z
  .object({
    colorProfile: z.string(),
    height: nonnegativeNumberSchema,
    source: z.string(),
    sourceAvailable: z.boolean(),
    sourceRevision: z.string(),
    stale: z.boolean(),
    width: nonnegativeNumberSchema,
  })
  .strict();

export const thumbnailResourceDescriptorSchema = z
  .object({
    byteLen: nonnegativeNumberSchema,
    generation: nonnegativeNumberSchema,
    height: nonnegativeNumberSchema,
    mimeType: z.literal('image/jpeg'),
    resourceId: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.enum(['diskCache', 'generated', 'smartPreview']),
    width: nonnegativeNumberSchema,
  })
  .strict();

export const thumbnailGeneratedPayloadSchema = z
  .object({
    cacheRevision: z.string().optional(),
    fromCache: z.boolean().optional(),
    generation: nonnegativeNumberSchema.optional(),
    is_edited: z.boolean().optional(),
    path: z.string(),
    rating: z.number().optional(),
    resource: thumbnailResourceDescriptorSchema,
    smartPreview: thumbnailSmartPreviewPayloadSchema.optional().nullable(),
    smartPreviewResource: thumbnailResourceDescriptorSchema.optional().nullable(),
    sourceRevision: z.string().optional().nullable(),
  })
  .loose();

export const thumbnailInvalidatedPayloadSchema = z
  .object({
    outcome: z.enum(['deferred', 'duplicate', 'scheduled']),
    path: z.string().min(1),
    sidecarRevision: z.string().min(1),
    thumbnailRevision: z.string().min(1),
  })
  .strict();

export const smartPreviewGeneratedPayloadSchema = z
  .object({
    generation: nonnegativeNumberSchema,
    path: z.string(),
    resource: thumbnailResourceDescriptorSchema,
    smartPreview: thumbnailSmartPreviewPayloadSchema,
    sourceRevision: z.string(),
    state: z.literal('current'),
  })
  .strict();

export const importStartPayloadSchema = z
  .object({
    generation: importJobAuthoritySchema.shape.generation,
    jobId: importJobAuthoritySchema.shape.jobId,
    total: nonnegativeNumberSchema,
  })
  .loose();

export const pathProgressPayloadSchema = progressPayloadSchema
  .extend({
    path: z.string(),
  })
  .loose();

export const importProgressPayloadSchema = pathProgressPayloadSchema.extend({
  generation: importJobAuthoritySchema.shape.generation,
  jobId: importJobAuthoritySchema.shape.jobId,
  stage: z.string().optional(),
  committed: nonnegativeNumberSchema.optional(),
  failed: nonnegativeNumberSchema.optional(),
  cancelled: nonnegativeNumberSchema.optional(),
  bytesCopied: nonnegativeNumberSchema.optional(),
  totalBytes: nonnegativeNumberSchema.optional(),
  committedPath: z.string().nullable().optional(),
});

export const importTerminalPayloadSchema = importJobAuthoritySchema.extend({ receipt: z.unknown() }).strict();

export const importErrorPayloadSchema = importJobAuthoritySchema.extend({ message: z.string() }).strict();

export const denoiseCompletePayloadSchema = z
  .object({
    denoised: z.string(),
    operation: denoiseOperationHandleSchema,
    original: z.string().nullable().optional(),
  })
  .loose();

export const denoiseErrorPayloadSchema = z
  .object({
    error: z.string(),
    operation: denoiseOperationHandleSchema,
  })
  .strict();

export const denoiseProgressPayloadSchema = z
  .object({
    message: z.string(),
    operation: denoiseOperationHandleSchema,
  })
  .strict();

export const renderPathPayloadSchema = z
  .object({
    path: z.string().optional(),
  })
  .loose();

export const base64PayloadSchema = z
  .object({
    base64: z.string(),
  })
  .loose();

export const hdrCompletePayloadSchema = z
  .object({
    base64: z.string(),
    receipt: z
      .object({
        acceptedDryRunPlanHash: z.string().trim().min(1),
        acceptedDryRunPlanId: z.string().trim().min(1),
        mergeMethod: z.string().trim().min(1),
        mergeVersion: z.string().trim().min(1),
        outputHandle: z.string().trim().min(1),
        outputContentHash: z.string().trim().min(1),
        previewDimensions: z
          .object({
            height: z.number().int().nonnegative(),
            width: z.number().int().nonnegative(),
          })
          .strict(),
        sourceRoles: z.array(
          z
            .object({
              exposureEv: z.number(),
              role: z.enum(['over_exposed', 'reference', 'under_exposed']),
              sourceIndex: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        sourcePaths: z.array(z.string().trim().min(1)),
        warningCodes: z.array(z.string().trim().min(1)),
      })
      .strict(),
  })
  .strict();

export const gamutWarningOverlayPayloadSchema = z
  .object({
    black_point_compensation: z.string().trim().min(1),
    color_managed_transform: z.string().trim().min(1),
    coverage_ratio: z.number().min(0).max(1),
    effective_color_profile: z.string().trim().min(1),
    effective_rendering_intent: z.string().trim().min(1),
    export_soft_proof_recipe_id: z.string().trim().min(1),
    height: z.number().int().positive(),
    mask_data_url: z.string().startsWith('data:image/png;base64,'),
    max_channel_value: z.number().int().min(0).max(255),
    min_channel_value: z.number().int().min(0).max(255),
    pixel_count: z.number().int().nonnegative(),
    gamut_mapping_implementation: z.string().trim().min(1).optional().nullable(),
    gamut_mapping_version: z.number().int().positive().optional().nullable(),
    gamut_target: z.string().trim().min(1).optional().nullable(),
    gamut_boundary_fingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/u)
      .optional()
      .nullable(),
    gamut_warning_plan_fingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/u)
      .optional()
      .nullable(),
    maximum_boundary_excess: z.number().nonnegative().optional().nullable(),
    gamut_compressed_pixel_count: z.number().int().nonnegative().optional().nullable(),
    gamut_hard_clipped_pixel_count: z.number().int().nonnegative().optional().nullable(),
    policy_status: z.string().trim().min(1),
    policy_version: z.string().trim().min(1),
    preview_basis: z.literal('export_preview'),
    source_image_path: z.string().trim().min(1),
    source_precision_path: z.string().trim().min(1),
    transform_applied: z.boolean(),
    transform_policy_fingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/u),
    warning_pixel_count: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export type GamutWarningOverlayPayload = z.infer<typeof gamutWarningOverlayPayloadSchema>;

export const panoramaCompletePayloadSchema = z
  .object({
    base64: z.string(),
    review: panoramaRenderedReviewSchema,
  })
  .strict();

export const aiConnectorStatusPayloadSchema = z
  .object({
    connected: z.boolean(),
  })
  .loose();

export const exportReceiptPayloadSchema = z
  .object({
    completedAt: z.iso.datetime({ offset: true }),
    outputs: z.array(
      z
        .object({
          auxiliaryOutputPaths: z.array(z.string().trim().min(1)).default([]),
          bitDepth: z.number().int().positive().optional().nullable(),
          blackPointCompensation: z.string().trim().min(1).optional().nullable(),
          byteSize: z.number().int().nonnegative(),
          cmm: z.string().trim().min(1).optional().nullable(),
          colorManagedTransform: z.string().trim().min(1).optional().nullable(),
          colorProfile: z.string().trim().min(1).optional().nullable(),
          effectiveColorProfile: z.string().trim().min(1).optional().nullable(),
          format: z.string().trim().min(1),
          iccEmbedded: z.boolean().optional().nullable(),
          outputPath: z.string().trim().min(1),
          outputDigest: z
            .object({
              algorithm: z.literal('sha256'),
              byteLen: z.number().int().nonnegative(),
              provenance: z.literal('finalByteAtomicWriter'),
              value: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
            })
            .strict()
            .optional()
            .nullable(),
          policyStatus: z.string().trim().min(1).optional().nullable(),
          policyVersion: z.string().trim().min(1).optional().nullable(),
          rawProvenanceSidecarPath: z.string().trim().min(1).optional().nullable(),
          rawProvenanceError: z.string().trim().min(1).optional().nullable(),
          rawDevelopmentReport: rawDevelopmentReportSchema.optional().nullable(),
          renderingIntent: z.string().trim().min(1).optional().nullable(),
          requestedColorProfile: z.string().trim().min(1).optional().nullable(),
          requestedRenderingIntent: z.string().trim().min(1).optional().nullable(),
          resolvedDisabledReason: z.string().trim().min(1).optional().nullable(),
          effectiveRenderingIntent: z.string().trim().min(1).optional().nullable(),
          sourcePath: z.string().trim().min(1),
          sourceIccProfileHash: z.string().trim().min(1).optional().nullable(),
          sourcePrecisionPath: z.string().trim().min(1).optional().nullable(),
          transformPolicyFingerprint: z.string().trim().min(1).optional().nullable(),
          transformApplied: z.boolean().optional().nullable(),
          gamutMapping: z
            .object({
              implementationId: z.string().trim().min(1),
              implementationVersion: z.number().int().positive(),
              target: z.string().trim().min(1),
              mode: z.literal('Output'),
              renderingIntent: z.string().trim().min(1),
              boundaryFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
              compressedPixelCount: z.number().int().nonnegative(),
              hardClippedPixelCount: z.number().int().nonnegative(),
              inputOutOfGamutPixelCount: z.number().int().nonnegative(),
              maximumBoundaryExcess: z.number().nonnegative(),
              pixelCount: z.number().int().nonnegative(),
              planFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
            })
            .strict()
            .optional()
            .nullable(),
        })
        .strict(),
    ),
    terminalStatus: z.enum(['cancelled', 'completed']),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const cullingProgressPayloadSchema = progressPayloadSchema
  .extend({
    stage: z.string(),
  })
  .loose();

const imageAnalysisResultSchema = z
  .object({
    centerFocusMetric: z.number(),
    detectedEyeConfidence: z.number().min(0).max(1).optional().nullable(),
    detectedFaceConfidence: z.number().min(0).max(1).optional().nullable(),
    eyeSharpnessMetric: z.number(),
    exposureMetric: z.number(),
    faceSharpnessMetric: z.number(),
    focusConfidence: z.number().min(0).max(1),
    focusRegion: z.string(),
    focusRegionProvider: z.string().optional().nullable(),
    focusScore: z.number().min(0).max(1),
    height: nonnegativeNumberSchema,
    path: z.string(),
    qualityScore: z.number(),
    sharpnessMetric: z.number(),
    width: nonnegativeNumberSchema,
  })
  .loose();

const cullGroupSchema = z
  .object({
    duplicates: z.array(imageAnalysisResultSchema),
    representative: imageAnalysisResultSchema,
  })
  .loose();

const cullingLatencyReportSchema = z
  .object({
    analysisModeCount: nonnegativeNumberSchema,
    averageAnalysisMs: nonnegativeNumberSchema,
    failedCount: nonnegativeNumberSchema,
    maxAnalysisMs: nonnegativeNumberSchema,
    sourceCount: nonnegativeNumberSchema,
    successfulCount: nonnegativeNumberSchema,
    totalElapsedMs: nonnegativeNumberSchema,
  })
  .loose();

export const cullingSuggestionsPayloadSchema = z
  .object({
    blurryImages: z.array(imageAnalysisResultSchema),
    failedPaths: z.array(z.string()),
    focusRankings: z.array(imageAnalysisResultSchema).default([]),
    latencyReport: cullingLatencyReportSchema.nullable().default(null),
    similarGroups: z.array(cullGroupSchema),
  })
  .loose();

export const parseStringPayload = (value: unknown): string => stringPayloadSchema.parse(value);
export const parseCountPayload = (value: unknown): number => countPayloadSchema.parse(value);
const toProgress = (payload: ProgressPayload): Progress => {
  const progress: Progress = {
    current: payload.current,
    total: payload.total,
  };

  if (payload.completed !== undefined) {
    progress.completed = payload.completed;
  }
  if (payload.stage !== undefined) {
    progress.stage = payload.stage;
  }

  return progress;
};

export const parseProgressPayload = (value: unknown): Progress => toProgress(progressPayloadSchema.parse(value));
export const parseThumbnailGeneratedPayload = (value: unknown) => thumbnailGeneratedPayloadSchema.parse(value);
export const parseThumbnailInvalidatedPayload = (value: unknown) => thumbnailInvalidatedPayloadSchema.parse(value);
export const parseSmartPreviewGeneratedPayload = (value: unknown) => smartPreviewGeneratedPayloadSchema.parse(value);
export const parseImportStartPayload = (value: unknown) => importStartPayloadSchema.parse(value);
export const parseImportProgressPayload = (value: unknown) => importProgressPayloadSchema.parse(value);
export const parseImportTerminalPayload = (value: unknown) => importTerminalPayloadSchema.parse(value);
export const parseImportErrorPayload = (value: unknown) => importErrorPayloadSchema.parse(value);
export const parsePathProgressPayload = (value: unknown) => pathProgressPayloadSchema.parse(value);
export const parseDenoiseCompletePayload = (value: unknown) => denoiseCompletePayloadSchema.parse(value);
export const parseDenoiseErrorPayload = (value: unknown) => denoiseErrorPayloadSchema.parse(value);
export const parseDenoiseProgressPayload = (value: unknown) => denoiseProgressPayloadSchema.parse(value);
export const parseRenderPathPayload = (value: unknown) => renderPathPayloadSchema.parse(value);
export const parseBase64Payload = (value: unknown) => base64PayloadSchema.parse(value);
export const parseHdrCompletePayload = (value: unknown) => hdrCompletePayloadSchema.parse(value);
export const parseGamutWarningOverlayPayload = (value: unknown) => gamutWarningOverlayPayloadSchema.parse(value);
export const parsePanoramaCompletePayload = (value: unknown) => panoramaCompletePayloadSchema.parse(value);
export const parseAiConnectorStatusPayload = (value: unknown) => aiConnectorStatusPayloadSchema.parse(value);
export const parseExportReceiptPayload = (value: unknown) => exportReceiptPayloadSchema.parse(value);
export const parseCullingProgressPayload = (value: unknown): CullingProgressPayload => {
  const payload = cullingProgressPayloadSchema.parse(value);
  const progress = toProgress(payload);
  return { ...progress, stage: payload.stage };
};
export const parseCullingSuggestionsPayload = (value: unknown): CullingSuggestions =>
  cullingSuggestionsPayloadSchema.parse(value);

export const persistedRenderStateRecoveryPayloadSchema = z.object({
  backupPath: z.string().nullable(),
  outcome: z.enum(['migrated', 'recovered', 'quarantined', 'unsupported']),
  path: z.string(),
  reasonCodes: z.array(z.string()),
});

export const nativeQaResetPayloadSchema = z.object({
  mode: z.enum(['empty', 'library', 'editor']),
  sessionRevision: z.number().int().positive(),
  sourcePath: z.string().nullable(),
});

export const nativeQaOpenFixturePayloadSchema = z.object({
  path: z.string().min(1),
  sessionRevision: z.number().int().positive(),
});
