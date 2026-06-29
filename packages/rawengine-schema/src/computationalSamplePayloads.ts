import {
  ActorKind,
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  focusStackArtifactV1Schema,
  hdrMergeArtifactV1Schema,
  panoramaArtifactV1Schema,
  panoramaBackendCapabilityReportV1Schema,
  superResolutionArtifactV1Schema,
  superResolutionDryRunSummaryV1Schema,
  type ComputationalMergeAppServerToolManifestV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  type FocusStackArtifactV1,
  type HdrMergeArtifactV1,
  type PanoramaArtifactV1,
  type PanoramaBackendCapabilityReportV1,
  type SuperResolutionArtifactV1,
  type SuperResolutionDryRunSummaryV1,
} from './rawEngineSchemas.js';

const sampleComputationalMergeGraphRevision = 'graph_rev_44';

export const rapidRawHomographySeamV0Capabilities = {
  adaptiveSeamFeather: true,
  autoCrop: true,
  bundleAdjustment: false,
  cylindricalProjection: false,
  exposureNormalization: false,
  planarHomography: true,
  tiledRender: false,
} satisfies PanoramaBackendCapabilityReportV1['capabilities'];

export const sampleComputationalMergeCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'codex-app-server',
      kind: ActorKind.Agent,
      sessionId: 'session_merge_sample',
    },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason:
        'Previewing a panorama merge estimates alignment, output dimensions, and artifacts without writing sidecars.',
      state: 'not_required',
    },
    commandId: 'command_merge_panorama_preview_sample',
    commandType: 'computationalMerge.createPanorama',
    correlationId: 'corr_merge_panorama_preview_sample',
    dryRun: true,
    expectedGraphRevision: sampleComputationalMergeGraphRevision,
    idempotencyKey: 'idem_merge_panorama_preview_sample',
    parameters: {
      boundaryMode: 'auto_crop',
      exposureNormalization: 'auto',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 2400,
      memoryBudgetBytes: 4_000_000_000,
      outputName: 'Ridge Overlook Panorama',
      projection: 'cylindrical',
      qualityPreference: 'balanced',
      sources: [
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_panorama_001',
          imagePath: '/photos/session/PANO_0001.CR3',
          rawDefaultsApplied: true,
          role: 'panorama_tile',
          sourceIndex: 0,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_panorama_002',
          imagePath: '/photos/session/PANO_0002.CR3',
          rawDefaultsApplied: true,
          role: 'panorama_tile',
          sourceIndex: 1,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_panorama_003',
          imagePath: '/photos/session/PANO_0003.CR3',
          rawDefaultsApplied: true,
          role: 'panorama_tile',
          sourceIndex: 2,
        },
      ],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      id: 'project_local_library',
      kind: 'project',
    },
  });

export const sampleComputationalMergeHdrCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Previewing an HDR merge estimates bracket quality, deghosting risk, and output artifacts.',
      state: 'not_required',
    },
    commandId: 'command_merge_hdr_preview_sample',
    commandType: 'computationalMerge.createHdr',
    correlationId: 'corr_merge_hdr_preview_sample',
    idempotencyKey: 'idem_merge_hdr_preview_sample',
    parameters: {
      alignmentMode: 'auto',
      bracketValidation: 'required',
      deghosting: 'medium',
      maxPreviewDimensionPx: 2400,
      mergeStrategy: 'scene_linear_radiance',
      outputName: 'Window Light HDR',
      qualityPreference: 'balanced',
      sources: [
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: -2,
          imageId: 'img_hdr_001',
          imagePath: '/photos/session/HDR_0001.CR3',
          rawDefaultsApplied: true,
          role: 'hdr_bracket',
          sourceIndex: 0,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_hdr_002',
          imagePath: '/photos/session/HDR_0002.CR3',
          rawDefaultsApplied: true,
          role: 'hdr_bracket',
          sourceIndex: 1,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 2,
          imageId: 'img_hdr_003',
          imagePath: '/photos/session/HDR_0003.CR3',
          rawDefaultsApplied: true,
          role: 'hdr_bracket',
          sourceIndex: 2,
        },
      ],
      toneMapPreview: true,
    },
  });

