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

export type ActorKind = z.infer<typeof actorKindSchema>;
export type ApprovalClass = z.infer<typeof approvalClassSchema>;
export type ApprovalRequirementV1 = z.infer<typeof approvalRequirementSchema>;
export type ArtifactHandleV1 = z.infer<typeof artifactHandleV1Schema>;
export type CommandEnvelopeV1 = z.infer<typeof commandEnvelopeV1Schema>;
export type PanoramaArtifactV1 = z.infer<typeof panoramaArtifactV1Schema>;
export type QueryEnvelopeV1 = z.infer<typeof queryEnvelopeV1Schema>;
export type RawEngineActor = z.infer<typeof rawEngineActorSchema>;
export type RawEngineTarget = z.infer<typeof rawEngineTargetSchema>;
export type RawEngineToolDefinitionV1 = z.infer<typeof rawEngineToolDefinitionV1Schema>;
export type RawEngineToolRegistryV1 = z.infer<typeof rawEngineToolRegistryV1Schema>;
