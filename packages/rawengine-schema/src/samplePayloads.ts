import {
  ActorKind,
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  panoramaArtifactV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
  type ArtifactHandleV1,
  type CommandEnvelopeV1,
  type PanoramaArtifactV1,
  type QueryEnvelopeV1,
  type RawEngineToolRegistryV1,
} from './rawEngineSchemas.js';

export const sampleQueryEnvelopeV1: QueryEnvelopeV1 = queryEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_sample',
  },
  correlationId: 'corr_metadata_sample',
  parameters: {
    includeExif: true,
  },
  queryId: 'query_metadata_sample',
  queryType: 'image.getMetadata',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
  },
});

export const sampleCommandEnvelopeV1: CommandEnvelopeV1 = commandEnvelopeV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_sample',
  },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Tone dry-run does not persist sidecars or exported files.',
    state: 'not_required',
  },
  commandId: 'command_tone_dry_run_sample',
  commandType: 'edit.tone.dryRun',
  correlationId: 'corr_tone_dry_run_sample',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_42',
  parameters: {
    exposureEv: 0.25,
    highlights: -12,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_0001.CR3',
    kind: 'image',
    virtualCopyId: null,
  },
});

export const sampleArtifactHandleV1: ArtifactHandleV1 = artifactHandleV1Schema.parse({
  artifactId: 'artifact_preview_sample',
  contentHash: 'sha256:sample-preview-hash',
  dimensions: {
    height: 1080,
    width: 1620,
  },
  kind: 'preview',
  storage: 'temp_cache',
});

export const sampleToolRegistryV1: RawEngineToolRegistryV1 = rawEngineToolRegistryV1Schema.parse({
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  tools: [
    {
      approvalClass: ApprovalClass.SafeRead,
      inputSchemaName: 'QueryEnvelopeV1',
      mutates: false,
      outputSchemaName: 'ImageMetadataResultV1',
      requiresDryRun: false,
      returnsArtifactHandles: false,
      toolKind: 'read',
      toolName: 'image.get_metadata',
    },
    {
      approvalClass: ApprovalClass.PreviewOnly,
      inputSchemaName: 'CommandEnvelopeV1',
      mutates: false,
      outputSchemaName: 'ToneDryRunResultV1',
      requiresDryRun: true,
      returnsArtifactHandles: true,
      toolKind: 'dry_run',
      toolName: 'edit.dry_run_tone',
    },
  ],
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
    capabilities: {
      adaptiveSeamFeather: true,
      autoCrop: false,
      bundleAdjustment: false,
      cylindricalProjection: false,
      exposureNormalization: false,
      planarHomography: true,
      tiledRender: false,
    },
    engineId: 'rapidraw_homography_seam_v0',
    qualityTier: 'legacy_local_preview',
  },
  exposureNormalization: {
    mode: 'planned',
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
    runtimeStatus: 'schema_only',
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
