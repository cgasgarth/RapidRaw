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
  'frame_detection_low_confidence',
  'irregular_frame_spacing',
  'overlapping_frame_candidates',
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

export const negativeLabSupportedProcessFamilyV1Schema = z.enum([
  'c41_color_negative',
  'black_and_white_silver_negative',
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

export const negativeLabProcessProfileClassSchema = z.enum([
  'generic_process',
  'stock_family_starting_point',
  'measured_project_profile',
  'user_profile',
  'reference_mapping',
]);

export const negativeLabLegalNamingStatusSchema = z.enum([
  'generic_safe_name',
  'descriptive_stock_family',
  'legal_review_required',
  'approved_exact_stock_name',
]);

export const negativeLabProfileMeasurementSourceSchema = z.enum([
  'generic_engineered_starting_point',
  'project_owned_measurement',
  'user_supplied_measurement',
  'research_reference_metadata_only',
]);

export const negativeLabDensityCurvePointV1Schema = z
  .object({
    inputDensity: z.number().min(0),
    outputLinear: z.number().min(0),
  })
  .strict();

export const negativeLabDensityCurveV1Schema = z
  .object({
    channel: z.enum(['red', 'green', 'blue', 'luminance']),
    interpolation: z.enum(['linear', 'monotone_cubic']),
    points: z.array(negativeLabDensityCurvePointV1Schema).min(2),
  })
  .strict()
  .superRefine((curve, context) => {
    const [firstPoint, ...remainingPoints] = curve.points;
    if (firstPoint === undefined) return;

    let previous = firstPoint;
    for (const [offset, current] of remainingPoints.entries()) {
      const index = offset + 1;

      if (current.inputDensity <= previous.inputDensity) {
        context.addIssue({
          code: 'custom',
          message: 'Density curve inputDensity values must be strictly increasing.',
          path: ['points', index, 'inputDensity'],
        });
      }

      if (current.outputLinear < previous.outputLinear) {
        context.addIssue({
          code: 'custom',
          message: 'Density curve outputLinear values must be monotonic non-decreasing.',
          path: ['points', index, 'outputLinear'],
        });
      }

      previous = current;
    }
  });

export const negativeLabDensityNormalizationProfileV1Schema = z
  .object({
    algorithmId: z.literal('density_normalization_v1'),
    anchorPolicy: z.enum(['roll_anchor_frames', 'selected_frames', 'per_frame_only']),
    channelBalanceWeights: z
      .object({
        blue: z.number().min(0).max(1),
        green: z.number().min(0).max(1),
        red: z.number().min(0).max(1),
      })
      .strict(),
    densityAim: z
      .object({
        highlightDensity: z.number().min(0),
        midtoneDensity: z.number().min(0),
        shadowDensity: z.number().min(0),
      })
      .strict(),
    exposureReferenceDensity: z.number().min(0),
    normalizationProfileId: z.string().trim().min(1),
    profileVersion: z.string().trim().min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    supportedProcessFamilies: z.array(negativeLabSupportedProcessFamilyV1Schema).min(1),
  })
  .strict()
  .superRefine((profile, context) => {
    const { highlightDensity, midtoneDensity, shadowDensity } = profile.densityAim;
    if (!(highlightDensity < midtoneDensity && midtoneDensity < shadowDensity)) {
      context.addIssue({
        code: 'custom',
        message: 'Density normalization aims must progress highlight < midtone < shadow.',
        path: ['densityAim'],
      });
    }

    const channelWeightTotal =
      profile.channelBalanceWeights.red + profile.channelBalanceWeights.green + profile.channelBalanceWeights.blue;
    if (Math.abs(channelWeightTotal - 1) > 0.001) {
      context.addIssue({
        code: 'custom',
        message: 'Density normalization channel weights must sum to 1.',
        path: ['channelBalanceWeights'],
      });
    }
  });

export const negativeLabProcessProfileV1Schema = z
  .object({
    colorMode: z.enum(['color_negative_rgb', 'black_and_white_luminance']),
    curveModelId: z.literal('process_profile_monotonic_v1'),
    densityCurves: z.array(negativeLabDensityCurveV1Schema).min(1),
    normalizationProfileId: z.string().trim().min(1),
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    profileClass: negativeLabProcessProfileClassSchema,
    profileId: z.string().trim().min(1),
    profileVersion: z.string().trim().min(1),
    provenance: z
      .object({
        claimsPolicy: z.enum(['generic_starting_point_only', 'measured_profile', 'reference_metadata_only']),
        fixtureIds: z.array(z.string().trim().min(1)),
        legalNamingStatus: negativeLabLegalNamingStatusSchema,
        measurementSource: negativeLabProfileMeasurementSourceSchema,
      })
      .strict(),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    touchedParameters: z
      .object({
        creativeRendering: z.array(z.string().trim().min(1)),
        objectiveInversion: z.array(z.string().trim().min(1)),
        semiObjectiveNormalization: z.array(z.string().trim().min(1)),
      })
      .strict(),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.profileClass === 'measured_project_profile' && profile.provenance.fixtureIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Measured project profiles require at least one fixture ID.',
        path: ['provenance', 'fixtureIds'],
      });
    }

    if (
      profile.profileClass === 'measured_project_profile' &&
      profile.provenance.measurementSource !== 'project_owned_measurement'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Measured project profiles must use project-owned measurement provenance.',
        path: ['provenance', 'measurementSource'],
      });
    }

    if (profile.colorMode === 'black_and_white_luminance') {
      const nonLuminanceCurve = profile.densityCurves.find((curve) => curve.channel !== 'luminance');
      if (nonLuminanceCurve !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Black-and-white process profiles must use luminance density curves only.',
          path: ['densityCurves'],
        });
      }
    }
  });

const negativeLabGenericPresetIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[0-9]+$/u);

const negativeLabPresetHumanTextSchema = z.string().trim().min(1).max(280);

const unsafeGenericPresetClaimPattern =
  /\b(?:adobe|capture one|dehancer|ektachrome|ektar|exact|fujifilm|fuji|gold|identical|ilford|kodak|lightroom|mastin|manufacturer[ -]?approved|negative lab pro|nlp|official|portra|rni|tri-x|t-max|vsco)\b/iu;

export const negativeLabBuiltInPresetTierSchema = z.enum([
  'generic_builtin',
  'stock_family_reference',
  'measured_project_profile',
  'user_profile',
]);

export const negativeLabBuiltInPresetFilmClassSchema = z.enum(['color_negative', 'black_and_white_silver']);

export const negativeLabPresetProfileRefV1Schema = z
  .object({
    colorMode: z.enum(['color_negative_rgb', 'black_and_white_luminance']),
    normalizationProfileId: z.string().trim().min(1),
    normalizationProfileVersion: z.string().trim().min(1),
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    processProfileId: z.string().trim().min(1),
    processProfileVersion: z.string().trim().min(1),
  })
  .strict();

export const negativeLabBuiltInPresetV1Schema = z
  .object({
    claimLevel: z.enum(['generic_starting_point_only', 'reference_metadata_only', 'measured_profile']),
    deprecatedBy: negativeLabGenericPresetIdSchema.optional(),
    description: negativeLabPresetHumanTextSchema,
    displayName: negativeLabPresetHumanTextSchema,
    filmClass: negativeLabBuiltInPresetFilmClassSchema,
    intendedInputModes: z.array(negativeInputModeSchema).min(1),
    intent: z.enum(['neutral', 'portrait', 'high_speed', 'saturated', 'classic_bw', 'fine_grain_bw', 'ortho_bw']),
    legalNamingStatus: negativeLabLegalNamingStatusSchema,
    legalReviewStatus: z.enum(['not_required_generic', 'required_before_exact_name', 'approved']),
    normalizationProfileId: z.string().trim().min(1),
    normalizationProfileVersion: z.string().trim().min(1),
    presetId: negativeLabGenericPresetIdSchema,
    presetTier: negativeLabBuiltInPresetTierSchema,
    presetVersion: z.string().trim().min(1),
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    processProfileId: z.string().trim().min(1),
    processProfileVersion: z.string().trim().min(1),
    provenance: z
      .object({
        claimsPolicy: z.literal('generic_starting_point_only'),
        fixtureIds: z.array(z.string().trim().min(1)),
        legalNote: negativeLabPresetHumanTextSchema,
        measurementSource: negativeLabProfileMeasurementSourceSchema,
        sourceProfileIds: z.array(z.string().trim().min(1)),
      })
      .strict(),
    requiredWarningCodes: z.array(negativeWarningCodeSchema),
    scanAssumptions: z.array(negativeLabPresetHumanTextSchema).min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    touchedParameters: z
      .object({
        creativeRendering: z.array(z.string().trim().min(1)),
        objectiveInversion: z.array(z.string().trim().min(1)),
        semiObjectiveNormalization: z.array(z.string().trim().min(1)),
      })
      .strict(),
  })
  .strict()
  .superRefine((preset, context) => {
    const humanFacingText = [
      preset.displayName,
      preset.description,
      preset.intent,
      preset.provenance.legalNote,
      ...preset.scanAssumptions,
    ].join(' ');

    if (unsafeGenericPresetClaimPattern.test(humanFacingText)) {
      context.addIssue({
        code: 'custom',
        message: 'Generic built-in presets must not use manufacturer, stock, competitor, or exact-emulation claims.',
        path: ['displayName'],
      });
    }

    if (unsafeGenericPresetClaimPattern.test(preset.presetId)) {
      context.addIssue({
        code: 'custom',
        message: 'Generic built-in preset IDs must not contain manufacturer or stock identifiers.',
        path: ['presetId'],
      });
    }

    if (preset.presetTier === 'generic_builtin' && preset.legalNamingStatus !== 'generic_safe_name') {
      context.addIssue({
        code: 'custom',
        message: 'Generic built-in presets must use generic-safe naming status.',
        path: ['legalNamingStatus'],
      });
    }

    if (
      preset.presetTier === 'generic_builtin' &&
      preset.provenance.measurementSource !== 'generic_engineered_starting_point'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Generic built-in presets must use generic engineered provenance, not measured-profile provenance.',
        path: ['provenance', 'measurementSource'],
      });
    }

    if (preset.touchedParameters.creativeRendering.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Generic built-in presets must not declare creative rendering defaults before that schema exists.',
        path: ['touchedParameters', 'creativeRendering'],
      });
    }

    if (preset.intendedInputModes.includes('lab_jpeg')) {
      const requiredLabJpegWarnings = ['lossy_input', 'low_acquisition_confidence'] as const;
      for (const warningCode of requiredLabJpegWarnings) {
        if (!preset.requiredWarningCodes.includes(warningCode)) {
          context.addIssue({
            code: 'custom',
            message: 'Generic presets that allow lab JPEG input must require lossy-input and confidence warnings.',
            path: ['requiredWarningCodes'],
          });
        }
      }

      const labJpegAssumptionText = preset.scanAssumptions.join(' ');
      if (!/\breview\b/iu.test(labJpegAssumptionText)) {
        context.addIssue({
          code: 'custom',
          message: 'Generic presets that allow lab JPEG input must tell callers to review the rendered source.',
          path: ['scanAssumptions'],
        });
      }
    }
  });