export const sampleHdrMergeArtifactV1: HdrMergeArtifactV1 = hdrMergeArtifactV1Schema.parse({
  alignment: {
    alignmentConfidence: 0.91,
    referenceSourceIndex: 1,
    rejectedSourceIndexes: [],
    requestedAlignmentMode: 'auto',
    resolvedAlignmentMode: 'translation',
    transforms: [
      {
        confidence: 0.9,
        sourceIndex: 0,
        transformType: 'translation',
        translationPx: {
          x: -1.5,
          y: 0.5,
        },
      },
      {
        confidence: 1,
        sourceIndex: 1,
        transformType: 'identity',
        translationPx: {
          x: 0,
          y: 0,
        },
      },
      {
        confidence: 0.89,
        sourceIndex: 2,
        transformType: 'translation',
        translationPx: {
          x: 1.75,
          y: -0.25,
        },
      },
    ],
  },
  artifactId: 'artifact_hdr_window_light_0001',
  blockCodes: [],
  bracketDetection: {
    accepted: true,
    blockCodes: [],
    bracketSpanEv: 4,
    detectionConfidence: 0.98,
    detectionMethod: 'caller_declared_ev',
    referenceSourceIndex: 1,
    sourceMetadata: [
      {
        contentHash: 'sha256:hdr-source-0001',
        graphRevision: sampleComputationalMergeGraphRevision,
        height: 4000,
        imageId: 'img_hdr_001',
        imagePath: '/photos/session/HDR_0001.CR3',
        rawBlackLevelKnown: true,
        rawWhiteLevelKnown: true,
        resolvedBracketRole: 'under_exposed',
        resolvedExposureEv: -2,
        sourceIndex: 0,
        whiteBalanceComparable: true,
        width: 6000,
      },
      {
        contentHash: 'sha256:hdr-source-0002',
        graphRevision: sampleComputationalMergeGraphRevision,
        height: 4000,
        imageId: 'img_hdr_002',
        imagePath: '/photos/session/HDR_0002.CR3',
        rawBlackLevelKnown: true,
        rawWhiteLevelKnown: true,
        resolvedBracketRole: 'reference',
        resolvedExposureEv: 0,
        sourceIndex: 1,
        whiteBalanceComparable: true,
        width: 6000,
      },
      {
        contentHash: 'sha256:hdr-source-0003',
        graphRevision: sampleComputationalMergeGraphRevision,
        height: 4000,
        imageId: 'img_hdr_003',
        imagePath: '/photos/session/HDR_0003.CR3',
        rawBlackLevelKnown: true,
        rawWhiteLevelKnown: true,
        resolvedBracketRole: 'over_exposed',
        resolvedExposureEv: 2,
        sourceIndex: 2,
        whiteBalanceComparable: true,
        width: 6000,
      },
    ],
    warningCodes: ['dimensions_match_but_raw_geometry_unverified', 'tone_mapped_preview_only'],
  },
  createdAt: '2026-06-14T04:45:00.000Z',
  deghosting: {
    masks: [
      {
        artifact: {
          artifactId: 'artifact_hdr_window_light_0001_motion_mask',
          contentHash: 'sha256:sample-hdr-motion-mask',
          dimensions: {
            height: 1000,
            width: 1500,
          },
          kind: 'mask',
          storage: 'sidecar_artifact',
        },
        encodedMeaning: 'u8_0_255_probability',
        height: 1000,
        kind: 'motion_probability',
        sourceIndexes: [0, 1, 2],
        width: 1500,
      },
    ],
    motionCoverageRatio: 0.03,
    motionRisk: 'low',
    referenceSourceIndex: 1,
    requestedDeghosting: 'medium',
    resolvedDeghosting: 'medium',
  },
  dryRun: {
    acceptedDryRunPlanHash: 'sha256:sample-merge-hdr-plan',
    acceptedDryRunPlanId: 'merge_plan_hdr_001',
  },
  editableDerivedAssetId: 'derived_hdr_window_light',
  engine: {
    backendType: 'schema_only',
    capabilityLevel: 'schema_only',
    engineId: 'rawengine_hdr_schema_v0',
    engineVersion: '0.1.0-schema',
  },
  family: 'hdr',
  highlightRecovery: {
    clippedInputPixelRatioBySource: [
      {
        clippedHighRatio: 0.001,
        nearClippedHighRatio: 0.014,
        sourceIndex: 0,
      },
      {
        clippedHighRatio: 0.04,
        nearClippedHighRatio: 0.12,
        sourceIndex: 1,
      },
      {
        clippedHighRatio: 0.18,
        nearClippedHighRatio: 0.28,
        sourceIndex: 2,
      },
    ],
    highlightDetailGainRatio: 1.42,
    recoveredHighlightPixelRatio: 0.15,
    shadowNoiseAmplificationRisk: 'medium',
    unrecoveredClippedPixelRatio: 0.006,
  },
  mergeStrategy: 'scene_linear_radiance',
  outputArtifact: {
    artifactId: 'artifact_hdr_window_light_0001_output',
    contentHash: 'sha256:sample-hdr-output',
    dimensions: {
      height: 4000,
      width: 6000,
    },
    kind: 'merge_output',
    storage: 'sidecar_artifact',
  },
  outputColorSpace: 'linear_rec2020_d65_v1',
  outputEncoding: 'scene_linear_half_float',
  outputName: 'Window Light HDR',
  previewArtifacts: [
    {
      artifactId: 'artifact_hdr_window_light_0001_preview',
      contentHash: 'sha256:sample-hdr-preview',
      dimensions: {
        height: 1600,
        width: 2400,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  previewToneMapped: true,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceImageRefs: sampleComputationalMergeHdrCommandEnvelopeV1.parameters.sources,
  sourceState: [
    {
      contentHash: 'sha256:hdr-source-0001',
      graphRevision: sampleComputationalMergeGraphRevision,
      resolvedExposureEv: -2,
      sourceIndex: 0,
    },
    {
      contentHash: 'sha256:hdr-source-0002',
      graphRevision: sampleComputationalMergeGraphRevision,
      resolvedExposureEv: 0,
      sourceIndex: 1,
    },
    {
      contentHash: 'sha256:hdr-source-0003',
      graphRevision: sampleComputationalMergeGraphRevision,
      resolvedExposureEv: 2,
      sourceIndex: 2,
    },
  ],
  staleState: {
    checkedAt: '2026-06-14T04:46:00.000Z',
    invalidationReasons: [],
    state: 'current',
  },
  warningCodes: ['dimensions_match_but_raw_geometry_unverified', 'tone_mapped_preview_only'],
  workingColorSpace: 'linear_rec2020_d65_v1',
});

const sampleFocusStackAlignmentMode = 'auto';
const sampleFocusStackBlendMethod = 'laplacian_pyramid';
const sampleFocusStackQualityPreference = 'best';
const sampleFocusStackResolvedAlignmentMode = 'homography';
const sampleFocusStackRetouchLayerPolicy = 'generate_retouch_layer';

export const sampleComputationalMergeFocusStackCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Previewing a focus stack estimates focus coverage and retouch layer needs.',
      state: 'not_required',
    },
    commandId: 'command_merge_focus_stack_preview_sample',
    commandType: 'computationalMerge.createFocusStack',
    correlationId: 'corr_merge_focus_stack_preview_sample',
    idempotencyKey: 'idem_merge_focus_stack_preview_sample',
    parameters: {
      alignmentMode: sampleFocusStackAlignmentMode,
      blendMethod: sampleFocusStackBlendMethod,
      maxPreviewDimensionPx: 2400,
      memoryBudgetBytes: 1_000_000_000,
      outputName: 'Macro Focus Stack',
      qualityPreference: sampleFocusStackQualityPreference,
      retouchLayerPolicy: sampleFocusStackRetouchLayerPolicy,
      sources: [
        {
          colorSpaceHint: 'camera_rgb',
          focusDistanceMm: 180,
          imageId: 'img_focus_001',
          imagePath: '/photos/session/FOCUS_0001.CR3',
          rawDefaultsApplied: true,
          role: 'focus_slice',
          sourceIndex: 0,
        },
        {
          colorSpaceHint: 'camera_rgb',
          focusDistanceMm: 240,
          imageId: 'img_focus_002',
          imagePath: '/photos/session/FOCUS_0002.CR3',
          rawDefaultsApplied: true,
          role: 'focus_slice',
          sourceIndex: 1,
        },
        {
          colorSpaceHint: 'camera_rgb',
          focusDistanceMm: 320,
          imageId: 'img_focus_003',
          imagePath: '/photos/session/FOCUS_0003.CR3',
          rawDefaultsApplied: true,
          role: 'focus_slice',
          sourceIndex: 2,
        },
      ],
    },
  });

