import { z } from 'zod';

export const RAW_ENGINE_SCHEMA_VERSION = 1;

export const ActorKind = {
  Agent: 'agent',
  Batch: 'batch',
  Cli: 'cli',
  Plugin: 'plugin',
  Server: 'server',
  Test: 'test',
  Ui: 'ui',
} as const;

export const actorKindSchema = z.enum([
  ActorKind.Agent,
  ActorKind.Batch,
  ActorKind.Cli,
  ActorKind.Plugin,
  ActorKind.Server,
  ActorKind.Test,
  ActorKind.Ui,
]);

export const ApprovalClass = {
  BatchApply: 'batch_apply',
  CloudService: 'cloud_service',
  EditApply: 'edit_apply',
  ExpensiveJob: 'expensive_job',
  ExternalModel: 'external_model',
  FileMutation: 'file_mutation',
  GenerativeEdit: 'generative_edit',
  ModelSupplyChain: 'model_supply_chain',
  PreviewOnly: 'preview_only',
  SafeRead: 'safe_read',
  UnsafeImport: 'unsafe_import',
} as const;

export const approvalClassSchema = z.enum([
  ApprovalClass.SafeRead,
  ApprovalClass.PreviewOnly,
  ApprovalClass.EditApply,
  ApprovalClass.BatchApply,
  ApprovalClass.FileMutation,
  ApprovalClass.ExternalModel,
  ApprovalClass.CloudService,
  ApprovalClass.GenerativeEdit,
  ApprovalClass.ExpensiveJob,
  ApprovalClass.UnsafeImport,
  ApprovalClass.ModelSupplyChain,
]);

export const approvalStateSchema = z.enum(['not_required', 'pending', 'approved', 'denied']);

export const rawEngineActorSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: actorKindSchema,
    sessionId: z.string().trim().min(1).optional(),
  })
  .strict();

export const rawEngineTargetKindSchema = z.enum([
  'project',
  'image',
  'virtual_copy',
  'layer',
  'mask',
  'artifact',
  'roll',
  'export',
]);

export const rawEngineTargetSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1).optional(),
    kind: rawEngineTargetKindSchema,
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((target) => target.id !== undefined || target.imagePath !== undefined, {
    message: 'Target requires an id or imagePath.',
  });

export const approvalRequirementSchema = z
  .object({
    approvalClass: approvalClassSchema,
    reason: z.string().trim().min(1),
    recordId: z.string().trim().min(1).optional(),
    state: approvalStateSchema,
  })
  .strict();

export const commandEnvelopeV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    approval: approvalRequirementSchema,
    commandId: z.string().trim().min(1),
    commandType: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1).optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: rawEngineTargetSchema,
  })
  .strict();

export const queryEnvelopeV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    correlationId: z.string().trim().min(1),
    parameters: z.record(z.string(), z.unknown()),
    queryId: z.string().trim().min(1),
    queryType: z.string().trim().min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    target: rawEngineTargetSchema,
  })
  .strict();

export const artifactHandleV1Schema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().trim().min(1).optional(),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict()
      .optional(),
    kind: z.enum(['mask', 'preview', 'generated_patch', 'denoise_output', 'merge_output', 'export']),
    storage: z.enum(['temp_cache', 'sidecar_artifact', 'export_path']),
  })
  .strict();

export const rawEngineToolKindSchema = z.enum(['read', 'preview', 'dry_run', 'apply', 'export', 'job']);

export const rawEngineToolDefinitionV1Schema = z
  .object({
    approvalClass: approvalClassSchema,
    inputSchemaName: z.string().trim().min(1),
    mutates: z.boolean(),
    outputSchemaName: z.string().trim().min(1),
    requiresDryRun: z.boolean(),
    returnsArtifactHandles: z.boolean(),
    toolKind: rawEngineToolKindSchema,
    toolName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u),
  })
  .strict();