export const negativeLabBuiltInPresetCatalogV1Schema = z
  .object({
    catalogId: negativeLabGenericPresetIdSchema,
    catalogVersion: z.string().trim().min(1),
    presets: z.array(negativeLabBuiltInPresetV1Schema).min(1),
    processProfileRefs: z.array(negativeLabPresetProfileRefV1Schema).min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((catalog, context) => {
    const presetIds = new Set<string>();
    const displayNames = new Set<string>();
    const profileRefs = new Map<string, z.infer<typeof negativeLabPresetProfileRefV1Schema>>();

    for (const profileRef of catalog.processProfileRefs) {
      profileRefs.set(`${profileRef.processProfileId}@${profileRef.processProfileVersion}`, profileRef);
    }

    for (const [index, preset] of catalog.presets.entries()) {
      const displayNameKey = preset.displayName.toLocaleLowerCase('en-US');

      if (presetIds.has(preset.presetId)) {
        context.addIssue({
          code: 'custom',
          message: 'Built-in preset catalog must not contain duplicate preset IDs.',
          path: ['presets', index, 'presetId'],
        });
      }
      presetIds.add(preset.presetId);

      if (displayNames.has(displayNameKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Built-in preset catalog must not contain duplicate display names.',
          path: ['presets', index, 'displayName'],
        });
      }
      displayNames.add(displayNameKey);

      const profileRef = profileRefs.get(`${preset.processProfileId}@${preset.processProfileVersion}`);
      if (profileRef === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Built-in presets must reference a known process profile in the catalog.',
          path: ['presets', index, 'processProfileId'],
        });
        continue;
      }

      if (profileRef.processFamily !== preset.processFamily) {
        context.addIssue({
          code: 'custom',
          message: 'Built-in preset process family must match the referenced process profile.',
          path: ['presets', index, 'processFamily'],
        });
      }

      if (
        profileRef.normalizationProfileId !== preset.normalizationProfileId ||
        profileRef.normalizationProfileVersion !== preset.normalizationProfileVersion
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Built-in preset normalization profile must match the referenced process profile defaults.',
          path: ['presets', index, 'normalizationProfileId'],
        });
      }

      if (preset.filmClass === 'black_and_white_silver' && profileRef.colorMode !== 'black_and_white_luminance') {
        context.addIssue({
          code: 'custom',
          message: 'Black-and-white silver presets must reference luminance process profiles.',
          path: ['presets', index, 'filmClass'],
        });
      }

      if (preset.filmClass === 'color_negative' && profileRef.colorMode !== 'color_negative_rgb') {
        context.addIssue({
          code: 'custom',
          message: 'Color negative presets must reference RGB color process profiles.',
          path: ['presets', index, 'filmClass'],
        });
      }
    }
  });

const negativeLabPresetPolicyIdSchema = z
  .string()
  .trim()
  .regex(/^negative_lab\.preset_policy\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[0-9]+$/u);

export const negativeLabPresetMetadataPolicyClaimLevelV1Schema = z.enum([
  'generic_starting_point_only',
  'stock_family_reference_metadata',
  'measured_project_profile',
  'licensed_exact_profile',
  'user_supplied_profile',
  'blocked_or_unsupported',
]);

export const negativeLabPresetMetadataPolicyTierV1Schema = z.enum([
  'generic_builtin',
  'stock_family_reference',
  'measured_project_profile',
  'licensed_profile',
  'user_profile',
  'blocked',
]);

export const negativeLabPresetMetadataLegalReviewStatusV1Schema = z.enum([
  'not_required_generic',
  'required_before_ui',
  'approved',
  'blocked',
]);

export const negativeLabPresetMetadataUiContextV1Schema = z.enum([
  'negative_lab_workspace',
  'preset_browser',
  'app_server_tool',
  'export_sidecar',
  'admin_review_queue',
]);

export const negativeLabPresetMetadataPolicyV1Schema = z
  .object({
    allowedClaims: z
      .object({
        competitorCompatibilityClaim: z.boolean(),
        exactStockName: z.boolean(),
        manufacturerEndorsement: z.boolean(),
        manufacturerName: z.boolean(),
        measuredBehavior: z.boolean(),
        officialProfile: z.boolean(),
      })
      .strict(),
    allowedInputModes: z.array(negativeInputModeSchema).min(1),
    allowedUiContexts: z.array(negativeLabPresetMetadataUiContextV1Schema).min(1),
    claimLevel: negativeLabPresetMetadataPolicyClaimLevelV1Schema,
    displayCopy: z
      .object({
        disclosure: negativeLabPresetHumanTextSchema,
        label: negativeLabPresetHumanTextSchema,
      })
      .strict(),
    legalNamingStatus: negativeLabLegalNamingStatusSchema,
    legalReviewStatus: negativeLabPresetMetadataLegalReviewStatusV1Schema,
    policyId: negativeLabPresetPolicyIdSchema,
    policyVersion: z.string().trim().min(1),
    presetTier: negativeLabPresetMetadataPolicyTierV1Schema,
    prohibitedClaimPhrases: z.array(z.string().trim().min(1)).min(1),
    requiredWarnings: z.array(negativeWarningCodeSchema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sourceRequirements: z
      .object({
        fixtureIds: z.array(z.string().trim().min(1)),
        legalReviewIssue: z.string().trim().min(1).optional(),
        licenseRecordIds: z.array(z.string().trim().min(1)),
        reviewedAt: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/u)
          .optional(),
        reviewer: z.string().trim().min(1).optional(),
        sourceCitationIds: z.array(z.string().trim().min(1)),
      })
      .strict(),
    supportedProcessFamilies: z.array(negativeLabSupportedProcessFamilyV1Schema).min(1),
  })
  .strict()
  .superRefine((policy, context) => {
    const addPolicyIssue = (message: string, path: Array<string | number>) => {
      context.addIssue({ code: 'custom', message, path });
    };

    const hasLegalReviewRecord =
      policy.sourceRequirements.legalReviewIssue !== undefined &&
      policy.sourceRequirements.reviewedAt !== undefined &&
      policy.sourceRequirements.reviewer !== undefined;

    if (policy.claimLevel === 'generic_starting_point_only' || policy.presetTier === 'generic_builtin') {
      if (policy.claimLevel !== 'generic_starting_point_only' || policy.presetTier !== 'generic_builtin') {
        addPolicyIssue('Generic preset metadata policies must pair generic tier with generic claim level.', [
          'claimLevel',
        ]);
      }

      if (policy.legalNamingStatus !== 'generic_safe_name') {
        addPolicyIssue('Generic preset metadata policies must use generic-safe naming status.', ['legalNamingStatus']);
      }

      if (policy.legalReviewStatus !== 'not_required_generic') {
        addPolicyIssue('Generic preset metadata policies must not require legal review.', ['legalReviewStatus']);
      }

      const genericDisallowedClaims = [
        policy.allowedClaims.competitorCompatibilityClaim,
        policy.allowedClaims.exactStockName,
        policy.allowedClaims.manufacturerEndorsement,
        policy.allowedClaims.manufacturerName,
        policy.allowedClaims.measuredBehavior,
        policy.allowedClaims.officialProfile,
      ];
      if (genericDisallowedClaims.some(Boolean)) {
        addPolicyIssue(
          'Generic preset metadata policies must not allow exact, manufacturer, measured, or official claims.',
          ['allowedClaims'],
        );
      }
    }

    if (policy.claimLevel === 'stock_family_reference_metadata') {
      if (policy.presetTier !== 'stock_family_reference') {
        addPolicyIssue('Stock-family reference policies must use the stock-family reference tier.', ['presetTier']);
      }

      if (policy.legalNamingStatus !== 'descriptive_stock_family') {
        addPolicyIssue('Stock-family reference policies must use descriptive stock-family naming.', [
          'legalNamingStatus',
        ]);
      }

      if (policy.sourceRequirements.sourceCitationIds.length === 0) {
        addPolicyIssue('Stock-family reference policies require source citations.', [
          'sourceRequirements',
          'sourceCitationIds',
        ]);
      }

      if (policy.allowedClaims.exactStockName || policy.allowedClaims.manufacturerEndorsement) {
        addPolicyIssue('Stock-family reference policies must not allow exact stock or endorsement claims.', [
          'allowedClaims',
        ]);
      }
    }

    if (policy.claimLevel === 'measured_project_profile') {
      if (policy.presetTier !== 'measured_project_profile') {
        addPolicyIssue('Measured project policies must use the measured-project tier.', ['presetTier']);
      }

      if (!policy.allowedClaims.measuredBehavior) {
        addPolicyIssue('Measured project policies must allow measured-behavior claims.', [
          'allowedClaims',
          'measuredBehavior',
        ]);
      }

      if (policy.sourceRequirements.fixtureIds.length === 0) {
        addPolicyIssue('Measured project policies require fixture IDs.', ['sourceRequirements', 'fixtureIds']);
      }
    }

    if (policy.claimLevel === 'licensed_exact_profile') {
      if (policy.presetTier !== 'licensed_profile') {
        addPolicyIssue('Licensed exact policies must use the licensed-profile tier.', ['presetTier']);
      }

      if (policy.legalNamingStatus !== 'approved_exact_stock_name') {
        addPolicyIssue('Licensed exact policies require approved exact-stock naming.', ['legalNamingStatus']);
      }

      if (policy.legalReviewStatus !== 'approved' || !hasLegalReviewRecord) {
        addPolicyIssue('Licensed exact policies require approved legal review metadata.', ['legalReviewStatus']);
      }

      if (policy.sourceRequirements.licenseRecordIds.length === 0) {
        addPolicyIssue('Licensed exact policies require license record IDs.', [
          'sourceRequirements',
          'licenseRecordIds',
        ]);
      }
    }

    if (policy.claimLevel === 'user_supplied_profile' && policy.presetTier !== 'user_profile') {
      addPolicyIssue('User supplied policies must use the user-profile tier.', ['presetTier']);
    }

    if (policy.claimLevel === 'blocked_or_unsupported') {
      if (policy.presetTier !== 'blocked' || policy.legalReviewStatus !== 'blocked') {
        addPolicyIssue('Blocked preset policies must use blocked tier and blocked review status.', ['presetTier']);
      }

      if (policy.allowedUiContexts.some((contextName) => contextName !== 'admin_review_queue')) {
        addPolicyIssue('Blocked preset policies may only appear in the admin review queue.', ['allowedUiContexts']);
      }
    }

    if (policy.allowedClaims.manufacturerEndorsement && policy.claimLevel !== 'licensed_exact_profile') {
      addPolicyIssue('Manufacturer endorsement claims require a licensed exact policy.', [
        'allowedClaims',
        'manufacturerEndorsement',
      ]);
    }

    if (policy.allowedClaims.officialProfile || policy.allowedClaims.competitorCompatibilityClaim) {
      addPolicyIssue(
        'Official-profile and competitor-compatibility claims are not allowed in RawEngine preset metadata.',
        ['allowedClaims'],
      );
    }
  });