export const sampleFocusStackArtifactV1: FocusStackArtifactV1 = focusStackArtifactV1Schema.parse({
  artifactId: 'artifact_focus_stack_macro_0001',
  blendMethod: sampleFocusStackBlendMethod,
  createdAt: '2026-06-14T03:00:00.000Z',
  depthConfidenceMapArtifact: {
    artifactId: 'artifact_focus_stack_macro_0001_depth_confidence',
    contentHash: 'sha256:sample-focus-depth-confidence-map',
    dimensions: {
      height: 1200,
      width: 1800,
    },
    kind: 'mask',
    storage: 'sidecar_artifact',
  },
  dryRun: {
    acceptedDryRunPlanHash: 'sha256:sample-merge-focus-stack-plan',
    acceptedDryRunPlanId: 'merge_plan_focus_stack_001',
  },
  engine: {
    backendType: 'local_gpu',
    engineId: 'rawengine_focus_stack_v0',
    engineVersion: '0.1.0-schema',
  },
  family: 'focus_stack',
  outputArtifact: {
    artifactId: 'artifact_focus_stack_macro_0001_output',
    contentHash: 'sha256:sample-focus-stack-output',
    dimensions: {
      height: 4000,
      width: 6000,
    },
    kind: 'merge_output',
    storage: 'sidecar_artifact',
  },
  outputColorSpace: 'linear_rec2020_d65_v1',
  previewArtifacts: [
    {
      artifactId: 'artifact_focus_stack_macro_0001_preview',
      contentHash: 'sha256:sample-focus-stack-preview',
      dimensions: {
        height: 1600,
        width: 2400,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  qualityPreference: sampleFocusStackQualityPreference,
  requestedAlignmentMode: sampleFocusStackAlignmentMode,
  resolvedAlignmentMode: sampleFocusStackResolvedAlignmentMode,
  retouchLayerArtifact: {
    artifactId: 'artifact_focus_stack_macro_0001_retouch_layer',
    contentHash: 'sha256:sample-focus-stack-retouch-layer',
    dimensions: {
      height: 4000,
      width: 6000,
    },
    kind: 'generated_patch',
    storage: 'sidecar_artifact',
  },
  retouchLayerPolicy: sampleFocusStackRetouchLayerPolicy,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sharpnessMapArtifact: {
    artifactId: 'artifact_focus_stack_macro_0001_sharpness_map',
    contentHash: 'sha256:sample-focus-sharpness-map',
    dimensions: {
      height: 1200,
      width: 1800,
    },
    kind: 'mask',
    storage: 'sidecar_artifact',
  },
  sharpnessSettings: {
    cellCount: 3,
    lowConfidenceCellCount: 0,
    lowConfidenceWeightFloor: 0.12,
    weightPower: 5,
  },
  sourceImageRefs: sampleComputationalMergeFocusStackCommandEnvelopeV1.parameters.sources,
  sourceState: [
    {
      contentHash: 'sha256:focus-source-0001',
      focusDistanceMm: 180,
      graphRevision: sampleComputationalMergeGraphRevision,
      sourceIndex: 0,
    },
    {
      contentHash: 'sha256:focus-source-0002',
      focusDistanceMm: 240,
      graphRevision: sampleComputationalMergeGraphRevision,
      sourceIndex: 1,
    },
    {
      contentHash: 'sha256:focus-source-0003',
      focusDistanceMm: 320,
      graphRevision: sampleComputationalMergeGraphRevision,
      sourceIndex: 2,
    },
  ],
  staleState: {
    checkedAt: '2026-06-14T03:01:00.000Z',
    invalidationReasons: [],
    state: 'current',
  },
  validationSummary: {
    alignmentConfidence: 0.92,
    focusCoverageRatio: 0.96,
    parallaxRisk: 'low',
    rejectedSourceIndexes: [],
    retouchRequired: true,
    sourceCount: sampleComputationalMergeFocusStackCommandEnvelopeV1.parameters.sources.length,
  },
  warningCodes: ['human_review_required', 'retouch_layer_required'],
});

export const sampleComputationalMergeFocusStackApplyCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeFocusStackCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason:
        'Applying the accepted focus stack creates an editable all-in-focus derived asset with retouch provenance.',
      state: 'approved',
    },
    commandId: 'command_merge_focus_stack_apply_sample',
    correlationId: 'corr_merge_focus_stack_apply_sample',
    dryRun: false,
    idempotencyKey: 'idem_merge_focus_stack_apply_sample',
    parameters: {
      ...sampleComputationalMergeFocusStackCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: 'sha256:sample-merge-focus-stack-plan',
      acceptedDryRunPlanId: 'merge_plan_focus_stack_001',
    },
  });

export const sampleComputationalMergeSuperResolutionCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Previewing a super-resolution merge estimates registration quality and detail gain without synthesis.',
      state: 'not_required',
    },
    commandId: 'command_merge_super_resolution_preview_sample',
    commandType: 'computationalMerge.createSuperResolution',
    correlationId: 'corr_merge_super_resolution_preview_sample',
    idempotencyKey: 'idem_merge_super_resolution_preview_sample',
    parameters: {
      alignmentMode: 'optical_flow',
      detailPolicy: 'conservative',
      maxPreviewDimensionPx: 2400,
      mode: 'multi_image',
      outputName: 'Handheld Burst Super Resolution',
      outputScale: 2,
      qualityPreference: 'best',
      reconstructionMode: 'model_detail',
      sources: [
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_sr_001',
          imagePath: '/photos/session/SR_0001.CR3',
          rawDefaultsApplied: true,
          role: 'sr_frame',
          sourceIndex: 0,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_sr_002',
          imagePath: '/photos/session/SR_0002.CR3',
          rawDefaultsApplied: true,
          role: 'sr_frame',
          sourceIndex: 1,
        },
        {
          colorSpaceHint: 'camera_rgb',
          exposureEv: 0,
          imageId: 'img_sr_003',
          imagePath: '/photos/session/SR_0003.CR3',
          rawDefaultsApplied: true,
          role: 'sr_frame',
          sourceIndex: 2,
        },
      ],
    },
  });

export const sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Previewing single-image super-resolution estimates conservative detail gain without alignment.',
      state: 'not_required',
    },
    commandId: 'command_merge_single_image_super_resolution_preview_sample',
    correlationId: 'corr_merge_single_image_super_resolution_preview_sample',
    idempotencyKey: 'idem_merge_single_image_super_resolution_preview_sample',
    parameters: {
      ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters,
      alignmentMode: 'none',
      mode: 'single_image',
      outputName: 'Single Image Super Resolution',
      sources: [
        {
          ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters.sources[0],
          imageId: 'img_sr_single_001',
          imagePath: '/photos/session/SR_SINGLE_0001.CR3',
          sourceIndex: 0,
        },
      ],
    },
  });

export const sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason:
        'Applying the accepted conservative super-resolution merge creates a derived editable asset and provenance entry.',
      state: 'approved',
    },
    commandId: 'command_merge_super_resolution_apply_sample',
    correlationId: 'corr_merge_super_resolution_apply_sample',
    dryRun: false,
    idempotencyKey: 'idem_merge_super_resolution_apply_sample',
    parameters: {
      ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: 'sha256:sample-merge-super-resolution-plan',
      acceptedDryRunPlanId: 'merge_plan_super_resolution_001',
    },
  });

export const sampleComputationalMergeApplyCommandEnvelopeV1: ComputationalMergeCommandEnvelopeV1 =
  computationalMergeCommandEnvelopeV1Schema.parse({
    ...sampleComputationalMergeCommandEnvelopeV1,
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Applying the accepted panorama merge creates a derived editable asset and edit graph node.',
      state: 'approved',
    },
    commandId: 'command_merge_panorama_apply_sample',
    correlationId: 'corr_merge_panorama_apply_sample',
    dryRun: false,
    idempotencyKey: 'idem_merge_panorama_apply_sample',
    parameters: {
      ...sampleComputationalMergeCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: 'sha256:sample-merge-panorama-plan',
      acceptedDryRunPlanId: 'merge_plan_panorama_001',
    },
  });