export const rawEngineToolRegistryV1Schema = z
  .object({
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    tools: z.array(rawEngineToolDefinitionV1Schema).min(1),
  })
  .strict();

export const panoramaProjectionSchema = z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar']);

export const panoramaProjectionSupportSchema = z.enum(['implemented_current_engine', 'schema_only_deferred']);

export const panoramaProjectionSettingsV1Schema = z
  .object({
    deferredReason: z.string().trim().min(1).optional(),
    effectiveProjection: panoramaProjectionSchema,
    horizontalFovDegrees: z.number().positive().max(360).optional(),
    inputFocalLength35mmEquivalentMm: z.number().positive().optional(),
    requestedProjection: panoramaProjectionSchema,
    support: panoramaProjectionSupportSchema,
    verticalFovDegrees: z.number().positive().max(180).optional(),
  })
  .strict()
  .refine((settings) => settings.support === 'implemented_current_engine' || settings.deferredReason !== undefined, {
    message: 'Deferred projection settings require deferredReason.',
    path: ['deferredReason'],
  });

export const panoramaBoundaryModeSchema = z.enum(['auto_crop', 'transparent', 'manual_crop', 'deferred_fill']);

export const panoramaBoundarySupportSchema = z.enum(['implemented_current_engine', 'schema_only_deferred']);

export const panoramaWarningCodeSchema = z.enum([
  'source_excluded',
  'insufficient_features',
  'ambiguous_matches',
  'weak_alignment',
  'low_inlier_count',
  'high_memory_estimate',
  'memory_budget_exceeded',
  'missing_lens_correction',
  'exposure_mismatch',
  'projection_runtime_deferred',
  'boundary_runtime_deferred',
  'cancellation_not_supported',
]);

export const panoramaEngineCapabilitiesV1Schema = z
  .object({
    adaptiveSeamFeather: z.boolean(),
    autoCrop: z.boolean(),
    bundleAdjustment: z.boolean(),
    cylindricalProjection: z.boolean(),
    exposureNormalization: z.boolean(),
    planarHomography: z.boolean(),
    tiledRender: z.boolean(),
  })
  .strict();

export const panoramaEngineV1Schema = z
  .object({
    capabilities: panoramaEngineCapabilitiesV1Schema,
    engineId: z.literal('rapidraw_homography_seam_v0'),
    qualityTier: z.enum(['legacy_local_preview', 'validated_planar_v1']),
  })
  .strict();