export const negativeLabPresetMetadataPolicyCatalogV1Schema = z
  .object({
    catalogId: negativeLabPresetPolicyIdSchema,
    catalogVersion: z.string().trim().min(1),
    policies: z.array(negativeLabPresetMetadataPolicyV1Schema).min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((catalog, context) => {
    const policyIds = new Set<string>();
    const displayLabels = new Set<string>();

    for (const [index, policy] of catalog.policies.entries()) {
      const displayLabelKey = policy.displayCopy.label.toLocaleLowerCase('en-US');

      if (policyIds.has(policy.policyId)) {
        context.addIssue({
          code: 'custom',
          message: 'Preset metadata policy catalog must not contain duplicate policy IDs.',
          path: ['policies', index, 'policyId'],
        });
      }
      policyIds.add(policy.policyId);

      if (displayLabels.has(displayLabelKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Preset metadata policy catalog must not contain duplicate display labels.',
          path: ['policies', index, 'displayCopy', 'label'],
        });
      }
      displayLabels.add(displayLabelKey);
    }
  });

const contentHashSchema = z
  .string()
  .trim()
  .regex(/^sha256:[a-f0-9]{64}$/u);
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/u);
const negativeLabFixtureIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u);

export const negativeLabSampleGeometryV1Schema = z
  .object({
    coordinateSpace: z.enum(['source_asset_pixels', 'frame_pixels_after_crop', 'normalized_frame']),
    height: z.number().positive().optional(),
    kind: z.enum(['rect', 'polygon']),
    points: z.array(z.object({ x: z.number(), y: z.number() }).strict()).optional(),
    width: z.number().positive().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (geometry.kind === 'rect') {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (geometry[key] === undefined) {
          context.addIssue({
            code: 'custom',
            message: `Rect sample geometry requires ${key}.`,
            path: [key],
          });
        }
      }
    }

    if (geometry.kind === 'polygon' && (geometry.points === undefined || geometry.points.length < 3)) {
      context.addIssue({
        code: 'custom',
        message: 'Polygon sample geometry requires at least three points.',
        path: ['points'],
      });
    }
  });

export const negativeLabFixtureStateV1Schema = z.enum([
  'candidate',
  'review_pending',
  'approved_metadata_only',
  'approved_smoke',
  'approved_numeric',
  'approved_profile_measurement',
  'deprecated',
  'blocked',
]);

export const negativeLabFixtureTierV1Schema = z.enum([
  'synthetic_numeric',
  'synthetic_visual',
  'project_owned_scan',
  'permissive_public_scan',
  'licensed_scan',
  'local_private_scan',
  'registry_metadata_only',
]);

export const negativeLabFixtureRoleV1Schema = z.enum([
  'density_math_reference',
  'warning_stability',
  'ui_overlay_smoke',
  'roll_consistency',
  'profile_measurement',
  'stock_reference_mapping',
]);

export const negativeLabFixtureValidationUseV1Schema = z.enum([
  'schema_roundtrip',
  'ui_overlay_smoke',
  'density_math_reference',
  'warning_stability',
  'roll_consistency',
  'profile_measurement',
  'stock_reference_mapping',
  'marketing_screenshot',
]);

export const negativeLabFixtureDistributionV1Schema = z.enum([
  'none',
  'private_local_only',
  'private_ci_only',
  'public_repo',
  'release_artifact',
]);

export const negativeLabFixtureWarningCodeV1Schema = z.enum([
  'missing_fixture_license',
  'unknown_fixture_rights',
  'fixture_payload_not_public',
  'fixture_setup_unknown',
  'fixture_stock_unverified',
  'fixture_process_unverified',
  'fixture_auto_correction_unknown',
  'fixture_profile_claim_disallowed',
  'fixture_derivative_not_allowed',
  'fixture_review_expired',
]);

export const negativeLabFixtureSourceV1Schema = z
  .object({
    copyrightOwner: z.string().trim().min(1),
    licenseName: z.string().trim().min(1).optional(),
    licenseUrl: z.url().optional(),
    redistributionEvidence: z.string().trim().min(1).optional(),
    sourceKind: z.enum([
      'project_owned',
      'generated_synthetic',
      'permissive_public',
      'licensed_third_party',
      'local_private',
      'registry_metadata_only',
    ]),
    sourceUrl: z.url().optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      ['permissive_public', 'licensed_third_party'].includes(source.sourceKind) &&
      (source.sourceUrl === undefined ||
        source.licenseName === undefined ||
        source.redistributionEvidence === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Public or licensed fixture sources require a source URL, license name, and redistribution evidence.',
        path: ['sourceUrl'],
      });
    }
  });