export const sampleComputationalMergeDryRunResultV1: ComputationalMergeDryRunResultV1 =
  computationalMergeDryRunResultV1Schema.parse({
    commandId: sampleComputationalMergeCommandEnvelopeV1.commandId,
    commandType: sampleComputationalMergeCommandEnvelopeV1.commandType,
    correlationId: sampleComputationalMergeCommandEnvelopeV1.correlationId,
    dryRun: true,
    mergePlan: {
      family: 'panorama',
      outputDimensions: {
        height: 2400,
        width: 5600,
      },
      outputName: sampleComputationalMergeCommandEnvelopeV1.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: 1_400_000_000,
        estimatedRuntimeMs: 8500,
        requiresBackgroundJob: true,
      },
      planId: 'merge_plan_panorama_001',
      preflight: {
        blockedReasons: [],
        engineCapabilities: {
          fullFrameLegacy: true,
          maxPreviewDimensionPx: sampleComputationalMergeCommandEnvelopeV1.parameters.maxPreviewDimensionPx,
          planOnly: true,
          tileBackedRender: false,
        },
        executionMode: 'full_frame_legacy',
        geometryEstimate: {
          outputPixelCount: 13_440_000,
          projectedBounds: {
            height: 2400,
            width: 5600,
            x: 0,
            y: 0,
          },
          sourceCount: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.length,
          sourcePixelCount: 72_000_000,
        },
        memoryBudgetBytes: 4_000_000_000,
        memoryBudgetRatio: 0.35,
        memoryComponents: {
          lowDetailMaskBytes: 3_360_000,
          outputCanvasBytes: 161_280_000,
          outputMaskBytes: 13_440_000,
          overheadBytes: 112_313_600,
          previewBytes: 29_606_400,
          seamWorkspaceBytes: 180_000_000,
          sourceDecodeBytes: 900_000_000,
          totalEstimatedPeakBytes: 1_400_000_000,
        },
        status: 'accepted',
        tileCount: 1,
        warningCodes: ['legacy_full_frame_render'],
      },
      qualityMetrics: {
        alignmentConfidence: 0.92,
        overlapCoverageRatio: 0.31,
        sourceCount: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.length,
      },
      sourceImageRefs: sampleComputationalMergeCommandEnvelopeV1.parameters.sources,
      warnings: ['Lens correction must be applied before final stitch.'],
    },
    mutates: false,
    predictedGraphRevision: 'graph_rev_48_preview',
    previewArtifacts: [
      {
        artifactId: 'artifact_merge_panorama_preview',
        contentHash: 'sha256:sample-merge-panorama-preview',
        dimensions: {
          height: 1028,
          width: 2400,
        },
        kind: 'preview',
        storage: 'temp_cache',
      },
    ],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: sampleComputationalMergeGraphRevision,
    warnings: ['Preview uses downscaled alignment and may shift after full-resolution render.'],
  });

export const sampleComputationalMergeMutationResultV1: ComputationalMergeMutationResultV1 =
  computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: 'graph_rev_48',
    changedNodeIds: ['node_merge_panorama_001'],
    commandId: sampleComputationalMergeApplyCommandEnvelopeV1.commandId,
    commandType: sampleComputationalMergeApplyCommandEnvelopeV1.commandType,
    correlationId: sampleComputationalMergeApplyCommandEnvelopeV1.correlationId,
    derivedAssetId: 'derived_panorama_ridge_overlook',
    dryRun: false,
    mutates: true,
    outputArtifacts: [
      {
        artifactId: 'artifact_merge_panorama_full',
        contentHash: 'sha256:sample-merge-panorama-full',
        dimensions: {
          height: 2400,
          width: 5600,
        },
        kind: 'merge_output',
        storage: 'sidecar_artifact',
      },
    ],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: sampleComputationalMergeGraphRevision,
    undoRevision: sampleComputationalMergeGraphRevision,
    warnings: [],
  });

const sampleSuperResolutionDetailPolicy = 'conservative';
const sampleSuperResolutionOutputScale = 2;
const sampleSuperResolutionAlignmentMode = 'optical_flow';
const sampleSuperResolutionQualityPreference = 'best';
const sampleSuperResolutionReconstructionMode = 'model_detail';