export const panoramaSourceImageRefV1Schema = z
  .object({
    colorSpaceHint: z.string().trim().min(1).optional(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    lensCorrectionState: z.enum(['unknown', 'not_applied', 'applied', 'required_before_stitch']),
    rawDefaultsApplied: z.boolean(),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const panoramaCropV1Schema = z
  .object({
    height: z.number().int().positive(),
    mode: z.enum(['none', 'auto', 'manual']),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

export const panoramaBoundarySettingsV1Schema = z
  .object({
    crop: panoramaCropV1Schema,
    deferredReason: z.string().trim().min(1).optional(),
    effectiveMode: panoramaBoundaryModeSchema,
    fillColor: z
      .object({
        alpha: z.number().min(0).max(1),
        blue: z.number().min(0).max(1),
        green: z.number().min(0).max(1),
        red: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    requestedMode: panoramaBoundaryModeSchema,
    support: panoramaBoundarySupportSchema,
  })
  .strict()
  .refine((settings) => settings.support === 'implemented_current_engine' || settings.deferredReason !== undefined, {
    message: 'Deferred boundary settings require deferredReason.',
    path: ['deferredReason'],
  });

export const panoramaPairwiseMatchV1Schema = z
  .object({
    fromSourceIndex: z.number().int().nonnegative(),
    homography3x3: z.tuple([
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
      z.number(),
    ]),
    inliers: z.number().int().nonnegative(),
    matchQuality: z.enum(['accepted', 'weak', 'rejected']),
    reprojectionErrorPx: z.number().nonnegative().optional(),
    toSourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const panoramaAlignmentV1Schema = z
  .object({
    algorithmId: z.literal('rapidraw_fast9_brief_ransac_v1'),
    downscaleMaxDimensionPx: z.number().int().positive(),
    globalHomographyCount: z.number().int().nonnegative(),
    minimumInliersForConnection: z.number().int().positive(),
    pairwiseMatches: z.array(panoramaPairwiseMatchV1Schema),
    ransacSeed: z.number().int().nonnegative().optional(),
    ransacInlierThresholdPx: z.number().positive(),
    ransacIterations: z.number().int().positive(),
  })
  .strict();

export const panoramaExposureNormalizationV1Schema = z
  .object({
    deferredReason: z.string().trim().min(1).optional(),
    mode: z.enum(['none', 'planned', 'gain_offset_v1']),
    overlapMetrics: z
      .object({
        channelRatioDeltaAfter: z.number().nonnegative().optional(),
        channelRatioDeltaBefore: z.number().nonnegative().optional(),
        clippingIncreaseRatio: z.number().nonnegative().optional(),
        medianLogLuminanceDeltaAfter: z.number().nonnegative().optional(),
        medianLogLuminanceDeltaBefore: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    perSourceCorrections: z
      .array(
        z
          .object({
            exposureEv: z.number(),
            sourceIndex: z.number().int().nonnegative(),
            temperatureShift: z.number().optional(),
            tintShift: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
    skippedReason: z.enum(['insufficient_overlap', 'low_confidence_alignment', 'not_requested']).optional(),
    support: z.enum(['implemented_current_engine', 'schema_only_deferred']),
  })
  .strict()
  .refine((settings) => settings.support === 'implemented_current_engine' || settings.deferredReason !== undefined, {
    message: 'Deferred exposure normalization requires deferredReason.',
    path: ['deferredReason'],
  });

export const panoramaSeamPolicyV1Schema = z
  .object({
    featherWidthPx: z.number().positive(),
    lowDetailFeatherMultiplier: z.number().positive(),
    mode: z.enum(['adaptive_dp_feather_v1', 'overwrite_fallback']),
  })
  .strict();

export const panoramaValidationMetricsV1Schema = z
  .object({
    estimatedPeakMemoryBytes: z.number().int().nonnegative().optional(),
    excludedSourceCount: z.number().int().nonnegative(),
    overlapCoverageRatio: z.number().min(0).max(1).optional(),
    outputHeight: z.number().int().positive(),
    outputWidth: z.number().int().positive(),
    reprojectionP95Px: z.number().nonnegative().optional(),
    reprojectionRmsPx: z.number().nonnegative().optional(),
    seamEnergy: z.number().nonnegative().optional(),
    sourceCount: z.number().int().positive(),
    stitchedSourceCount: z.number().int().positive(),
  })
  .strict();

export const panoramaArtifactV1Schema = z
  .object({
    alignment: panoramaAlignmentV1Schema,
    artifactId: z.string().trim().min(1),
    boundaryMode: panoramaBoundaryModeSchema,
    boundarySettings: panoramaBoundarySettingsV1Schema,
    createdAt: z.iso.datetime({ offset: true }),
    crop: panoramaCropV1Schema,
    excludedSources: z
      .array(
        z
          .object({
            reason: panoramaWarningCodeSchema,
            sourceIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .default([]),
    engine: panoramaEngineV1Schema,
    exposureNormalization: panoramaExposureNormalizationV1Schema,
    lensCorrectionPolicy: z.enum(['unchanged', 'required_before_stitch', 'applied_before_stitch', 'deferred']),
    operationId: z.string().trim().min(1),
    operationVersion: z.literal(1),
    outputArtifacts: z.array(artifactHandleV1Schema).min(1),
    outputColorSpace: z.string().trim().min(1),
    previewArtifacts: z.array(artifactHandleV1Schema),
    projection: panoramaProjectionSchema,
    projectionSettings: panoramaProjectionSettingsV1Schema,
    provenance: z
      .object({
        commandId: z.string().trim().min(1).optional(),
        graphRevision: z.string().trim().min(1).optional(),
        runtimeStatus: z.enum(['schema_only', 'dry_run_planned', 'rendered']),
      })
      .strict(),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    seamPolicy: panoramaSeamPolicyV1Schema,
    sourceImageRefs: z.array(panoramaSourceImageRefV1Schema).min(2),
    validationMetrics: panoramaValidationMetricsV1Schema,
    warnings: z.array(panoramaWarningCodeSchema),
  })
  .strict();

export const negativeInputModeSchema = z.enum([
  'camera_raw',
  'camera_tiff',
  'flatbed_tiff',
  'lab_tiff',
  'lab_jpeg',
  'contact_sheet',
  'unknown',
]);

export const negativePixelBasisSchema = z.enum([
  'camera_raw_rgb',
  'camera_rendered',
  'scanner_rgb',
  'lab_rendered_rgb',
  'display_rgb',
  'unknown',
]);

export const negativeAcquisitionConfidenceSchema = z.enum(['high', 'medium', 'low', 'blocked']);

export const negativeWarningSeveritySchema = z.enum(['info', 'warning', 'error', 'blocking']);

export const negativeWarningCodeSchema = z.enum([
  'unknown_input_mode',
  'unknown_pixel_basis',
  'unknown_input_profile',
  'assumed_display_profile',
  'display_referred_input',
  'lossy_input',
  'low_bit_depth_input',
  'suspected_lab_correction',
  'suspected_pre_inversion',
  'suspected_auto_exposure',
  'suspected_auto_color',
  'suspected_auto_contrast',
  'suspected_sharpening',
  'suspected_ir_cleaning',
  'missing_visible_base',
  'cropped_no_border',
  'clipped_base_channel',
  'uneven_illumination',
  'mixed_frame_input_modes',
  'contact_sheet_requires_split',
  'profile_mismatch',
  'low_acquisition_confidence',
]);

export const negativeProcessFamilySchema = z.enum([
  'c41_color_negative',
  'black_and_white_silver_negative',
  'chromogenic_black_and_white_negative',
  'ecn2_color_negative',
  'e6_slide_helper',
  'redscale_or_creative_negative',
  'unknown',
]);

export const negativeWarningV1Schema = z
  .object({
    blocksAutomation: z.boolean(),
    code: negativeWarningCodeSchema,
    evidence: z.string().trim().min(1),
    frameIds: z.array(z.string().trim().min(1)).optional(),
    scope: z.enum(['session', 'frame', 'profile']),
    severity: negativeWarningSeveritySchema,
  })
  .strict();

const normalizedScoreSchema = z.number().min(0).max(1);

export const negativeAcquisitionProfileV1Schema = z
  .object({
    acquisitionConfidence: negativeAcquisitionConfidenceSchema,
    autoColorSuspected: z.boolean(),
    autoContrastSuspected: z.boolean(),
    autoExposureSuspected: z.boolean(),
    bitDepth: z.number().int().positive().optional(),
    captureDeviceName: z.string().trim().min(1).optional(),
    captureDeviceType: z.enum(['camera', 'flatbed_scanner', 'lab_scanner', 'unknown']),
    channelClippingScore: normalizedScoreSchema,
    compressionArtifactScore: normalizedScoreSchema,
    compressionKind: z.enum(['none', 'lossless', 'lossy', 'unknown']),
    createdFrom: z.string().trim().min(1),
    diffuserOrHolderNotes: z.string().trim().min(1).optional(),
    dustRemovalSuspected: z.boolean(),
    embeddedProfileSummary: z.string().trim().min(1).optional(),
    fileFormat: z.enum(['raw', 'dng', 'tiff', 'png', 'jpeg', 'unknown']),
    filmHolderType: z.string().trim().min(1).optional(),
    frameSpacingState: z.enum(['single_frame', 'regular_strip', 'irregular_strip', 'contact_sheet', 'unknown']),
    inputMode: negativeInputModeSchema,
    inputProfileId: z.string().trim().min(1).optional(),
    inputProfileSource: z.enum([
      'explicit_project_profile',
      'embedded_icc',
      'raw_decoder_camera_profile',
      'generic_assumption',
      'assumed_display_profile',
      'unknown',
    ]),
    inputProfileVersion: z.string().trim().min(1).optional(),
    irCleaningSuspected: z.boolean(),
    lensModel: z.string().trim().min(1).optional(),
    lightSourceCct: z.number().int().positive().optional(),
    lightSourceConfidence: negativeAcquisitionConfidenceSchema,
    lightSourceType: z.enum(['led_panel', 'flash', 'enlarger', 'scanner', 'lab_unknown', 'unknown']),
    pixelBasis: negativePixelBasisSchema,
    preInversionSuspected: z.boolean(),
    profileConfidence: negativeAcquisitionConfidenceSchema,
    profileId: z.string().trim().min(1),
    rebateOrBorderState: z.enum(['visible', 'partially_visible', 'cropped_out', 'unknown']),
    reviewedAt: z.string().trim().min(1).optional(),
    scannerOrCameraModel: z.string().trim().min(1).optional(),
    scannerSoftware: z.string().trim().min(1).optional(),
    scannerSoftwareVersion: z.string().trim().min(1).optional(),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sharpeningSuspected: z.boolean(),
    unevenIlluminationScore: normalizedScoreSchema,
    visibleBaseState: z.enum(['visible', 'partially_visible', 'not_visible', 'unknown']),
    warnings: z.array(negativeWarningV1Schema),
  })
  .strict();

export const negativeFrameRecordV1Schema = z
  .object({
    acquisitionOverrideProfileId: z.string().trim().min(1).optional(),
    baseSampleIds: z.array(z.string().trim().min(1)),
    borderState: z.enum(['visible', 'partial', 'cropped', 'unknown']),
    contentHash: z.string().trim().min(1),
    conversionCommandIds: z.array(z.string().trim().min(1)),
    crop: z
      .object({
        height: z.number().positive(),
        rotationDegrees: z.number(),
        width: z.number().positive(),
        x: z.number(),
        y: z.number(),
      })
      .strict()
      .optional(),
    frameId: z.string().trim().min(1),
    frameIndex: z.number().int().nonnegative(),
    positiveVariantIds: z.array(z.string().trim().min(1)),
    qcStatus: z.enum(['needs_review', 'approved', 'approved_with_warnings', 'rejected', 'excluded_from_export']),
    sourcePath: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeRollSessionV1Schema = z
  .object({
    acquisitionProfileId: z.string().trim().min(1),
    acquisitionWarnings: z.array(negativeWarningV1Schema),
    anchorFrameIds: z.array(z.string().trim().min(1)),
    conversionWarnings: z.array(negativeWarningV1Schema),
    frameRecords: z.array(negativeFrameRecordV1Schema).min(1),
    inputMode: negativeInputModeSchema,
    perFrameOverrideIds: z.array(z.string().trim().min(1)),
    pixelBasis: negativePixelBasisSchema,
    processFamily: negativeProcessFamilySchema,
    provenanceEntryIds: z.array(z.string().trim().min(1)),
    qcStatus: z.enum(['needs_review', 'approved', 'approved_with_warnings', 'rejected', 'excluded_from_export']),
    rollDefaultCommandIds: z.array(z.string().trim().min(1)),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1),
    sharedBaseSampleIds: z.array(z.string().trim().min(1)),
    sourceFileIds: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const nonEmptyIdArraySchema = z.array(z.string().trim().min(1)).min(1);

export const negativeLabCommandTypeSchema = z.enum([
  'negativeLab.createRollSession',
  'negativeLab.sampleFilmBase',
  'negativeLab.convertFrames',
  'negativeLab.normalizeRoll',
  'negativeLab.createPositiveVariant',
  'negativeLab.updateFrameQc',
]);

export const negativeLabBaseSampleRegionV1Schema = z
  .object({
    frameId: z.string().trim().min(1),
    height: z.number().positive(),
    regionKind: z.enum(['film_base', 'rebate', 'leader', 'manual_neutral_reference']),
    width: z.number().positive(),
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const negativeLabCreateRollSessionParametersV1Schema = z
  .object({
    acquisitionProfileId: z.string().trim().min(1).optional(),
    inputMode: negativeInputModeSchema,
    notes: z.string().trim().min(1).optional(),
    pixelBasis: negativePixelBasisSchema,
    processFamily: negativeProcessFamilySchema,
    sourceFileIds: nonEmptyIdArraySchema,
    splitContactSheets: z.boolean(),
  })
  .strict();

export const negativeLabSampleFilmBaseParametersV1Schema = z
  .object({
    applyTo: z.enum(['roll', 'selected_frames']),
    replaceSampleIds: z.array(z.string().trim().min(1)),
    sampleRegions: z.array(negativeLabBaseSampleRegionV1Schema).min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabConvertFramesParametersV1Schema = z
  .object({
    acquisitionProfileId: z.string().trim().min(1).optional(),
    baseSampleIds: nonEmptyIdArraySchema,
    densityModel: z.enum(['log_transmittance', 'scanner_rgb_approximation']),
    frameIds: nonEmptyIdArraySchema,
    inversionMethod: z.enum(['neutral_base', 'profiled_process', 'manual_curve']),
    outputIntent: z.enum(['editable_positive', 'proof_preview', 'export_ready_preview']),
    preserveDensityArtifacts: z.boolean(),
    processFamily: negativeProcessFamilySchema,
    sessionId: z.string().trim().min(1),
    targetWorkingSpace: z.enum(['linear_prophoto_rgb', 'linear_rec2020', 'acescg']),
  })
  .strict();

export const negativeLabNormalizeRollParametersV1Schema = z
  .object({
    anchorFrameIds: nonEmptyIdArraySchema,
    frameIds: nonEmptyIdArraySchema,
    normalizationMode: z.enum(['exposure_only', 'white_balance_only', 'density_and_balance']),
    preserveCreativeAdjustments: z.boolean(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabCreatePositiveVariantParametersV1Schema = z
  .object({
    frameIds: nonEmptyIdArraySchema,
    inheritRollDefaults: z.boolean(),
    positiveVariantName: z.string().trim().min(1),
    renderProfileId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabUpdateFrameQcParametersV1Schema = z
  .object({
    frameId: z.string().trim().min(1),
    notes: z.string().trim().min(1).optional(),
    qcStatus: z.enum(['needs_review', 'approved', 'approved_with_warnings', 'rejected', 'excluded_from_export']),
    sessionId: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabCreateRollSessionCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.createRollSession'),
    parameters: negativeLabCreateRollSessionParametersV1Schema,
  })
  .strict();

export const negativeLabSampleFilmBaseCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.sampleFilmBase'),
    parameters: negativeLabSampleFilmBaseParametersV1Schema,
  })
  .strict();

export const negativeLabConvertFramesCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.convertFrames'),
    parameters: negativeLabConvertFramesParametersV1Schema,
  })
  .strict();

export const negativeLabNormalizeRollCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.normalizeRoll'),
    parameters: negativeLabNormalizeRollParametersV1Schema,
  })
  .strict();

export const negativeLabCreatePositiveVariantCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.createPositiveVariant'),
    parameters: negativeLabCreatePositiveVariantParametersV1Schema,
  })
  .strict();

export const negativeLabUpdateFrameQcCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.updateFrameQc'),
    parameters: negativeLabUpdateFrameQcParametersV1Schema,
  })
  .strict();

export const negativeLabCommandEnvelopeV1Schema = z.discriminatedUnion('commandType', [
  negativeLabCreateRollSessionCommandV1Schema,
  negativeLabSampleFilmBaseCommandV1Schema,
  negativeLabConvertFramesCommandV1Schema,
  negativeLabNormalizeRollCommandV1Schema,
  negativeLabCreatePositiveVariantCommandV1Schema,
  negativeLabUpdateFrameQcCommandV1Schema,
]);

export type ActorKind = z.infer<typeof actorKindSchema>;
export type ApprovalClass = z.infer<typeof approvalClassSchema>;
export type ApprovalRequirementV1 = z.infer<typeof approvalRequirementSchema>;
export type ArtifactHandleV1 = z.infer<typeof artifactHandleV1Schema>;
export type CommandEnvelopeV1 = z.infer<typeof commandEnvelopeV1Schema>;
export type NegativeAcquisitionConfidence = z.infer<typeof negativeAcquisitionConfidenceSchema>;
export type NegativeAcquisitionProfileV1 = z.infer<typeof negativeAcquisitionProfileV1Schema>;
export type NegativeLabBaseSampleRegionV1 = z.infer<typeof negativeLabBaseSampleRegionV1Schema>;
export type NegativeLabCommandEnvelopeV1 = z.infer<typeof negativeLabCommandEnvelopeV1Schema>;
export type NegativeLabCommandType = z.infer<typeof negativeLabCommandTypeSchema>;
export type NegativeLabConvertFramesParametersV1 = z.infer<typeof negativeLabConvertFramesParametersV1Schema>;
export type NegativeLabCreatePositiveVariantParametersV1 = z.infer<
  typeof negativeLabCreatePositiveVariantParametersV1Schema
>;
export type NegativeLabCreateRollSessionParametersV1 = z.infer<typeof negativeLabCreateRollSessionParametersV1Schema>;
export type NegativeLabNormalizeRollParametersV1 = z.infer<typeof negativeLabNormalizeRollParametersV1Schema>;
export type NegativeLabSampleFilmBaseParametersV1 = z.infer<typeof negativeLabSampleFilmBaseParametersV1Schema>;
export type NegativeLabUpdateFrameQcParametersV1 = z.infer<typeof negativeLabUpdateFrameQcParametersV1Schema>;
export type NegativeFrameRecordV1 = z.infer<typeof negativeFrameRecordV1Schema>;
export type NegativeInputMode = z.infer<typeof negativeInputModeSchema>;
export type NegativePixelBasis = z.infer<typeof negativePixelBasisSchema>;
export type NegativeProcessFamily = z.infer<typeof negativeProcessFamilySchema>;
export type NegativeRollSessionV1 = z.infer<typeof negativeRollSessionV1Schema>;
export type NegativeWarningCode = z.infer<typeof negativeWarningCodeSchema>;
export type NegativeWarningSeverity = z.infer<typeof negativeWarningSeveritySchema>;
export type NegativeWarningV1 = z.infer<typeof negativeWarningV1Schema>;
export type PanoramaArtifactV1 = z.infer<typeof panoramaArtifactV1Schema>;
export type QueryEnvelopeV1 = z.infer<typeof queryEnvelopeV1Schema>;
export type RawEngineActor = z.infer<typeof rawEngineActorSchema>;
export type RawEngineTarget = z.infer<typeof rawEngineTargetSchema>;
export type RawEngineToolDefinitionV1 = z.infer<typeof rawEngineToolDefinitionV1Schema>;
export type RawEngineToolRegistryV1 = z.infer<typeof rawEngineToolRegistryV1Schema>;