export const negativeLabFixtureManifestEntryV1Schema = z
  .object({
    allowedDistribution: negativeLabFixtureDistributionV1Schema,
    allowedValidationUses: z.array(negativeLabFixtureValidationUseV1Schema),
    autoCorrectionBakedIn: z.enum(['known_absent', 'known_present', 'unknown']),
    baseFogSampleRegions: z.array(negativeLabSampleGeometryV1Schema),
    bitDepth: z.number().int().positive(),
    captureProfile: z.string().trim().min(1),
    colorProfile: z.string().trim().min(1),
    contentHash: contentHashSchema.optional(),
    derivativeDistributionAllowed: z.boolean(),
    developmentNotes: z.string().trim().min(1),
    developmentProcessKnown: z.boolean(),
    disallowedValidationUses: z.array(negativeLabFixtureValidationUseV1Schema),
    expectedFixtureWarningCodes: z.array(negativeLabFixtureWarningCodeV1Schema),
    expectedNegativeWarningCodes: z.array(negativeWarningCodeSchema),
    fileFormat: z.enum(['raw', 'dng', 'tiff', 'jpeg', 'png', 'json', 'synthetic_generated']),
    filmStockDisplayName: z.string().trim().min(1),
    filmStockKnown: z.boolean(),
    filmStockSource: z.string().trim().min(1),
    fixtureId: negativeLabFixtureIdSchema,
    fixtureRole: negativeLabFixtureRoleV1Schema,
    frameFormat: z.string().trim().min(1),
    generatorId: z.string().trim().min(1).optional(),
    lens: z.string().trim().min(1),
    lightSource: z.string().trim().min(1),
    lossyCompression: z.boolean(),
    measurementClaimAllowed: z.boolean(),
    negativeFixtureTier: negativeLabFixtureTierV1Schema,
    payloadAccess: z.enum([
      'metadata_only',
      'generated_in_repo',
      'committed_public_payload',
      'private_ci_payload',
      'local_only_payload',
    ]),
    processFamily: negativeProcessFamilySchema,
    profileClaimAllowed: z.boolean(),
    rejectedSampleRegions: z.array(negativeLabSampleGeometryV1Schema),
    reviewIssue: z.string().trim().min(1).optional(),
    reviewedAt: isoDateSchema.optional(),
    reviewer: z.string().trim().min(1).optional(),
    rollOrSheetIdentifier: z.string().trim().min(1),
    scanInputMode: negativeInputModeSchema,
    scannerOrCamera: z.string().trim().min(1),
    scannerSoftware: z.string().trim().min(1),
    scannerSoftwareSettingsKnown: z.boolean(),
    source: negativeLabFixtureSourceV1Schema,
    state: negativeLabFixtureStateV1Schema,
    targetOrStepWedgePresent: z.boolean(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const approvedStates = [
      'approved_metadata_only',
      'approved_smoke',
      'approved_numeric',
      'approved_profile_measurement',
    ];
    if (approvedStates.includes(fixture.state)) {
      for (const key of ['reviewIssue', 'reviewedAt', 'reviewer'] as const) {
        if (fixture[key] === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'Approved negative-lab fixtures require review issue, reviewer, and review date.',
            path: [key],
          });
        }
      }
    }

    if (
      fixture.allowedDistribution === 'public_repo' &&
      (!fixture.derivativeDistributionAllowed || fixture.contentHash === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Public fixture distribution requires derivative rights and a content hash.',
        path: ['allowedDistribution'],
      });
    }

    if (
      fixture.payloadAccess === 'committed_public_payload' &&
      (fixture.allowedDistribution !== 'public_repo' || fixture.contentHash === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Committed public fixture payloads require public distribution rights and a content hash.',
        path: ['payloadAccess'],
      });
    }

    if (fixture.scanInputMode === 'lab_jpeg') {
      for (const warningCode of ['lossy_input', 'low_acquisition_confidence'] as const) {
        if (!fixture.expectedNegativeWarningCodes.includes(warningCode)) {
          context.addIssue({
            code: 'custom',
            message: 'Lab JPEG fixtures must declare lossy-input and low-confidence expected warnings.',
            path: ['expectedNegativeWarningCodes'],
          });
        }
      }
    }

    if (fixture.allowedValidationUses.includes('profile_measurement')) {
      const profileEligibleTier = ['project_owned_scan', 'licensed_scan'].includes(fixture.negativeFixtureTier);
      if (
        fixture.state !== 'approved_profile_measurement' ||
        !profileEligibleTier ||
        !fixture.targetOrStepWedgePresent ||
        !fixture.measurementClaimAllowed ||
        !fixture.profileClaimAllowed
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Profile measurement fixtures require approved measured state, eligible source tier, target data, and claim approval.',
          path: ['allowedValidationUses'],
        });
      }
    }

    for (const validationUse of fixture.allowedValidationUses) {
      if (fixture.disallowedValidationUses.includes(validationUse)) {
        context.addIssue({
          code: 'custom',
          message: 'Fixture validation uses cannot be both allowed and disallowed.',
          path: ['allowedValidationUses'],
        });
      }
    }
  });

export const negativeLabFixtureManifestV1Schema = z
  .object({
    entries: z.array(negativeLabFixtureManifestEntryV1Schema).min(1),
    manifestId: z.string().trim().min(1),
    manifestVersion: z.string().trim().min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = new Set<string>();
    for (const [index, fixture] of manifest.entries.entries()) {
      if (fixtureIds.has(fixture.fixtureId)) {
        context.addIssue({
          code: 'custom',
          message: 'Negative-lab fixture manifests must not contain duplicate fixture IDs.',
          path: ['entries', index, 'fixtureId'],
        });
      }
      fixtureIds.add(fixture.fixtureId);
    }
  });

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

export const negativeLabInputProfileKindV1Schema = z.enum([
  'camera_raw_input',
  'camera_scan_input',
  'scanner_input',
  'lab_rendered_input',
  'manual_assumption',
]);

export const negativeLabInputProfileSourceV1Schema = z.enum([
  'embedded_icc',
  'camera_dcp',
  'scanner_icc',
  'raw_decoder_camera_profile',
  'user_assigned_icc',
  'generated_synthetic_profile',
  'assumed_display_profile',
  'unknown',
]);

export const negativeLabInputProfileV1Schema = z
  .object({
    acquisitionConfidence: negativeAcquisitionConfidenceSchema,
    captureDeviceType: z.enum(['camera', 'flatbed_scanner', 'film_scanner', 'lab_scanner', 'unknown']),
    colorSpaceEncoding: z.enum([
      'camera_raw_native',
      'linear_rgb',
      'scanner_rgb',
      'lab_rendered_rgb',
      'display_referred_rgb',
      'unknown',
    ]),
    defaultInputMode: negativeInputModeSchema,
    description: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    expectedPixelBasis: negativePixelBasisSchema,
    fileExtensions: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z0-9]+$/u),
      )
      .min(1),
    inputProfileKind: negativeLabInputProfileKindV1Schema,
    inputProfileSource: negativeLabInputProfileSourceV1Schema,
    profileConfidence: negativeAcquisitionConfidenceSchema,
    profileId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[0-9]+$/u),
    profileVersion: z.string().trim().min(1),
    provenance: z
      .object({
        contentHash: z.string().trim().min(1).optional(),
        legalNote: z.string().trim().min(1),
        sourceDescription: z.string().trim().min(1),
      })
      .strict(),
    requiredWarningCodes: z.array(negativeWarningCodeSchema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    supportedInputModes: z.array(negativeInputModeSchema).min(1),
    supportedProcessFamilies: z.array(negativeLabSupportedProcessFamilyV1Schema).min(1),
  })
  .strict()
  .superRefine((profile, context) => {
    if (!profile.supportedInputModes.includes(profile.defaultInputMode)) {
      context.addIssue({
        code: 'custom',
        message: 'Default input mode must be included in supported input modes.',
        path: ['defaultInputMode'],
      });
    }

    if (
      profile.inputProfileKind === 'camera_raw_input' &&
      (profile.defaultInputMode !== 'camera_raw' || profile.colorSpaceEncoding === 'display_referred_rgb')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Camera raw input profiles must default to camera_raw and must not be display-referred.',
        path: ['inputProfileKind'],
      });
    }

    if (profile.inputProfileKind === 'lab_rendered_input') {
      const requiredWarnings = ['lossy_input', 'low_acquisition_confidence'] as const;
      for (const warningCode of requiredWarnings) {
        if (!profile.requiredWarningCodes.includes(warningCode)) {
          context.addIssue({
            code: 'custom',
            message: 'Lab-rendered input profiles must require lossy-input and confidence warnings.',
            path: ['requiredWarningCodes'],
          });
        }
      }
    }

    if (
      profile.profileConfidence === 'high' &&
      ['assumed_display_profile', 'unknown'].includes(profile.inputProfileSource)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'High-confidence input profiles require explicit profile source metadata.',
        path: ['inputProfileSource'],
      });
    }
  });