export const sampleSuperResolutionDryRunSummaryV1: SuperResolutionDryRunSummaryV1 =
  superResolutionDryRunSummaryV1Schema.parse({
    blockCodes: [],
    commandId: sampleComputationalMergeSuperResolutionCommandEnvelopeV1.commandId,
    decisionStatus: 'eligible_for_apply',
    detailPolicy: sampleSuperResolutionDetailPolicy,
    effectiveOutputScale: sampleSuperResolutionOutputScale,
    estimatedOutputDimensions: {
      height: 6000,
      width: 9000,
    },
    humanReviewStatus: 'pending',
    localConfidenceMapArtifact: {
      artifactId: 'artifact_sr_confidence_map_preview',
      contentHash: 'sha256:sample-sr-confidence-map',
      dimensions: {
        height: 1500,
        width: 2250,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
    planHash: 'sha256:sample-merge-super-resolution-plan',
    planId: 'merge_plan_super_resolution_001',
    qualityPreference: sampleSuperResolutionQualityPreference,
    requestedAlignmentMode: sampleSuperResolutionAlignmentMode,
    requestedOutputScale: sampleSuperResolutionOutputScale,
    resolvedAlignmentMode: sampleSuperResolutionAlignmentMode,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceState: [
      {
        contentHash: 'sha256:sr-source-0001',
        graphRevision: sampleComputationalMergeGraphRevision,
        sourceIndex: 0,
      },
      {
        contentHash: 'sha256:sr-source-0002',
        graphRevision: sampleComputationalMergeGraphRevision,
        sourceIndex: 1,
      },
      {
        contentHash: 'sha256:sr-source-0003',
        graphRevision: sampleComputationalMergeGraphRevision,
        sourceIndex: 2,
      },
    ],
    validationSummary: {
      alignmentConfidence: 0.91,
      expectedDetailGainRatio: 1.72,
      falseDetailRisk: 'low',
      overlapCoverageRatio: 0.88,
      sourceCount: sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters.sources.length,
    },
    warningCodes: ['human_review_required'],
  });

export const sampleSuperResolutionArtifactV1: SuperResolutionArtifactV1 = superResolutionArtifactV1Schema.parse({
  artifactId: 'artifact_sr_handheld_burst_0001',
  createdAt: '2026-06-14T02:30:00.000Z',
  decisionStatus: 'eligible_for_apply',
  detailPolicy: sampleSuperResolutionDetailPolicy,
  dryRun: {
    acceptedDryRunPlanHash: sampleSuperResolutionDryRunSummaryV1.planHash,
    acceptedDryRunPlanId: sampleSuperResolutionDryRunSummaryV1.planId,
  },
  engine: {
    backendType: 'local_gpu',
    engineId: 'rawengine_sr_multi_frame_v0',
    engineVersion: '0.1.0-schema',
  },
  family: 'super_resolution',
  outputArtifact: {
    artifactId: 'artifact_sr_handheld_burst_0001_output',
    contentHash: 'sha256:sample-sr-output',
    dimensions: sampleSuperResolutionDryRunSummaryV1.estimatedOutputDimensions,
    kind: 'merge_output',
    storage: 'sidecar_artifact',
  },
  outputColorSpace: 'linear_rec2020_d65_v1',
  previewArtifacts: [
    {
      artifactId: 'artifact_sr_handheld_burst_0001_preview',
      contentHash: 'sha256:sample-sr-preview',
      dimensions: {
        height: 1600,
        width: 2400,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  qualityPreference: sampleSuperResolutionQualityPreference,
  requestedAlignmentMode: sampleSuperResolutionAlignmentMode,
  reconstructionMode: sampleSuperResolutionReconstructionMode,
  requestedOutputScale: sampleSuperResolutionOutputScale,
  resolvedAlignmentMode: sampleSuperResolutionDryRunSummaryV1.resolvedAlignmentMode,
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceImageRefs: sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters.sources,
  sourceState: sampleSuperResolutionDryRunSummaryV1.sourceState,
  staleState: {
    checkedAt: '2026-06-14T02:31:00.000Z',
    invalidationReasons: [],
    state: 'current',
  },
  validationSummary: {
    alignmentConfidence: sampleSuperResolutionDryRunSummaryV1.validationSummary.alignmentConfidence,
    expectedDetailGainRatio: sampleSuperResolutionDryRunSummaryV1.validationSummary.expectedDetailGainRatio,
    falseDetailRisk: sampleSuperResolutionDryRunSummaryV1.validationSummary.falseDetailRisk,
    humanReviewStatus: 'passed',
    overlapCoverageRatio: sampleSuperResolutionDryRunSummaryV1.validationSummary.overlapCoverageRatio,
    sourceCount: sampleSuperResolutionDryRunSummaryV1.validationSummary.sourceCount,
  },
  warningCodes: sampleSuperResolutionDryRunSummaryV1.warningCodes,
});

export const samplePanoramaArtifactV1: PanoramaArtifactV1 = panoramaArtifactV1Schema.parse({
  alignment: {
    algorithmId: 'rapidraw_fast9_brief_ransac_v1',
    downscaleMaxDimensionPx: 1600,
    globalHomographyCount: 3,
    minimumInliersForConnection: 15,
    pairwiseMatches: [
      {
        fromSourceIndex: 0,
        homography3x3: [1, 0.01, 148.2, -0.01, 1, 2.4, 0, 0, 1],
        inliers: 82,
        matchQuality: 'accepted',
        reprojectionErrorPx: 1.8,
        toSourceIndex: 1,
      },
      {
        fromSourceIndex: 1,
        homography3x3: [1, 0.02, 151.6, -0.02, 1, 1.7, 0, 0, 1],
        inliers: 76,
        matchQuality: 'accepted',
        reprojectionErrorPx: 2.1,
        toSourceIndex: 2,
      },
    ],
    ransacSeed: 12345,
    ransacInlierThresholdPx: 5,
    ransacIterations: 2500,
  },
  artifactId: 'artifact_panorama_session_0001',
  boundaryMode: 'auto_crop',
  boundarySettings: {
    crop: {
      height: 3900,
      mode: 'auto',
      width: 9200,
      x: 42,
      y: 18,
    },
    effectiveMode: 'auto_crop',
    requestedMode: 'auto_crop',
    support: 'implemented_current_engine',
  },
  createdAt: '2026-06-13T07:30:00.000Z',
  crop: {
    height: 3900,
    mode: 'auto',
    width: 9200,
    x: 42,
    y: 18,
  },
  excludedSources: [],
  engine: {
    capabilities: rapidRawHomographySeamV0Capabilities,
    engineId: 'rapidraw_homography_seam_v0',
    qualityTier: 'legacy_local_preview',
  },
  exposureNormalization: {
    deferredReason: 'Current panorama runtime records planned exposure normalization but does not apply it yet.',
    mode: 'planned',
    overlapMetrics: {
      channelRatioDeltaBefore: 0.09,
      medianLogLuminanceDeltaBefore: 0.14,
    },
    support: 'schema_only_deferred',
  },
  lensCorrectionPolicy: 'required_before_stitch',
  operationId: 'merge.panorama.create',
  operationVersion: 1,
  outputArtifacts: [
    {
      artifactId: 'artifact_panorama_session_0001_output',
      contentHash: 'sha256:sample-panorama-output',
      dimensions: {
        height: 3900,
        width: 9200,
      },
      kind: 'merge_output',
      storage: 'sidecar_artifact',
    },
  ],
  outputColorSpace: 'linear_rec2020_d65_v1',
  previewArtifacts: [
    {
      artifactId: 'artifact_panorama_session_0001_preview',
      contentHash: 'sha256:sample-panorama-preview',
      dimensions: {
        height: 543,
        width: 1280,
      },
      kind: 'preview',
      storage: 'temp_cache',
    },
  ],
  projection: 'rectilinear',
  projectionSettings: {
    effectiveProjection: 'rectilinear',
    horizontalFovDegrees: 72,
    inputFocalLength35mmEquivalentMm: 28,
    requestedProjection: 'rectilinear',
    support: 'implemented_current_engine',
  },
  provenance: {
    commandId: 'command_panorama_create_sample',
    graphRevision: 'graph_rev_43',
    runtimeStatus: 'rendered',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  seamPolicy: {
    featherWidthPx: 100,
    lowDetailFeatherMultiplier: 5,
    mode: 'adaptive_dp_feather_v1',
  },
  sourceImageRefs: [
    {
      imagePath: '/photos/pano/IMG_0001.CR3',
      lensCorrectionState: 'required_before_stitch',
      rawDefaultsApplied: true,
      sourceIndex: 0,
      virtualCopyId: null,
    },
    {
      imagePath: '/photos/pano/IMG_0002.CR3',
      lensCorrectionState: 'required_before_stitch',
      rawDefaultsApplied: true,
      sourceIndex: 1,
      virtualCopyId: null,
    },
    {
      imagePath: '/photos/pano/IMG_0003.CR3',
      lensCorrectionState: 'required_before_stitch',
      rawDefaultsApplied: true,
      sourceIndex: 2,
      virtualCopyId: null,
    },
  ],
  sourceState: [
    {
      contentHash: 'sha256:panorama-source-0001',
      graphRevision: 'graph_rev_43',
      sourceIndex: 0,
    },
    {
      contentHash: 'sha256:panorama-source-0002',
      graphRevision: 'graph_rev_43',
      sourceIndex: 1,
    },
    {
      contentHash: 'sha256:panorama-source-0003',
      graphRevision: 'graph_rev_43',
      sourceIndex: 2,
    },
  ],
  staleState: {
    checkedAt: '2026-06-13T07:31:00.000Z',
    invalidationReasons: [],
    state: 'current',
  },
  validationMetrics: {
    estimatedPeakMemoryBytes: 2200000000,
    excludedSourceCount: 0,
    overlapCoverageRatio: 0.28,
    outputHeight: 3900,
    outputWidth: 9200,
    reprojectionP95Px: 3.4,
    reprojectionRmsPx: 1.9,
    seamEnergy: 0.18,
    sourceCount: 3,
    stitchedSourceCount: 3,
  },
  warnings: ['exposure_mismatch'],
});

export const samplePanoramaBackendCapabilityReportV1: PanoramaBackendCapabilityReportV1 =
  panoramaBackendCapabilityReportV1Schema.parse({
    backendId: 'rapidraw_homography_seam_v0',
    backendVersion: 'legacy-current',
    capabilities: rapidRawHomographySeamV0Capabilities,
    ciPolicy: {
      defaultRequiredCiAllowed: true,
      requiredCiBlockers: [],
      suggestedCiTier: 'required_pr',
    },
    limits: {
      maxRecommendedOutputPixels: 36000000,
      maxRecommendedPeakMemoryBytes: 2400000000,
      maxRecommendedSourceCount: 6,
    },
    macosPackagingStatus: 'not_required',
    qualityTier: 'legacy_local_preview',
    runtimeRequirements: {
      externalLibraries: [],
      requiresExternalLibraries: false,
      requiresNetworkAtRuntime: false,
    },
    schemaBoundary: {
      backendTypesLeakIntoArtifacts: false,
      rawEngineCapabilityNamesOnly: true,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    status: 'default_enabled',
    supportedBlendModes: ['feather', 'overwrite'],
    supportedBoundaryModes: ['auto_crop', 'transparent', 'manual_crop'],
    supportedExposureModes: ['none', 'planned'],
    supportedProjections: ['rectilinear', 'planar'],
    supportedSeamMethods: ['adaptive_dp_feather_v1', 'overwrite_fallback'],
    warnings: ['backend_types_must_not_escape'],
  });

export const sampleComputationalMergeAppServerToolManifestV1: ComputationalMergeAppServerToolManifestV1 =
  computationalMergeAppServerToolManifestV1Schema.parse({
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    serverRuntime: 'openai_app_server',
    tools: [
      {
        allowedCommandTypes: ['computationalMerge.createPanorama'],
        approvalClass: ApprovalClass.PreviewOnly,
        auditEvents: ['computational_merge_dry_run_requested', 'computational_merge_dry_run_completed'],
        description:
          'Preview a local panorama stitch and return a non-mutating dry-run plan with geometry, memory, and artifact handles.',
        executionMode: 'dry_run_command',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: false,
        outputSchemaName: 'ComputationalMergeDryRunResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: false,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.panorama.dry_run_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createPanorama'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: ['computational_merge_apply_requested', 'computational_merge_apply_completed'],
        description:
          'Apply an accepted local panorama dry-run plan into the non-destructive edit graph after approval.',
        executionMode: 'apply_dry_run_plan',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeMutationResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.panorama.apply_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createPanorama'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: [
          'computational_merge_derived_source_open_requested',
          'computational_merge_derived_source_open_completed',
        ],
        description:
          'Open an approved panorama output as an editable derived source after receipt and stale-state validation.',
        executionMode: 'open_derived_source',
        inputSchemaName: 'ComputationalMergeDerivedSourceOpenRequestV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeDerivedSourceOpenResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.panorama.open_derived_source',
      },
      {
        allowedCommandTypes: ['computationalMerge.createHdr'],
        approvalClass: ApprovalClass.PreviewOnly,
        auditEvents: ['computational_merge_dry_run_requested', 'computational_merge_dry_run_completed'],
        description:
          'Preview a local HDR bracket merge and return a non-mutating dry-run plan with bracket, deghosting, and artifact handles.',
        executionMode: 'dry_run_command',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: false,
        outputSchemaName: 'ComputationalMergeDryRunResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: false,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.hdr.dry_run_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createHdr'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: ['computational_merge_apply_requested', 'computational_merge_apply_completed'],
        description: 'Apply an accepted local HDR dry-run plan into the non-destructive edit graph after approval.',
        executionMode: 'apply_dry_run_plan',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeMutationResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.hdr.apply_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createHdr'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: [
          'computational_merge_derived_source_open_requested',
          'computational_merge_derived_source_open_completed',
        ],
        description:
          'Open an approved HDR output as an editable derived source after receipt and stale-state validation.',
        executionMode: 'open_derived_source',
        inputSchemaName: 'ComputationalMergeDerivedSourceOpenRequestV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeDerivedSourceOpenResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.hdr.open_derived_source',
      },
      {
        allowedCommandTypes: ['computationalMerge.createFocusStack'],
        approvalClass: ApprovalClass.PreviewOnly,
        auditEvents: ['computational_merge_dry_run_requested', 'computational_merge_dry_run_completed'],
        description:
          'Preview a local focus stack and return a non-mutating dry-run plan with focus coverage and retouch artifact handles.',
        executionMode: 'dry_run_command',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: false,
        outputSchemaName: 'ComputationalMergeDryRunResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: false,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.focus_stack.dry_run_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createFocusStack'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: ['computational_merge_apply_requested', 'computational_merge_apply_completed'],
        description:
          'Apply an accepted local focus stack dry-run plan into the non-destructive edit graph after approval.',
        executionMode: 'apply_dry_run_plan',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeMutationResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.focus_stack.apply_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createFocusStack'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: [
          'computational_merge_derived_source_open_requested',
          'computational_merge_derived_source_open_completed',
        ],
        description:
          'Open an approved focus stack output as an editable derived source after receipt and stale-state validation.',
        executionMode: 'open_derived_source',
        inputSchemaName: 'ComputationalMergeDerivedSourceOpenRequestV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeDerivedSourceOpenResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.focus_stack.open_derived_source',
      },
      {
        allowedCommandTypes: ['computationalMerge.createSuperResolution'],
        approvalClass: ApprovalClass.PreviewOnly,
        auditEvents: ['computational_merge_dry_run_requested', 'computational_merge_dry_run_completed'],
        description:
          'Preview a local multi-image super-resolution merge and return a non-mutating dry-run plan with artifact handles.',
        executionMode: 'dry_run_command',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: false,
        outputSchemaName: 'ComputationalMergeDryRunResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: false,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.super_resolution.dry_run_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createSuperResolution'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: ['computational_merge_apply_requested', 'computational_merge_apply_completed'],
        description:
          'Apply an accepted local super-resolution dry-run plan into the non-destructive edit graph after approval.',
        executionMode: 'apply_dry_run_plan',
        inputSchemaName: 'ComputationalMergeCommandEnvelopeV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeMutationResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.super_resolution.apply_command',
      },
      {
        allowedCommandTypes: ['computationalMerge.createSuperResolution'],
        approvalClass: ApprovalClass.EditApply,
        auditEvents: [
          'computational_merge_derived_source_open_requested',
          'computational_merge_derived_source_open_completed',
        ],
        description:
          'Open an approved super-resolution output as an editable derived source after receipt and stale-state validation.',
        executionMode: 'open_derived_source',
        inputSchemaName: 'ComputationalMergeDerivedSourceOpenRequestV1',
        localOnly: true,
        mutates: true,
        outputSchemaName: 'ComputationalMergeDerivedSourceOpenResultV1',
        recordsProvenance: true,
        requiresDryRunPlan: true,
        returnsArtifactHandles: true,
        toolName: 'computationalmerge.super_resolution.open_derived_source',
      },
    ],
  });