export const negativeLabInputProfileCatalogV1Schema = z
  .object({
    catalogId: z.string().trim().min(1),
    catalogVersion: z.string().trim().min(1),
    profiles: z.array(negativeLabInputProfileV1Schema).min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((catalog, context) => {
    const profileIds = new Set<string>();
    const displayNames = new Set<string>();
    for (const [index, profile] of catalog.profiles.entries()) {
      if (profileIds.has(profile.profileId)) {
        context.addIssue({
          code: 'custom',
          message: 'Input profile catalog must not contain duplicate profile IDs.',
          path: ['profiles', index, 'profileId'],
        });
      }
      profileIds.add(profile.profileId);

      const displayNameKey = profile.displayName.toLocaleLowerCase('en-US');
      if (displayNames.has(displayNameKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Input profile catalog must not contain duplicate display names.',
          path: ['profiles', index, 'displayName'],
        });
      }
      displayNames.add(displayNameKey);
    }
  });

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

export const NEGATIVE_LAB_COMMAND_TYPES = [
  'negativeLab.createSession',
  'negativeLab.updateBaseSamples',
  'negativeLab.estimateBaseFog',
  'negativeLab.setConversionRecipe',
  'negativeLab.planRollNormalization',
  'negativeLab.createPositiveVariant',
  'negativeLab.setFrameQcStatus',
  'negativeLab.applyFrameCrop',
] as const;

export const negativeLabCommandTypeSchema = z.enum(NEGATIVE_LAB_COMMAND_TYPES);

const negativeLabFrameQcStatusSchema = z.enum([
  'needs_review',
  'approved',
  'approved_with_warnings',
  'rejected',
  'excluded_from_export',
]);

export const negativeLabOperationStageSchema = z.enum([
  'acquisition',
  'calibration',
  'objective_inversion',
  'semi_objective_normalization',
  'creative_rendering',
  'quality_control',
]);

export const negativeLabFrameSelectionV1Schema = z
  .object({
    excludeFrameIds: z.array(z.string().trim().min(1)),
    frameIds: z.array(z.string().trim().min(1)),
    mode: z.enum(['all', 'selected', 'by_warning', 'by_qc_state']),
    qcStatuses: z.array(negativeLabFrameQcStatusSchema),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabSourceAssetRefV1Schema = z
  .object({
    contentHash: z.string().trim().min(1).optional(),
    fileRole: z.enum(['negative_scan', 'contact_sheet', 'calibration_target', 'reference']),
    originalPathRedacted: z.boolean(),
    sourceFileId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabFrameDetectionRequestV1Schema = z
  .object({
    borderPolicy: z.enum(['require_visible_border', 'prefer_visible_border', 'allow_cropped']),
    contactSheetHandling: z.enum(['defer', 'suggest_frames']),
    detectionSensitivity: z.enum(['conservative', 'balanced', 'aggressive']),
    mode: z.enum(['none', 'suggest_only', 'manual_seed']),
    preserveOriginalOrientation: z.boolean(),
  })
  .strict();

export const negativeLabDetectedFrameCropV1Schema = z
  .object({
    height: z.number().positive(),
    rotationDegrees: z.number(),
    width: z.number().positive(),
    x: z.number().min(0),
    y: z.number().min(0),
  })
  .strict();

export const negativeLabFrameBorderMetricsV1Schema = z
  .object({
    borderConfidence: negativeAcquisitionConfidenceSchema,
    borderState: z.enum(['visible', 'partial', 'cropped', 'unknown']),
    rebateTextDetected: z.boolean(),
    sprocketHoleDetected: z.boolean(),
    visibleBorderPx: z
      .object({
        bottom: z.number().min(0),
        left: z.number().min(0),
        right: z.number().min(0),
        top: z.number().min(0),
      })
      .strict(),
  })
  .strict();

export const negativeLabDetectedFrameV1Schema = z
  .object({
    borderMetrics: negativeLabFrameBorderMetricsV1Schema,
    contentHash: z.string().trim().min(1).optional(),
    crop: negativeLabDetectedFrameCropV1Schema,
    detectionConfidence: negativeAcquisitionConfidenceSchema,
    frameId: z.string().trim().min(1),
    frameIndex: z.number().int().nonnegative(),
    needsManualReview: z.boolean(),
    sourceFileId: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabRejectedFrameCandidateV1Schema = z
  .object({
    candidateId: z.string().trim().min(1),
    crop: negativeLabDetectedFrameCropV1Schema,
    reason: z.enum(['too_small', 'overlap_duplicate', 'low_edge_confidence', 'manual_rejected']),
    sourceFileId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabFrameDetectionResultV1Schema = z
  .object({
    algorithm: z
      .object({
        algorithmId: z.literal('frame_split_border_detect_v1'),
        algorithmVersion: z.literal(1),
        deterministicSeed: z.number().int().nonnegative().optional(),
      })
      .strict(),
    detectedFrames: z.array(negativeLabDetectedFrameV1Schema).min(1),
    detectionRunId: z.string().trim().min(1),
    inputRequest: negativeLabFrameDetectionRequestV1Schema,
    rejectedCandidates: z.array(negativeLabRejectedFrameCandidateV1Schema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1).optional(),
    sourceFileIds: z.array(z.string().trim().min(1)).min(1),
    warnings: z.array(negativeWarningV1Schema),
  })
  .strict()
  .superRefine((result, context) => {
    const seenFrameIds = new Set<string>();
    for (const [index, frame] of result.detectedFrames.entries()) {
      if (seenFrameIds.has(frame.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Detected frame IDs must be unique within a detection result.',
          path: ['detectedFrames', index, 'frameId'],
        });
      }
      seenFrameIds.add(frame.frameId);

      if (!result.sourceFileIds.includes(frame.sourceFileId)) {
        context.addIssue({
          code: 'custom',
          message: 'Detected frame sourceFileId must be listed in sourceFileIds.',
          path: ['detectedFrames', index, 'sourceFileId'],
        });
      }
    }
  });

export const negativeLabQcOverlayKindSchema = z.enum([
  'frame_boundary',
  'base_sample',
  'clipping',
  'density_sample',
  'warning_badge',
  'roll_consistency_delta',
]);

export const negativeLabQcOverlayV1Schema = z
  .object({
    frameId: z.string().trim().min(1),
    geometry: negativeLabSampleGeometryV1Schema,
    label: z.string().trim().min(1),
    overlayId: z.string().trim().min(1),
    overlayKind: negativeLabQcOverlayKindSchema,
    severity: negativeWarningSeveritySchema,
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabRollConsistencyFrameMetricV1Schema = z
  .object({
    densityDelta: z.number().min(0),
    exposureDeltaEv: z.number(),
    frameId: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
    whiteBalanceDelta: z.number().min(0),
    withinTolerance: z.boolean(),
  })
  .strict();

export const negativeLabRollConsistencyMetricsV1Schema = z
  .object({
    anchorFrameIds: nonEmptyIdArraySchema,
    densityDeltaTolerance: z.number().min(0),
    exposureDeltaToleranceEv: z.number().min(0),
    frameMetrics: z.array(negativeLabRollConsistencyFrameMetricV1Schema).min(1),
    metricVersion: z.literal(1),
    whiteBalanceDeltaTolerance: z.number().min(0),
  })
  .strict()
  .superRefine((metrics, context) => {
    const seenFrameIds = new Set<string>();
    for (const [index, metric] of metrics.frameMetrics.entries()) {
      if (seenFrameIds.has(metric.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll consistency frame metrics must use unique frame IDs.',
          path: ['frameMetrics', index, 'frameId'],
        });
      }
      seenFrameIds.add(metric.frameId);
    }
  });

export const negativeLabRollBatchWorkflowStageV1Schema = z.enum([
  'frame_detection_review',
  'base_fog_sampling',
  'conversion_recipe',
  'roll_normalization',
  'positive_variant_creation',
  'qc_review',
]);

export const negativeLabRollBatchWorkflowStagePlanV1Schema = z
  .object({
    commandIds: z.array(z.string().trim().min(1)),
    commandType: negativeLabCommandTypeSchema.optional(),
    dryRunPlanIds: z.array(z.string().trim().min(1)),
    requiredBeforeStages: z.array(negativeLabRollBatchWorkflowStageV1Schema),
    stage: negativeLabRollBatchWorkflowStageV1Schema,
    status: z.enum(['planned', 'dry_run_ready', 'applied', 'blocked']),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabRollBatchWorkflowV1Schema = z
  .object({
    anchorFrameIds: nonEmptyIdArraySchema,
    batchPolicy: z
      .object({
        autoApplyEligible: z.boolean(),
        baseStrategy: z.enum(['roll_shared_base', 'anchor_frame_base', 'per_frame_base']),
        includeRejectedFrames: z.boolean(),
        maxPerFrameExposureDeltaEv: z.number().nonnegative(),
        maxWhiteBalanceDelta: z.number().nonnegative(),
        normalizationMode: z.enum(['exposure_only', 'white_balance_only', 'density_and_balance']),
        preserveCreativeAdjustments: z.boolean(),
      })
      .strict(),
    expectedArtifactPurposes: z.array(
      z.enum([
        'objective_positive_preview',
        'density_map',
        'base_sample_overlay',
        'clipping_overlay',
        'warning_report',
        'parameter_diff',
        'qc_contact_sheet',
      ]),
    ),
    frameSelection: negativeLabFrameSelectionV1Schema,
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    qcProofId: z.string().trim().min(1).optional(),
    rollConsistencyPreview: negativeLabRollConsistencyMetricsV1Schema,
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1),
    stagePlans: z.array(negativeLabRollBatchWorkflowStagePlanV1Schema).min(1),
    workflowId: z.string().trim().min(1),
    workflowVersion: z.string().trim().min(1),
  })
  .strict()
  .superRefine((workflow, context) => {
    const selectedFrameIds =
      workflow.frameSelection.mode === 'selected' ? new Set(workflow.frameSelection.frameIds) : undefined;
    const seenStages = new Set<z.infer<typeof negativeLabRollBatchWorkflowStageV1Schema>>();

    if (workflow.batchPolicy.includeRejectedFrames) {
      context.addIssue({
        code: 'custom',
        message: 'Roll batch workflows must not include rejected frames.',
        path: ['batchPolicy', 'includeRejectedFrames'],
      });
    }

    for (const [index, anchorFrameId] of workflow.anchorFrameIds.entries()) {
      if (selectedFrameIds !== undefined && !selectedFrameIds.has(anchorFrameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll batch anchor frames must be included in the selected frame set.',
          path: ['anchorFrameIds', index],
        });
      }
    }

    for (const [index, metric] of workflow.rollConsistencyPreview.frameMetrics.entries()) {
      if (selectedFrameIds !== undefined && !selectedFrameIds.has(metric.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll consistency preview metrics must be included in the selected frame set.',
          path: ['rollConsistencyPreview', 'frameMetrics', index, 'frameId'],
        });
      }
    }

    for (const [index, stagePlan] of workflow.stagePlans.entries()) {
      if (seenStages.has(stagePlan.stage)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll batch workflow stages must be unique.',
          path: ['stagePlans', index, 'stage'],
        });
      }
      seenStages.add(stagePlan.stage);

      if (stagePlan.status === 'applied' && stagePlan.commandIds.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Applied roll batch workflow stages require command IDs.',
          path: ['stagePlans', index, 'commandIds'],
        });
      }

      if (stagePlan.status === 'dry_run_ready' && stagePlan.dryRunPlanIds.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Dry-run-ready roll batch workflow stages require dry-run plan IDs.',
          path: ['stagePlans', index, 'dryRunPlanIds'],
        });
      }

      if (stagePlan.commandType !== undefined && !stagePlan.commandIds.every((commandId) => commandId.length > 0)) {
        context.addIssue({
          code: 'custom',
          message: 'Command-backed roll batch workflow stages require non-empty command IDs.',
          path: ['stagePlans', index, 'commandIds'],
        });
      }
    }

    const stageSet = new Set(workflow.stagePlans.map((stagePlan) => stagePlan.stage));
    for (const requiredStage of [
      'base_fog_sampling',
      'conversion_recipe',
      'roll_normalization',
      'qc_review',
    ] as const) {
      if (!stageSet.has(requiredStage)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll batch workflow is missing a required consistency stage.',
          path: ['stagePlans'],
        });
      }
    }

    if (workflow.qcProofId !== undefined && !stageSet.has('qc_review')) {
      context.addIssue({
        code: 'custom',
        message: 'Roll batch workflows with a QC proof must include the QC review stage.',
        path: ['qcProofId'],
      });
    }
  });

export const negativeLabQcProofArtifactV1Schema = z
  .object({
    contactSheet: z
      .object({
        artifact: artifactHandleV1Schema,
        columns: z.number().int().positive(),
        rows: z.number().int().positive(),
      })
      .strict(),
    frameIds: z.array(z.string().trim().min(1)).min(1),
    generatedAt: z.string().trim().min(1),
    overlays: z.array(negativeLabQcOverlayV1Schema),
    proofId: z.string().trim().min(1),
    rollConsistency: negativeLabRollConsistencyMetricsV1Schema,
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1),
    warnings: z.array(negativeWarningV1Schema),
  })
  .strict()
  .superRefine((proof, context) => {
    const frameIds = new Set(proof.frameIds);
    if (frameIds.size !== proof.frameIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'QC proof frameIds must be unique.',
        path: ['frameIds'],
      });
    }

    for (const [index, overlay] of proof.overlays.entries()) {
      if (!frameIds.has(overlay.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'QC overlay frameId must be included in proof frameIds.',
          path: ['overlays', index, 'frameId'],
        });
      }
    }

    for (const [index, metric] of proof.rollConsistency.frameMetrics.entries()) {
      if (!frameIds.has(metric.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Roll consistency metric frameId must be included in proof frameIds.',
          path: ['rollConsistency', 'frameMetrics', index, 'frameId'],
        });
      }
    }
  });

export const negativeLabBaseSampleRegionV1Schema = z
  .object({
    frameId: z.string().trim().min(1),
    geometry: negativeLabSampleGeometryV1Schema,
    regionId: z.string().trim().min(1).optional(),
    role: z.enum(['base_fog', 'rebate', 'leader', 'manual_neutral_reference']),
  })
  .strict();

export const negativeLabPreviewRequestV1Schema = z
  .object({
    artifactPurposes: z.array(
      z.enum([
        'objective_positive_preview',
        'density_map',
        'base_sample_overlay',
        'clipping_overlay',
        'warning_report',
        'parameter_diff',
      ]),
    ),
    includePreview: z.boolean(),
    maxEdgePx: z.number().int().positive().optional(),
  })
  .strict();

export const negativeLabOutputTransformRefV1Schema = z
  .object({
    chromaticAdaptation: z.enum(['bradford', 'cat16', 'none_declared']).optional(),
    renderingIntent: z.enum(['scene_referred', 'relative_colorimetric', 'perceptual']).optional(),
    transformId: z.enum([
      'rawengine_scene_linear_v1',
      'linear_rec2020_d65_v1',
      'acescg_ap1_d60_v1',
      'linear_prophoto_rgb_d50_v1',
    ]),
  })
  .strict();

export const negativeLabCreateSessionParametersV1Schema = z
  .object({
    acquisitionProfileId: z.string().trim().min(1).optional(),
    frameDetectionRequest: negativeLabFrameDetectionRequestV1Schema,
    inputMode: negativeInputModeSchema,
    notes: z.string().trim().min(1).optional(),
    pixelBasis: negativePixelBasisSchema,
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    sessionKind: z.enum(['single_frame', 'roll', 'contact_sheet']),
    sourceAssets: z.array(negativeLabSourceAssetRefV1Schema).min(1),
  })
  .strict();

export const negativeLabUpdateBaseSamplesParametersV1Schema = z
  .object({
    frameSelection: negativeLabFrameSelectionV1Schema,
    rejectionReason: z.enum(['dust', 'rebate_text', 'sprocket', 'scratch', 'light_leak', 'manual']).optional(),
    sampleEditMode: z.enum(['add', 'replace', 'accept', 'reject', 'remove']),
    sampleRegions: z.array(negativeLabBaseSampleRegionV1Schema).min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabEstimateBaseFogParametersV1Schema = z
  .object({
    estimator: z
      .object({
        algorithmId: z.literal('base_fog_scalar_rgb_v1'),
        outlierPolicy: z.enum(['mad_v1', 'none']),
        scope: z.enum(['frame', 'roll', 'selected_frames']),
        sourceSampleIds: nonEmptyIdArraySchema,
        statistic: z.enum(['median', 'trimmed_mean']),
      })
      .strict(),
    frameSelection: negativeLabFrameSelectionV1Schema,
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabSetConversionRecipeParametersV1Schema = z
  .object({
    baseStrategy: z
      .object({
        baseEstimateId: z.string().trim().min(1).optional(),
        baseSampleIds: z.array(z.string().trim().min(1)),
        mode: z.enum(['existing_base_estimate', 'manual_samples', 'roll_shared', 'profile_default_low_confidence']),
      })
      .strict(),
    conversionModel: z
      .object({
        algorithmId: z.literal('density_rgb_v1'),
        algorithmVersion: z.literal(1),
        densityMax: z.number().positive(),
        epsilonPolicyId: z.literal('density_epsilon_v1'),
        negativeDensityTolerance: z.number().nonnegative(),
      })
      .strict(),
    curveModel: z
      .object({
        curveFamily: z.enum(['process_profile_monotonic_v1', 'parametric_monotonic_v1']),
        normalizationProfileId: z.string().trim().min(1).optional(),
        normalizationProfileVersion: z.string().trim().min(1).optional(),
        processProfileId: z.string().trim().min(1).optional(),
        processProfileVersion: z.string().trim().min(1).optional(),
      })
      .strict(),
    frameSelection: negativeLabFrameSelectionV1Schema,
    inputCharacterization: z
      .object({
        channelBasis: z.enum(['camera_rgb', 'scanner_rgb', 'rendered_rgb', 'unknown']),
        confidence: z.enum([
          'declared_linear_scan_rgb',
          'profiled_acquisition',
          'approximate_rendered_rgb',
          'low_confidence',
        ]),
        pixelBasis: z.literal('linear_scan_rgb'),
      })
      .strict(),
    neutralization: z
      .object({
        mode: z.enum(['none', 'neutral_sample', 'skin_sample', 'manual_rgb_balance']),
        sampleIds: z.array(z.string().trim().min(1)),
      })
      .strict(),
    outputIntent: z.enum(['editable_positive', 'proof_preview', 'export_ready_preview']),
    outputTransformRef: negativeLabOutputTransformRefV1Schema.optional(),
    previewRequest: negativeLabPreviewRequestV1Schema,
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabPlanRollNormalizationParametersV1Schema = z
  .object({
    anchorFrameIds: nonEmptyIdArraySchema,
    frameSelection: negativeLabFrameSelectionV1Schema,
    normalizationMode: z.enum(['exposure_only', 'white_balance_only', 'density_and_balance']),
    normalizationProfileId: z.string().trim().min(1).optional(),
    normalizationProfileVersion: z.string().trim().min(1).optional(),
    previewRequest: negativeLabPreviewRequestV1Schema,
    preserveCreativeAdjustments: z.boolean(),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabCreatePositiveVariantParametersV1Schema = z
  .object({
    conversionRecipeId: z.string().trim().min(1),
    frameSelection: negativeLabFrameSelectionV1Schema,
    inheritRollDefaults: z.boolean(),
    onNameConflict: z.enum(['fail', 'create_unique']),
    outputTransformRef: negativeLabOutputTransformRefV1Schema,
    positiveVariantName: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1),
    variantNameSource: z.enum(['user_supplied', 'generated_generic']),
  })
  .strict();

export const negativeLabSetFrameQcStatusParametersV1Schema = z
  .object({
    acknowledgedWarningCodes: z.array(negativeWarningCodeSchema),
    frameId: z.string().trim().min(1),
    notes: z.string().trim().min(1).optional(),
    qcStatus: negativeLabFrameQcStatusSchema,
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabFrameCropEditV1Schema = z
  .object({
    borderConfidence: negativeAcquisitionConfidenceSchema,
    borderState: z.enum(['visible', 'partial', 'cropped', 'unknown']),
    crop: negativeLabDetectedFrameCropV1Schema,
    cropSource: z.enum(['detected_frame', 'manual_override', 'imported_metadata']),
    detectionFrameId: z.string().trim().min(1).optional(),
    editMode: z.enum(['accept_detected', 'manual_override', 'reject_detected']),
    frameId: z.string().trim().min(1),
    notes: z.string().trim().min(1).optional(),
    sourceFileId: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict()
  .superRefine((edit, context) => {
    if (edit.editMode === 'accept_detected' && edit.cropSource !== 'detected_frame') {
      context.addIssue({
        code: 'custom',
        message: 'Accepted detected crops must use detected-frame crop source.',
        path: ['cropSource'],
      });
    }

    if (edit.editMode === 'manual_override' && edit.cropSource === 'detected_frame') {
      context.addIssue({
        code: 'custom',
        message: 'Manual crop overrides must not be recorded as detected-frame crops.',
        path: ['cropSource'],
      });
    }

    if (edit.editMode === 'reject_detected' && edit.notes === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Rejected detected crops require notes for review provenance.',
        path: ['notes'],
      });
    }

    if (edit.cropSource === 'detected_frame' && edit.detectionFrameId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Detected-frame crop edits require the source detection frame ID.',
        path: ['detectionFrameId'],
      });
    }
  });

export const negativeLabApplyFrameCropParametersV1Schema = z
  .object({
    cropEdits: z.array(negativeLabFrameCropEditV1Schema).min(1),
    detectionRunId: z.string().trim().min(1).optional(),
    frameSelection: negativeLabFrameSelectionV1Schema,
    sessionId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((parameters, context) => {
    const frameIds = new Set<string>();
    for (const [index, edit] of parameters.cropEdits.entries()) {
      if (frameIds.has(edit.frameId)) {
        context.addIssue({
          code: 'custom',
          message: 'Frame crop commands must not contain duplicate frame IDs.',
          path: ['cropEdits', index, 'frameId'],
        });
      }
      frameIds.add(edit.frameId);

      if (edit.cropSource === 'detected_frame' && parameters.detectionRunId === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Detected-frame crop edits require a detectionRunId on the command.',
          path: ['detectionRunId'],
        });
      }
    }
  });

export const negativeLabApplyPlanRequestV1Schema = z
  .object({
    acknowledgedWarningCodes: z.array(negativeWarningCodeSchema),
    commandId: z.string().trim().min(1),
    dryRunPlanId: z.string().trim().min(1),
    expectedSessionRevision: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const negativeLabCreateSessionCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.createSession'),
    parameters: negativeLabCreateSessionParametersV1Schema,
  })
  .strict();

export const negativeLabUpdateBaseSamplesCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.updateBaseSamples'),
    parameters: negativeLabUpdateBaseSamplesParametersV1Schema,
  })
  .strict();

export const negativeLabEstimateBaseFogCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.estimateBaseFog'),
    parameters: negativeLabEstimateBaseFogParametersV1Schema,
  })
  .strict();

export const negativeLabSetConversionRecipeCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.setConversionRecipe'),
    parameters: negativeLabSetConversionRecipeParametersV1Schema,
  })
  .strict();

export const negativeLabPlanRollNormalizationCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.planRollNormalization'),
    parameters: negativeLabPlanRollNormalizationParametersV1Schema,
  })
  .strict();

export const negativeLabCreatePositiveVariantCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.createPositiveVariant'),
    parameters: negativeLabCreatePositiveVariantParametersV1Schema,
  })
  .strict();

export const negativeLabSetFrameQcStatusCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.setFrameQcStatus'),
    parameters: negativeLabSetFrameQcStatusParametersV1Schema,
  })
  .strict();

export const negativeLabApplyFrameCropCommandV1Schema = commandEnvelopeV1Schema
  .extend({
    commandType: z.literal('negativeLab.applyFrameCrop'),
    parameters: negativeLabApplyFrameCropParametersV1Schema,
  })
  .strict();

export const negativeLabCommandEnvelopeV1Schema = z.discriminatedUnion('commandType', [
  negativeLabCreateSessionCommandV1Schema,
  negativeLabUpdateBaseSamplesCommandV1Schema,
  negativeLabEstimateBaseFogCommandV1Schema,
  negativeLabSetConversionRecipeCommandV1Schema,
  negativeLabPlanRollNormalizationCommandV1Schema,
  negativeLabCreatePositiveVariantCommandV1Schema,
  negativeLabSetFrameQcStatusCommandV1Schema,
  negativeLabApplyFrameCropCommandV1Schema,
]);

export const negativeLabChangeSetV1Schema = z
  .object({
    artifactHandles: z.array(artifactHandleV1Schema),
    createdPositiveVariantIds: z.array(z.string().trim().min(1)),
    provenanceEntryIds: z.array(z.string().trim().min(1)),
    updatedFrameIds: z.array(z.string().trim().min(1)),
    updatedSessionId: z.string().trim().min(1),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabDryRunResultV1Schema = z
  .object({
    changeSet: negativeLabChangeSetV1Schema,
    dryRunPlanId: z.string().trim().min(1),
    commandId: z.string().trim().min(1),
    commandType: negativeLabCommandTypeSchema,
    correlationId: z.string().trim().min(1),
    numericMetrics: z.record(z.string(), z.number()),
    previewArtifacts: z.array(artifactHandleV1Schema),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    warnings: z.array(negativeWarningV1Schema),
  })
  .strict();

export const negativeLabApplyResultV1Schema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    changeSet: negativeLabChangeSetV1Schema,
    commandId: z.string().trim().min(1),
    commandType: negativeLabCommandTypeSchema,
    correlationId: z.string().trim().min(1),
    dryRunCommandId: z.string().trim().min(1).optional(),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sessionId: z.string().trim().min(1),
    warnings: z.array(negativeWarningV1Schema),
  })
  .strict();

export const negativeLabPositiveVariantProvenanceV1Schema = z
  .object({
    acknowledgedWarningCodes: z.array(negativeWarningCodeSchema),
    acquisitionProfileId: z.string().trim().min(1),
    applyCommandId: z.string().trim().min(1),
    baseSampleIds: nonEmptyIdArraySchema,
    conversionCommandId: z.string().trim().min(1),
    conversionRecipeId: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    createdBy: rawEngineActorSchema,
    dryRunPlanId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    inheritedRollDefaults: z.boolean(),
    outputIntent: z.enum(['editable_positive', 'proof_preview', 'export_ready_preview']),
    outputTransformRef: negativeLabOutputTransformRefV1Schema,
    positiveVariantId: z.string().trim().min(1),
    previewArtifactHandles: z.array(artifactHandleV1Schema),
    processFamily: negativeLabSupportedProcessFamilyV1Schema,
    provenanceEntryIds: nonEmptyIdArraySchema,
    rollSessionId: z.string().trim().min(1),
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    sourceContentHash: z.string().trim().min(1),
    sourceFileId: z.string().trim().min(1),
    sourceFrameId: z.string().trim().min(1),
    variantName: z.string().trim().min(1),
    variantNameSource: z.enum(['user_supplied', 'generated_generic']),
    warningCodes: z.array(negativeWarningCodeSchema),
  })
  .strict();

export const negativeLabAppServerExecutionModeSchema = z.enum(['dry_run_command', 'apply_dry_run_plan']);

export const negativeLabAppServerAuditEventSchema = z.enum([
  'negative_lab_dry_run_requested',
  'negative_lab_dry_run_completed',
  'negative_lab_apply_requested',
  'negative_lab_apply_completed',
]);

export const negativeLabAppServerToolDefinitionV1Schema = z
  .object({
    allowedCommandTypes: z.array(negativeLabCommandTypeSchema).min(1),
    approvalClass: approvalClassSchema,
    auditEvents: z.array(negativeLabAppServerAuditEventSchema).min(1),
    description: z.string().trim().min(1),
    executionMode: negativeLabAppServerExecutionModeSchema,
    inputSchemaName: z.string().trim().min(1),
    localOnly: z.boolean(),
    mutates: z.boolean(),
    outputSchemaName: z.string().trim().min(1),
    requiresDryRunPlan: z.boolean(),
    returnsArtifactHandles: z.boolean(),
    toolName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u),
  })
  .strict()
  .superRefine((tool, context) => {
    if (tool.executionMode === 'dry_run_command') {
      if (tool.inputSchemaName !== 'NegativeLabCommandEnvelopeV1') {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab dry-run app-server tools must accept NegativeLabCommandEnvelopeV1.',
          path: ['inputSchemaName'],
        });
      }

      if (tool.outputSchemaName !== 'NegativeLabDryRunResultV1') {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab dry-run app-server tools must return NegativeLabDryRunResultV1.',
          path: ['outputSchemaName'],
        });
      }

      if (tool.mutates) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab dry-run app-server tools must not mutate project state.',
          path: ['mutates'],
        });
      }

      if (tool.requiresDryRunPlan) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab dry-run app-server tools create dry-run plans and must not require one.',
          path: ['requiresDryRunPlan'],
        });
      }
    }

    if (tool.executionMode === 'apply_dry_run_plan') {
      if (tool.inputSchemaName !== 'NegativeLabApplyPlanRequestV1') {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab apply app-server tools must accept NegativeLabApplyPlanRequestV1.',
          path: ['inputSchemaName'],
        });
      }

      if (tool.outputSchemaName !== 'NegativeLabApplyResultV1') {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab apply app-server tools must return NegativeLabApplyResultV1.',
          path: ['outputSchemaName'],
        });
      }

      if (!tool.mutates) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab apply app-server tools must be marked as mutating.',
          path: ['mutates'],
        });
      }

      if (!tool.requiresDryRunPlan) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab apply app-server tools must require a prior dry-run plan.',
          path: ['requiresDryRunPlan'],
        });
      }
    }

    if (tool.mutates && tool.approvalClass !== ApprovalClass.EditApply) {
      context.addIssue({
        code: 'custom',
        message: 'Mutating Negative Lab app-server tools require edit-apply approval.',
        path: ['approvalClass'],
      });
    }
  });

export const negativeLabAppServerToolManifestV1Schema = z
  .object({
    schemaVersion: z.literal(RAW_ENGINE_SCHEMA_VERSION),
    serverRuntime: z.literal('openai_app_server'),
    tools: z.array(negativeLabAppServerToolDefinitionV1Schema).min(1),
  })
  .strict();

export type ActorKind = z.infer<typeof actorKindSchema>;
export type ApprovalClass = z.infer<typeof approvalClassSchema>;
export type ApprovalRequirementV1 = z.infer<typeof approvalRequirementSchema>;
export type ArtifactHandleV1 = z.infer<typeof artifactHandleV1Schema>;
export type CommandEnvelopeV1 = z.infer<typeof commandEnvelopeV1Schema>;
export type NegativeAcquisitionConfidence = z.infer<typeof negativeAcquisitionConfidenceSchema>;
export type NegativeAcquisitionProfileV1 = z.infer<typeof negativeAcquisitionProfileV1Schema>;
export type NegativeLabAppServerAuditEvent = z.infer<typeof negativeLabAppServerAuditEventSchema>;
export type NegativeLabAppServerExecutionMode = z.infer<typeof negativeLabAppServerExecutionModeSchema>;
export type NegativeLabAppServerToolDefinitionV1 = z.infer<typeof negativeLabAppServerToolDefinitionV1Schema>;
export type NegativeLabAppServerToolManifestV1 = z.infer<typeof negativeLabAppServerToolManifestV1Schema>;
export type NegativeLabApplyFrameCropParametersV1 = z.infer<typeof negativeLabApplyFrameCropParametersV1Schema>;
export type NegativeLabApplyResultV1 = z.infer<typeof negativeLabApplyResultV1Schema>;
export type NegativeLabApplyPlanRequestV1 = z.infer<typeof negativeLabApplyPlanRequestV1Schema>;
export type NegativeLabBaseSampleRegionV1 = z.infer<typeof negativeLabBaseSampleRegionV1Schema>;
export type NegativeLabBuiltInPresetCatalogV1 = z.infer<typeof negativeLabBuiltInPresetCatalogV1Schema>;
export type NegativeLabBuiltInPresetFilmClass = z.infer<typeof negativeLabBuiltInPresetFilmClassSchema>;
export type NegativeLabBuiltInPresetTier = z.infer<typeof negativeLabBuiltInPresetTierSchema>;
export type NegativeLabBuiltInPresetV1 = z.infer<typeof negativeLabBuiltInPresetV1Schema>;
export type NegativeLabChangeSetV1 = z.infer<typeof negativeLabChangeSetV1Schema>;
export type NegativeLabCommandEnvelopeV1 = z.infer<typeof negativeLabCommandEnvelopeV1Schema>;
export type NegativeLabCommandType = z.infer<typeof negativeLabCommandTypeSchema>;
export type NegativeLabCreateSessionParametersV1 = z.infer<typeof negativeLabCreateSessionParametersV1Schema>;
export type NegativeLabCreatePositiveVariantParametersV1 = z.infer<
  typeof negativeLabCreatePositiveVariantParametersV1Schema
>;
export type NegativeLabDensityCurvePointV1 = z.infer<typeof negativeLabDensityCurvePointV1Schema>;
export type NegativeLabDensityCurveV1 = z.infer<typeof negativeLabDensityCurveV1Schema>;
export type NegativeLabDensityNormalizationProfileV1 = z.infer<typeof negativeLabDensityNormalizationProfileV1Schema>;
export type NegativeLabDryRunResultV1 = z.infer<typeof negativeLabDryRunResultV1Schema>;
export type NegativeLabEstimateBaseFogParametersV1 = z.infer<typeof negativeLabEstimateBaseFogParametersV1Schema>;
export type NegativeLabDetectedFrameCropV1 = z.infer<typeof negativeLabDetectedFrameCropV1Schema>;
export type NegativeLabDetectedFrameV1 = z.infer<typeof negativeLabDetectedFrameV1Schema>;
export type NegativeLabFixtureDistributionV1 = z.infer<typeof negativeLabFixtureDistributionV1Schema>;
export type NegativeLabFixtureManifestEntryV1 = z.infer<typeof negativeLabFixtureManifestEntryV1Schema>;
export type NegativeLabFixtureManifestV1 = z.infer<typeof negativeLabFixtureManifestV1Schema>;
export type NegativeLabFixtureRoleV1 = z.infer<typeof negativeLabFixtureRoleV1Schema>;
export type NegativeLabFixtureSourceV1 = z.infer<typeof negativeLabFixtureSourceV1Schema>;
export type NegativeLabFixtureStateV1 = z.infer<typeof negativeLabFixtureStateV1Schema>;
export type NegativeLabFixtureTierV1 = z.infer<typeof negativeLabFixtureTierV1Schema>;
export type NegativeLabFixtureValidationUseV1 = z.infer<typeof negativeLabFixtureValidationUseV1Schema>;
export type NegativeLabFixtureWarningCodeV1 = z.infer<typeof negativeLabFixtureWarningCodeV1Schema>;
export type NegativeLabFrameBorderMetricsV1 = z.infer<typeof negativeLabFrameBorderMetricsV1Schema>;
export type NegativeLabFrameDetectionRequestV1 = z.infer<typeof negativeLabFrameDetectionRequestV1Schema>;
export type NegativeLabFrameDetectionResultV1 = z.infer<typeof negativeLabFrameDetectionResultV1Schema>;
export type NegativeLabFrameCropEditV1 = z.infer<typeof negativeLabFrameCropEditV1Schema>;
export type NegativeLabFrameSelectionV1 = z.infer<typeof negativeLabFrameSelectionV1Schema>;
export type NegativeLabInputProfileCatalogV1 = z.infer<typeof negativeLabInputProfileCatalogV1Schema>;
export type NegativeLabInputProfileKindV1 = z.infer<typeof negativeLabInputProfileKindV1Schema>;
export type NegativeLabInputProfileSourceV1 = z.infer<typeof negativeLabInputProfileSourceV1Schema>;
export type NegativeLabInputProfileV1 = z.infer<typeof negativeLabInputProfileV1Schema>;
export type NegativeLabRejectedFrameCandidateV1 = z.infer<typeof negativeLabRejectedFrameCandidateV1Schema>;
export type NegativeLabLegalNamingStatus = z.infer<typeof negativeLabLegalNamingStatusSchema>;
export type NegativeLabOperationStage = z.infer<typeof negativeLabOperationStageSchema>;
export type NegativeLabOutputTransformRefV1 = z.infer<typeof negativeLabOutputTransformRefV1Schema>;
export type NegativeLabPlanRollNormalizationParametersV1 = z.infer<
  typeof negativeLabPlanRollNormalizationParametersV1Schema
>;
export type NegativeLabPositiveVariantProvenanceV1 = z.infer<typeof negativeLabPositiveVariantProvenanceV1Schema>;
export type NegativeLabPresetMetadataLegalReviewStatusV1 = z.infer<
  typeof negativeLabPresetMetadataLegalReviewStatusV1Schema
>;
export type NegativeLabPresetMetadataPolicyCatalogV1 = z.infer<typeof negativeLabPresetMetadataPolicyCatalogV1Schema>;
export type NegativeLabPresetMetadataPolicyClaimLevelV1 = z.infer<
  typeof negativeLabPresetMetadataPolicyClaimLevelV1Schema
>;
export type NegativeLabPresetMetadataPolicyTierV1 = z.infer<typeof negativeLabPresetMetadataPolicyTierV1Schema>;
export type NegativeLabPresetMetadataPolicyV1 = z.infer<typeof negativeLabPresetMetadataPolicyV1Schema>;
export type NegativeLabPresetMetadataUiContextV1 = z.infer<typeof negativeLabPresetMetadataUiContextV1Schema>;
export type NegativeLabPresetProfileRefV1 = z.infer<typeof negativeLabPresetProfileRefV1Schema>;
export type NegativeLabProcessProfileClass = z.infer<typeof negativeLabProcessProfileClassSchema>;
export type NegativeLabProcessProfileV1 = z.infer<typeof negativeLabProcessProfileV1Schema>;
export type NegativeLabProfileMeasurementSource = z.infer<typeof negativeLabProfileMeasurementSourceSchema>;
export type NegativeLabQcOverlayKind = z.infer<typeof negativeLabQcOverlayKindSchema>;
export type NegativeLabQcOverlayV1 = z.infer<typeof negativeLabQcOverlayV1Schema>;
export type NegativeLabQcProofArtifactV1 = z.infer<typeof negativeLabQcProofArtifactV1Schema>;
export type NegativeLabPreviewRequestV1 = z.infer<typeof negativeLabPreviewRequestV1Schema>;
export type NegativeLabRollBatchWorkflowStagePlanV1 = z.infer<typeof negativeLabRollBatchWorkflowStagePlanV1Schema>;
export type NegativeLabRollBatchWorkflowStageV1 = z.infer<typeof negativeLabRollBatchWorkflowStageV1Schema>;
export type NegativeLabRollBatchWorkflowV1 = z.infer<typeof negativeLabRollBatchWorkflowV1Schema>;
export type NegativeLabRollConsistencyFrameMetricV1 = z.infer<typeof negativeLabRollConsistencyFrameMetricV1Schema>;
export type NegativeLabRollConsistencyMetricsV1 = z.infer<typeof negativeLabRollConsistencyMetricsV1Schema>;
export type NegativeLabSampleGeometryV1 = z.infer<typeof negativeLabSampleGeometryV1Schema>;
export type NegativeLabSetConversionRecipeParametersV1 = z.infer<
  typeof negativeLabSetConversionRecipeParametersV1Schema
>;
export type NegativeLabSetFrameQcStatusParametersV1 = z.infer<typeof negativeLabSetFrameQcStatusParametersV1Schema>;
export type NegativeLabSourceAssetRefV1 = z.infer<typeof negativeLabSourceAssetRefV1Schema>;
export type NegativeLabSupportedProcessFamilyV1 = z.infer<typeof negativeLabSupportedProcessFamilyV1Schema>;
export type NegativeLabUpdateBaseSamplesParametersV1 = z.infer<typeof negativeLabUpdateBaseSamplesParametersV1Schema>;
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
