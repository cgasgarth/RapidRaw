import { z } from 'zod';
import {
  artifactHandleV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  type ComputationalMergePreflightWarningCodeV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type PanoramaArtifactV1,
  type PanoramaBackendCapabilityReportV1,
  type PanoramaBackendIdV1,
  panoramaArtifactV1Schema,
  panoramaBackendCapabilityReportV1Schema,
  panoramaBackendIdV1Schema,
  panoramaEngineCapabilitiesV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../rawEngineSchemas.js';
import {
  buildPanoramaHomographyDltDiagnosticsV1,
  type PanoramaHomographyPointPairV1,
  panoramaHomographyDltDiagnosticsV1Schema,
} from './panoramaHomographyDiagnostics.js';
import { type PanoramaSyntheticSourceFrameV1, renderSyntheticPanoramaStitchV1 } from './panoramaSyntheticStitch.js';

const PANORAMA_RUNTIME_ENGINE_ID = 'rawengine_panorama_synthetic_v1';
const PANORAMA_RUNTIME_ENGINE_VERSION = '0.1.0';
const PANORAMA_DEFAULT_BACKEND_ID: PanoramaBackendIdV1 = 'rapidraw_homography_seam_v0';
const PANORAMA_CYCLE_RESIDUAL_THRESHOLD_PX = 2;
const PANORAMA_TILE_BYTES_PER_RGB_PIXEL = 3;
const PANORAMA_TILE_BYTES_PER_RGBA_PIXEL = 4;
const panoramaBackendCapabilityReportsV1 = [
  panoramaBackendCapabilityReportV1Schema.parse({
    backendId: 'rapidraw_homography_seam_v0',
    backendVersion: PANORAMA_RUNTIME_ENGINE_VERSION,
    capabilities: {
      adaptiveSeamFeather: true,
      autoCrop: true,
      bundleAdjustment: false,
      cylindricalProjection: true,
      exposureNormalization: true,
      planarHomography: true,
      tiledRender: true,
    },
    ciPolicy: {
      defaultRequiredCiAllowed: true,
      requiredCiBlockers: [],
      suggestedCiTier: 'required_pr',
    },
    limits: {
      maxRecommendedOutputPixels: 36_000_000,
      maxRecommendedPeakMemoryBytes: 2_400_000_000,
      maxRecommendedSourceCount: 6,
    },
    macosPackagingStatus: 'not_required',
    qualityTier: 'validated_planar_v1',
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
    supportedBlendModes: ['feather', 'multi_band'],
    supportedBoundaryModes: ['auto_crop', 'transparent', 'manual_crop'],
    supportedExposureModes: ['none', 'gain_offset_v1'],
    supportedProjections: ['rectilinear', 'planar', 'cylindrical'],
    supportedSeamMethods: ['adaptive_dp_feather_v1'],
    warnings: [],
  }),
  panoramaBackendCapabilityReportV1Schema.parse({
    backendId: 'opencv_stitching_spike',
    backendVersion: 'spike-unbundled',
    capabilities: {
      adaptiveSeamFeather: true,
      autoCrop: true,
      bundleAdjustment: true,
      cylindricalProjection: true,
      exposureNormalization: true,
      planarHomography: true,
      tiledRender: false,
    },
    ciPolicy: {
      defaultRequiredCiAllowed: false,
      requiredCiBlockers: ['opencv_packaging_not_promoted'],
      suggestedCiTier: 'manual_spike',
    },
    limits: {
      maxRecommendedOutputPixels: 24_000_000,
      maxRecommendedPeakMemoryBytes: 3_200_000_000,
      maxRecommendedSourceCount: 8,
    },
    macosPackagingStatus: 'unproven',
    qualityTier: 'optional_spike',
    runtimeRequirements: {
      externalLibraries: ['opencv'],
      requiresExternalLibraries: true,
      requiresNetworkAtRuntime: false,
    },
    schemaBoundary: {
      backendTypesLeakIntoArtifacts: false,
      rawEngineCapabilityNamesOnly: true,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    status: 'optional_spike',
    supportedBlendModes: ['feather', 'multi_band'],
    supportedBoundaryModes: ['auto_crop', 'transparent'],
    supportedExposureModes: ['none', 'opencv_gain', 'opencv_gain_blocks'],
    supportedProjections: ['rectilinear', 'planar', 'cylindrical', 'spherical'],
    supportedSeamMethods: ['opencv_graph_cut_color', 'opencv_dp_color', 'opencv_voronoi'],
    warnings: ['external_dependency', 'packaging_unproven', 'required_ci_not_ready'],
  }),
  panoramaBackendCapabilityReportV1Schema.parse({
    backendId: 'hugin_reference_tool',
    backendVersion: 'reference-only',
    capabilities: {
      adaptiveSeamFeather: false,
      autoCrop: true,
      bundleAdjustment: true,
      cylindricalProjection: true,
      exposureNormalization: true,
      planarHomography: true,
      tiledRender: false,
    },
    ciPolicy: {
      defaultRequiredCiAllowed: false,
      requiredCiBlockers: ['reference_tool_not_packaged'],
      suggestedCiTier: 'manual_spike',
    },
    limits: {
      maxRecommendedOutputPixels: 24_000_000,
      maxRecommendedPeakMemoryBytes: 3_200_000_000,
      maxRecommendedSourceCount: 8,
    },
    macosPackagingStatus: 'unproven',
    qualityTier: 'reference_only',
    runtimeRequirements: {
      externalLibraries: ['hugin'],
      requiresExternalLibraries: true,
      requiresNetworkAtRuntime: false,
    },
    schemaBoundary: {
      backendTypesLeakIntoArtifacts: false,
      rawEngineCapabilityNamesOnly: true,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    status: 'reference_only',
    supportedBlendModes: ['feather'],
    supportedBoundaryModes: ['auto_crop', 'transparent'],
    supportedExposureModes: ['none', 'planned'],
    supportedProjections: ['rectilinear', 'planar', 'cylindrical', 'spherical'],
    supportedSeamMethods: ['overwrite_fallback'],
    warnings: ['external_dependency', 'packaging_unproven', 'required_ci_not_ready'],
  }),
] satisfies PanoramaBackendCapabilityReportV1[];

const panoramaBackendSelectionReceiptV1Schema = z
  .object({
    capabilityEvidence: z
      .object({
        consideredBackends: z.array(
          z
            .object({
              backendId: panoramaBackendIdV1Schema,
              qualityTier: z.enum(['legacy_local_preview', 'validated_planar_v1', 'optional_spike', 'reference_only']),
              requiredCiBlockerCount: z.number().int().nonnegative(),
              status: z.enum(['default_enabled', 'optional_spike', 'reference_only', 'disabled']),
              warnings: z.array(
                z.enum([
                  'backend_types_must_not_escape',
                  'external_dependency',
                  'packaging_unproven',
                  'required_ci_not_ready',
                ]),
              ),
            })
            .strict(),
        ),
        requestedBackendStatus: z
          .enum(['default_enabled', 'optional_spike', 'reference_only', 'disabled', 'not_requested'])
          .optional(),
        requestedRequiresExternalLibraries: z.boolean().nullable(),
        selectedBackendCapabilities: panoramaEngineCapabilitiesV1Schema,
        selectedBackendQualityTier: z.enum([
          'legacy_local_preview',
          'validated_planar_v1',
          'optional_spike',
          'reference_only',
        ]),
        selectedBackendStatus: z.enum(['default_enabled', 'optional_spike', 'reference_only', 'disabled']),
        selectedSupportedBlendModes: z.array(z.enum(['overwrite', 'feather', 'multi_band'])).min(1),
        selectedSupportedProjections: z.array(z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar'])).min(1),
      })
      .strict(),
    fallbackReason: z.enum(['requested_backend_unavailable']).nullable(),
    requestedBackendId: z.union([z.literal('auto'), panoramaBackendIdV1Schema]),
    selectedBackendId: panoramaBackendIdV1Schema,
    selectionStatus: z.enum(['auto_default', 'requested_available', 'fallback']),
  })
  .strict();

export const panoramaRuntimeSourceFrameV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    expectedOffsetX: z.number().int().nonnegative().nullable(),
    expectedOffsetY: z.number().int().nullable(),
    graphRevision: z.string().trim().min(1),
    height: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const panoramaRuntimePlanRequestV1Schema = z
  .object({
    artifactCreatedAt: z.iso.datetime({ offset: true }).optional(),
    candidateTransformOverrides: z
      .array(
        z
          .object({
            fromSourceIndex: z.number().int().nonnegative(),
            reason: z.literal('synthetic_cycle_inconsistency_fixture'),
            toSourceIndex: z.number().int().nonnegative(),
            translationPx: z
              .object({
                x: z.number().int(),
                y: z.number().int(),
              })
              .strict(),
          })
          .strict(),
      )
      .default([]),
    command: computationalMergeCommandEnvelopeV1Schema,
    connectedSourceIndices: z.array(z.number().int().nonnegative()).min(1),
    outputArtifactId: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    seed: z.string().trim().min(1),
    sourceFrames: z.array(panoramaRuntimeSourceFrameV1Schema).min(2),
  })
  .strict();

export const panoramaRuntimeProvenanceV1Schema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
    acceptedDryRunPlanId: z.string().trim().min(1).optional(),
    alignment: z
      .object({
        algorithmId: z.literal('synthetic_offset_translation_v1'),
        graph: z
          .object({
            candidateEdgeCount: z.number().int().nonnegative(),
            cycleConsistency: z
              .object({
                rejectedEdgeCount: z.number().int().nonnegative(),
                rejectedEdges: z.array(
                  z
                    .object({
                      fromSourceIndex: z.number().int().nonnegative(),
                      qualityRank: z.number().int().positive(),
                      reason: z.literal('cycle_residual_exceeded'),
                      residualPx: z.number().nonnegative(),
                      toSourceIndex: z.number().int().nonnegative(),
                    })
                    .strict(),
                ),
                residualThresholdPx: z.number().positive(),
                validationMode: z.literal('translation_cycle_residual_v1'),
              })
              .strict(),
            referenceSelectionReason: z.literal('projected_center_source'),
            referenceSourceIndex: z.number().int().nonnegative(),
            selectedEdgeCount: z.number().int().nonnegative(),
            selectedEdges: z.array(
              z
                .object({
                  fromSourceIndex: z.number().int().nonnegative(),
                  overlapAreaPx: z.number().int().nonnegative(),
                  qualityRank: z.number().int().positive(),
                  qualityScore: z.number(),
                  toSourceIndex: z.number().int().nonnegative(),
                })
                .strict(),
            ),
            selectionMode: z.literal('quality_ranked_spanning_graph_v1'),
          })
          .strict(),
        pairwiseMatches: z.array(
          z
            .object({
              fromSourceIndex: z.number().int().nonnegative(),
              overlapAreaPx: z.number().int().nonnegative(),
              reprojectionErrorPx: z.number().nonnegative(),
              toSourceIndex: z.number().int().nonnegative(),
              translationPx: z
                .object({
                  x: z.number().int(),
                  y: z.number().int(),
                })
                .strict(),
              dltDiagnostics: panoramaHomographyDltDiagnosticsV1Schema,
            })
            .strict(),
        ),
      })
      .strict(),
    backendSelection: panoramaBackendSelectionReceiptV1Schema,
    boundaryMode: z.enum(['auto_crop', 'transparent', 'manual_crop', 'deferred_fill']),
    crop: z
      .object({
        height: z.number().int().positive(),
        mode: z.enum(['none', 'auto', 'manual']),
        width: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
      })
      .strict(),
    engineId: z.literal(PANORAMA_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(PANORAMA_RUNTIME_ENGINE_VERSION),
    exposureNormalization: z.enum(['none', 'auto', 'gain_compensation']),
    exposureNormalizationResult: z
      .object({
        appliedGainCount: z.number().int().nonnegative().optional(),
        appliedLuminanceGains: z
          .array(
            z
              .object({
                gain: z.number().positive(),
                sourceIndex: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .optional(),
        compensationStrengthPercent: z.number().int().min(0).max(100).optional(),
        mode: z.enum(['none', 'scalar_overlap_luminance_gain_v1']),
        overlapMetrics: z
          .object({
            medianLogLuminanceDeltaAfter: z.number().nonnegative().optional(),
            medianLogLuminanceDeltaBefore: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
        skippedReason: z.enum(['insufficient_overlap', 'not_requested']).optional(),
        support: z.literal('implemented_current_engine'),
      })
      .strict(),
    excludedSourceCount: z.number().int().nonnegative(),
    lensCorrectionPolicy: z.enum(['unchanged', 'required_before_stitch', 'applied_before_stitch']),
    projectedBounds: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
        x: z.number().int(),
        y: z.number().int(),
      })
      .strict(),
    projection: z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar']),
    projectionSettings: z
      .object({
        deferredReason: z.string().trim().min(1).optional(),
        effectiveProjection: z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar']),
        horizontalFovDegrees: z.number().positive().max(360).optional(),
        requestedProjection: z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar']),
        support: z.enum(['implemented_current_engine', 'schema_only_deferred']),
      })
      .strict(),
    qualityMetrics: z
      .object({
        cropCoverageRatio: z.number().min(0).max(1),
        meanOverlapAreaPx: z.number().nonnegative(),
        outputPixelCount: z.number().int().positive(),
        sourcePixelCount: z.number().int().positive(),
        stitchedSourceRatio: z.number().min(0).max(1),
      })
      .strict(),
    resolvedProjection: z.enum(['rectilinear', 'cylindrical', 'planar']),
    runtimeStatus: z.enum(['dry_run_rendered', 'apply_rendered']),
    seamBlend: z
      .object({
        blendMode: z.enum(['feather', 'multi_band']),
        overlapFeatherPx: z.number().int().min(0).max(512),
        seamMethod: z.enum(['adaptive_feather']),
      })
      .strict(),
    seamReview: z
      .object({
        blockedReasons: z.array(z.string().trim().min(1)),
        contributionMapArtifact: artifactHandleV1Schema,
        disconnectedSourceIndices: z.array(z.number().int().nonnegative()),
        nextActions: z.array(
          z.enum(['adjust_source_selection', 'approve_plan', 'inspect_seams', 'reduce_projection_scope']),
        ),
        overlapEdgeCount: z.number().int().nonnegative(),
        reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
        seamMaskArtifact: artifactHandleV1Schema,
        overlapConfidence: z
          .object({
            edgeCount: z.number().int().nonnegative(),
            level: z.enum(['high', 'medium', 'low', 'blocked']),
            meanConfidenceScore: z.number().min(0).max(1),
            minimumConfidenceScore: z.number().min(0).max(1),
            minimumOverlapRatio: z.number().min(0).max(1),
            weakEdgeCount: z.number().int().nonnegative(),
          })
          .strict(),
        seamRisk: z.enum(['low', 'medium', 'high']),
        seamWarningState: z
          .object({
            parallaxRisk: z.enum(['low', 'medium', 'high']),
            state: z.enum(['clear', 'warning', 'blocked']),
            warningCodes: z.array(z.string().trim().min(1)),
          })
          .strict(),
        warnings: z.array(z.string().trim().min(1)),
        weakOverlapEdgeCount: z.number().int().nonnegative(),
      })
      .strict(),
    sourceGeometry: z
      .object({
        blockedReasons: z.array(z.string().trim().min(1)),
        columnCountEstimate: z.number().int().positive(),
        connectedComponentCount: z.number().int().positive(),
        graphConnectivity: z
          .object({
            connectedSourceCount: z.number().int().nonnegative(),
            disconnectedSourceCount: z.number().int().nonnegative(),
            edgeCount: z.number().int().nonnegative(),
            isConnected: z.boolean(),
          })
          .strict(),
        layout: z.enum(['grid_like', 'multi_row_candidate', 'single_row', 'unknown']),
        layoutConfidence: z
          .object({
            columnConfidence: z.number().min(0).max(1),
            overallConfidence: z.number().min(0).max(1),
            rowConfidence: z.number().min(0).max(1),
          })
          .strict(),
        selectedComponent: z
          .object({
            sourceCount: z.number().int().positive(),
            sourceIndices: z.array(z.number().int().nonnegative()),
          })
          .strict(),
        rowCountEstimate: z.number().int().positive(),
        support: z.enum(['blocked_requires_multi_row_solver', 'implemented_current_engine', 'unverified']),
        verticalSpanPx: z.number().int().nonnegative(),
        horizontalSpanPx: z.number().int().nonnegative(),
        warningCodes: z.array(
          z.enum([
            'geometry_overclaim_guardrail',
            'graph_disconnected',
            'grid_like_geometry_unverified',
            'multi_row_runtime_deferred',
            'single_row_geometry_low_confidence',
            'source_geometry_unverified',
          ]),
        ),
      })
      .strict(),
    sourceState: z.array(
      z
        .object({
          contentHash: z.string().trim().min(1),
          graphRevision: z.string().trim().min(1),
          sourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    stitchedSourceCount: z.number().int().positive(),
    tileRender: z
      .object({
        maxTileHeightPx: z.number().int().positive(),
        maxTileWidthPx: z.number().int().positive(),
        seamHaloPx: z.number().int().nonnegative(),
        tileBackedRender: z.literal(true),
        tileCount: z.number().int().min(2),
        tileSizePx: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type PanoramaRuntimeSourceFrameV1 = z.infer<typeof panoramaRuntimeSourceFrameV1Schema>;
export type PanoramaRuntimePlanRequestV1 = z.infer<typeof panoramaRuntimePlanRequestV1Schema>;
export type PanoramaRuntimeProvenanceV1 = z.infer<typeof panoramaRuntimeProvenanceV1Schema>;
type PanoramaRuntimeCommandV1 = Extract<
  ComputationalMergeCommandEnvelopeV1,
  { commandType: 'computationalMerge.createPanorama' }
>;
type ParsedPanoramaRuntimePlanRequestV1 = Omit<PanoramaRuntimePlanRequestV1, 'command'> & {
  command: PanoramaRuntimeCommandV1;
};

export interface PanoramaRuntimeDryRunResultV1 {
  dryRunResult: ComputationalMergeDryRunResultV1;
  outputPixels: Uint8Array;
  provenance: PanoramaRuntimeProvenanceV1;
}

export interface PanoramaRuntimeApplyResultV1 {
  mutationResult: ComputationalMergeMutationResultV1;
  outputPixels: Uint8Array;
  provenance: PanoramaRuntimeProvenanceV1;
  sidecarArtifact: PanoramaArtifactV1;
}

export interface PanoramaRuntimeArtifactInputV1 {
  applyResult: Pick<PanoramaRuntimeApplyResultV1, 'mutationResult' | 'provenance'>;
  command: PanoramaRuntimeCommandV1;
  createdAt: string;
  previewArtifacts?: ComputationalMergeDryRunResultV1['previewArtifacts'];
}

export const buildPanoramaRuntimeDryRunV1 = (requestValue: unknown): PanoramaRuntimeDryRunResultV1 => {
  const request = parsePanoramaRuntimePlanRequest(requestValue, true);
  const runtime = renderPanoramaRuntime(request);
  const planId = `panorama_plan_${request.command.commandId}`;
  const planHash = `sha256:${stablePanoramaRuntimeHash(
    [
      planId,
      runtime.provenance.resolvedProjection,
      JSON.stringify(runtime.provenance.backendSelection),
      request.command.parameters.seamExposureCompensationPercent,
      request.command.parameters.overlapFeatherPx ?? 64,
      JSON.stringify(runtime.provenance.crop),
      JSON.stringify(runtime.provenance.tileRender),
    ].join(':'),
  )}`;
  const renderedContentHash = hashPanoramaRuntimePixels(runtime.outputPixels);
  const previewArtifacts = buildPanoramaRuntimeSeamPreviewArtifacts({
    planHash,
    previewArtifactId: request.previewArtifactId,
    provenance: runtime.provenance,
    renderedContentHash,
  });

  const dryRunResult = computationalMergeDryRunResultV1Schema.parse({
    commandId: request.command.commandId,
    commandType: request.command.commandType,
    correlationId: request.command.correlationId,
    dryRun: true,
    mergePlan: {
      family: 'panorama',
      outputDimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      outputName: request.command.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: buildPanoramaPreflightEstimate(request, runtime.width, runtime.height)
          .memoryComponents.totalEstimatedPeakBytes,
        estimatedRuntimeMs: 1,
        requiresBackgroundJob: false,
      },
      planId,
      preflight: buildPanoramaPreflightEstimate(request, runtime.width, runtime.height),
      qualityMetrics: {
        overlapCoverageRatio: 1,
        sourceCount: request.sourceFrames.length,
      },
      sourceImageRefs: request.command.parameters.sources,
      warnings: runtime.warnings,
    },
    mutates: false,
    predictedGraphRevision: `${request.command.expectedGraphRevision}:panorama-preview`,
    previewArtifacts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: request.command.expectedGraphRevision,
    warnings: runtime.warnings,
  });

  return {
    dryRunResult,
    outputPixels: runtime.outputPixels,
    provenance: runtime.provenance,
  };
};

export const applyPanoramaRuntimePlanV1 = (requestValue: unknown): PanoramaRuntimeApplyResultV1 => {
  const request = parsePanoramaRuntimePlanRequest(requestValue, false);
  const runtime = renderPanoramaRuntime(request);
  const acceptedDryRunPlanHash = request.command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = request.command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('Panorama runtime apply requires an accepted dry-run plan id and hash.');
  }
  if (runtime.provenance.seamReview.reviewStatus === 'blocked') {
    throw new Error(
      `Panorama runtime apply blocked by seam review: ${runtime.provenance.seamReview.blockedReasons.join(', ')}.`,
    );
  }

  const outputArtifacts = [
    {
      artifactId: request.outputArtifactId,
      contentHash: `sha256:${stablePanoramaRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.outputArtifactId}:${hashPanoramaRuntimePixels(runtime.outputPixels)}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'merge_output' as const,
      storage: 'sidecar_artifact' as const,
    },
  ];

  const mutationResult = computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: `${request.command.expectedGraphRevision}:panorama-apply`,
    changedNodeIds: [`node_${request.command.commandId}`],
    commandId: request.command.commandId,
    commandType: request.command.commandType,
    correlationId: request.command.correlationId,
    derivedAssetId: `derived_${request.command.commandId}`,
    dryRun: false,
    mutates: true,
    outputArtifacts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: request.command.expectedGraphRevision,
    undoRevision: `${request.command.expectedGraphRevision}:undo-panorama-apply`,
    warnings: runtime.warnings,
  });
  const provenance = panoramaRuntimeProvenanceV1Schema.parse({
    ...runtime.provenance,
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    runtimeStatus: 'apply_rendered',
  });

  return {
    mutationResult,
    outputPixels: runtime.outputPixels,
    provenance,
    sidecarArtifact: buildPanoramaRuntimeArtifactV1({
      applyResult: {
        mutationResult,
        provenance,
      },
      command: request.command,
      createdAt: request.artifactCreatedAt ?? new Date(0).toISOString(),
      previewArtifacts: buildPanoramaRuntimeSeamPreviewArtifacts({
        planHash: acceptedDryRunPlanHash,
        previewArtifactId: request.previewArtifactId,
        provenance,
        renderedContentHash: hashPanoramaRuntimePixels(runtime.outputPixels),
      }),
    }),
  };
};

export const buildPanoramaRuntimeArtifactV1 = ({
  applyResult,
  command,
  createdAt,
  previewArtifacts = [],
}: PanoramaRuntimeArtifactInputV1): PanoramaArtifactV1 => {
  const { mutationResult, provenance } = applyResult;
  const sourceImageRefs = sourceImageRefsForPanoramaRuntimeArtifact(command, provenance);
  const excludedSources = sourceImageRefs
    .filter((source) => !provenance.sourceState.some((sourceState) => sourceState.sourceIndex === source.sourceIndex))
    .map((source) => ({
      reason: 'source_excluded' as const,
      sourceIndex: source.sourceIndex,
    }));

  return panoramaArtifactV1Schema.parse({
    alignment: alignmentForPanoramaRuntimeArtifact(provenance),
    artifactId: `artifact_${mutationResult.derivedAssetId}`,
    boundaryMode: provenance.boundaryMode,
    boundarySettings: boundarySettingsForPanoramaRuntimeArtifact(provenance),
    createdAt,
    crop: provenance.crop,
    excludedSources,
    engine: {
      capabilities: {
        adaptiveSeamFeather: true,
        autoCrop: true,
        bundleAdjustment: false,
        cylindricalProjection: true,
        exposureNormalization: true,
        planarHomography: true,
        tiledRender: provenance.tileRender.tileBackedRender,
      },
      engineId: provenance.backendSelection.selectedBackendId,
      qualityTier: provenance.backendSelection.capabilityEvidence.selectedBackendQualityTier,
    },
    exposureNormalization: exposureNormalizationForPanoramaRuntimeArtifact(provenance),
    lensCorrectionPolicy: provenance.lensCorrectionPolicy,
    operationId: 'merge.panorama.create',
    operationVersion: 1,
    outputArtifacts: mutationResult.outputArtifacts,
    outputColorSpace: 'linear_rec2020_d65_v1',
    previewArtifacts,
    projection: provenance.resolvedProjection,
    projectionSettings: projectionSettingsForPanoramaRuntimeArtifact(provenance),
    provenance: {
      commandId: mutationResult.commandId,
      graphRevision: mutationResult.appliedGraphRevision,
      runtimeStatus: 'rendered',
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    seamPolicy: {
      featherWidthPx: provenance.seamBlend.overlapFeatherPx,
      lowDetailFeatherMultiplier: 5,
      mode: 'adaptive_dp_feather_v1',
    },
    sourceImageRefs,
    sourceState: provenance.sourceState,
    staleState: {
      checkedAt: createdAt,
      invalidationReasons: [],
      state: 'current',
    },
    validationMetrics: {
      excludedSourceCount: excludedSources.length,
      overlapCoverageRatio: provenance.qualityMetrics.stitchedSourceRatio,
      outputHeight: provenance.crop.height,
      outputWidth: provenance.crop.width,
      reprojectionRmsPx: meanPanoramaRuntimeReprojectionError(provenance),
      sourceCount: sourceImageRefs.length,
      stitchedSourceCount: provenance.stitchedSourceCount,
      tileCount: provenance.tileRender.tileCount,
    },
    warnings: mutationResult.warnings.filter(isPanoramaArtifactWarning),
  });
};

const parsePanoramaRuntimePlanRequest = (
  requestValue: unknown,
  dryRun: boolean,
): ParsedPanoramaRuntimePlanRequestV1 => {
  const request = panoramaRuntimePlanRequestV1Schema.parse(requestValue);
  if (!isPanoramaRuntimeCommand(request.command)) {
    throw new Error('Panorama runtime plan only supports computationalMerge.createPanorama commands.');
  }
  if (request.command.dryRun !== dryRun) {
    throw new Error(`Panorama runtime plan expected dryRun=${String(dryRun)}.`);
  }

  const frameIndexes = new Set(request.sourceFrames.map((frame) => frame.sourceIndex));
  for (const source of request.command.parameters.sources) {
    if (!frameIndexes.has(source.sourceIndex)) {
      throw new Error(`Panorama runtime plan missing frame for command source ${source.sourceIndex}.`);
    }
  }

  return { ...request, command: request.command };
};

const renderPanoramaRuntime = (request: ParsedPanoramaRuntimePlanRequestV1) => {
  const alignment = buildPanoramaRuntimeAlignment(
    request.sourceFrames,
    request.connectedSourceIndices,
    request.candidateTransformOverrides,
  );
  const backendSelection = buildPanoramaBackendSelectionReceipt(request.command.parameters.backendPreference);
  const sourceGeometry = classifyPanoramaSourceGeometry(request.sourceFrames, request.connectedSourceIndices);
  const stitched = renderSyntheticPanoramaStitchV1({
    connectedSourceIndices: request.connectedSourceIndices,
    exposureNormalization: request.command.parameters.exposureNormalization,
    expectedWarningCodes: expectedWarningsForCommand(request.command),
    fixtureId: `panorama.runtime.${request.command.commandId}.v1`,
    memoryBudgetBytes: request.command.parameters.memoryBudgetBytes ?? 4_000_000_000,
    projection: resolvePanoramaRuntimeProjection(request.command.parameters.projection),
    seed: request.seed,
    seamHaloPx: buildPanoramaRuntimeSeamHaloPx(request.command, alignment),
    seamExposureCompensationPercent: request.command.parameters.seamExposureCompensationPercent,
    sourceFrames: request.sourceFrames.map((frame) => toSyntheticSourceFrame(frame, request.command)),
  });
  if (stitched.outputPixels === null) {
    throw new Error('Panorama runtime plan expected renderable synthetic output pixels.');
  }
  const crop = buildPanoramaRuntimeCrop(
    request.command.parameters.boundaryMode,
    stitched.output.width,
    stitched.output.height,
    request.command.parameters.manualCropInsetsPercent,
  );
  const croppedOutput = cropPanoramaRuntimePixels(stitched.outputPixels, stitched.output.width, crop);
  const seamReview = buildPanoramaSeamReview(request, alignment, sourceGeometry, crop.width, crop.height);
  const warnings = [...new Set([...stitched.warningCodes, ...seamReview.warnings])].sort();

  return {
    height: crop.height,
    outputPixels: croppedOutput,
    provenance: panoramaRuntimeProvenanceV1Schema.parse({
      alignment,
      backendSelection,
      boundaryMode: request.command.parameters.boundaryMode,
      crop,
      engineId: PANORAMA_RUNTIME_ENGINE_ID,
      engineVersion: PANORAMA_RUNTIME_ENGINE_VERSION,
      exposureNormalization: request.command.parameters.exposureNormalization,
      exposureNormalizationResult: stitched.exposureNormalization,
      excludedSourceCount: stitched.excludedSourceCount,
      lensCorrectionPolicy: request.command.parameters.lensCorrectionPolicy,
      projectedBounds: {
        height: stitched.output.height,
        width: stitched.output.width,
        x: 0,
        y: Math.min(...request.sourceFrames.map((frame) => frame.expectedOffsetY ?? 0)),
      },
      projection: request.command.parameters.projection,
      projectionSettings: buildPanoramaRuntimeProjectionSettings(request.command.parameters.projection),
      qualityMetrics: buildPanoramaRuntimeQualityMetrics(
        request,
        stitched.output.width,
        stitched.output.height,
        alignment,
      ),
      resolvedProjection: resolvePanoramaRuntimeProjection(request.command.parameters.projection),
      runtimeStatus: 'dry_run_rendered',
      seamBlend: {
        blendMode: request.command.parameters.blendMode ?? 'feather',
        overlapFeatherPx: request.command.parameters.overlapFeatherPx ?? 64,
        seamMethod: 'adaptive_feather',
      },
      seamReview,
      sourceGeometry,
      sourceState: request.sourceFrames.map((frame) => ({
        contentHash: frame.contentHash,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
      stitchedSourceCount: stitched.stitchedSourceCount,
      tileRender: {
        ...stitched.tilePlan,
        tileBackedRender: true,
      },
    }),
    warnings,
    width: crop.width,
  };
};

const buildPanoramaBackendSelectionReceipt = (
  requestedBackendId: PanoramaRuntimeCommandV1['parameters']['backendPreference'],
) => {
  const selectedBackend = getPanoramaBackendCapabilityReport(PANORAMA_DEFAULT_BACKEND_ID);
  const requestedBackend =
    requestedBackendId === 'auto' ? undefined : getPanoramaBackendCapabilityReport(requestedBackendId);
  const requestedAvailable =
    requestedBackendId === 'auto' ||
    (requestedBackend?.status === 'default_enabled' &&
      requestedBackend.ciPolicy.defaultRequiredCiAllowed &&
      requestedBackend.runtimeRequirements.requiresExternalLibraries === false);
  const selectionStatus =
    requestedBackendId === 'auto' ? 'auto_default' : requestedAvailable ? 'requested_available' : 'fallback';

  return panoramaBackendSelectionReceiptV1Schema.parse({
    capabilityEvidence: {
      consideredBackends: panoramaBackendCapabilityReportsV1.map((report) => ({
        backendId: report.backendId,
        qualityTier: report.qualityTier,
        requiredCiBlockerCount: report.ciPolicy.requiredCiBlockers.length,
        status: report.status,
        warnings: report.warnings,
      })),
      requestedBackendStatus: requestedBackend?.status ?? (requestedBackendId === 'auto' ? 'not_requested' : undefined),
      requestedRequiresExternalLibraries: requestedBackend?.runtimeRequirements.requiresExternalLibraries ?? null,
      selectedBackendCapabilities: selectedBackend.capabilities,
      selectedBackendQualityTier: selectedBackend.qualityTier,
      selectedBackendStatus: selectedBackend.status,
      selectedSupportedBlendModes: selectedBackend.supportedBlendModes,
      selectedSupportedProjections: selectedBackend.supportedProjections,
    },
    fallbackReason: selectionStatus === 'fallback' ? 'requested_backend_unavailable' : null,
    requestedBackendId,
    selectedBackendId: selectedBackend.backendId,
    selectionStatus,
  });
};

const getPanoramaBackendCapabilityReport = (backendId: PanoramaBackendIdV1): PanoramaBackendCapabilityReportV1 => {
  const report = panoramaBackendCapabilityReportsV1.find((candidate) => candidate.backendId === backendId);
  if (report === undefined) throw new Error(`Missing panorama backend capability report for ${backendId}.`);
  return report;
};

const buildPanoramaPreflightEstimate = (request: ParsedPanoramaRuntimePlanRequestV1, width: number, height: number) => {
  const sourcePixelCount = request.sourceFrames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const sourceGeometry = classifyPanoramaSourceGeometry(request.sourceFrames, request.connectedSourceIndices);
  const outputPixelCount = width * height;
  const sourceDecodeBytes = sourcePixelCount * PANORAMA_TILE_BYTES_PER_RGBA_PIXEL;
  const tilePlan = estimatePanoramaRuntimeTilePlan(width, height, buildPanoramaRuntimeSeamHaloPx(request.command));
  const outputTileBufferBytes = tilePlan.maxTileWidthPx * tilePlan.maxTileHeightPx * PANORAMA_TILE_BYTES_PER_RGB_PIXEL;
  const outputTileMaskBytes = tilePlan.maxTileWidthPx * tilePlan.maxTileHeightPx;
  const tileCacheBytes = Math.min(outputPixelCount, tilePlan.tileCount * outputTileMaskBytes);
  const seamWorkspaceBytes =
    (tilePlan.maxTileWidthPx + tilePlan.seamHaloPx * 2) *
    (tilePlan.maxTileHeightPx + tilePlan.seamHaloPx * 2) *
    PANORAMA_TILE_BYTES_PER_RGBA_PIXEL;
  const previewBytes = outputPixelCount * PANORAMA_TILE_BYTES_PER_RGBA_PIXEL;
  const memoryComponents = {
    lowDetailMaskBytes: tileCacheBytes,
    outputCanvasBytes: outputTileBufferBytes,
    outputMaskBytes: outputTileMaskBytes,
    overheadBytes: 4096,
    previewBytes,
    seamWorkspaceBytes,
    sourceDecodeBytes,
    totalEstimatedPeakBytes:
      sourceDecodeBytes +
      outputTileBufferBytes +
      outputTileMaskBytes +
      tileCacheBytes +
      previewBytes +
      seamWorkspaceBytes +
      4096,
  };
  const memoryBudgetBytes =
    request.command.parameters.memoryBudgetBytes ?? Math.max(memoryComponents.totalEstimatedPeakBytes * 2, 1);
  const warningCodes: ComputationalMergePreflightWarningCodeV1[] = [...new Set(sourceGeometry.warningCodes)].sort();
  return {
    blockedReasons: sourceGeometry.blockedReasons,
    engineCapabilities: {
      fullFrameLegacy: false,
      maxPreviewDimensionPx: request.command.parameters.maxPreviewDimensionPx,
      planOnly: true,
      tileBackedRender: true,
    },
    executionMode: 'tile_backed_render',
    geometryEstimate: {
      outputPixelCount,
      projectedBounds: {
        height,
        width,
        x: 0,
        y: 0,
      },
      sourceCount: request.sourceFrames.length,
      sourcePixelCount,
    },
    memoryBudgetBytes,
    memoryBudgetRatio: memoryComponents.totalEstimatedPeakBytes / memoryBudgetBytes,
    memoryComponents,
    sourceGeometry,
    status:
      sourceGeometry.blockedReasons.length > 0 ? 'blocked_plan_only' : warningCodes.length > 0 ? 'warning' : 'accepted',
    tileCount: tilePlan.tileCount,
    warningCodes,
  };
};

const expectedWarningsForCommand = (command: PanoramaRuntimeCommandV1): string[] => {
  const warnings = new Set<string>();
  if (command.parameters.projection === 'spherical') warnings.add('projection_runtime_deferred');
  if (command.parameters.boundaryMode === 'deferred_fill') warnings.add('boundary_runtime_deferred');
  return [...warnings].sort();
};

const estimatePanoramaRuntimeTilePlan = (
  width: number,
  height: number,
  seamHaloPx: number,
): PanoramaRuntimeProvenanceV1['tileRender'] => {
  const tileSizePx = 512;
  const maxTileWidthPx = width > 1 ? Math.min(tileSizePx, Math.ceil(width / 2)) : 1;
  const maxTileHeightPx =
    height > 1 && width === 1 ? Math.min(tileSizePx, Math.ceil(height / 2)) : Math.min(tileSizePx, height);
  const columns = Math.max(1, Math.ceil(width / maxTileWidthPx));
  const rows = Math.max(1, Math.ceil(height / maxTileHeightPx));
  return {
    maxTileHeightPx,
    maxTileWidthPx,
    seamHaloPx,
    tileBackedRender: true,
    tileCount: columns * rows,
    tileSizePx,
  };
};

const buildPanoramaRuntimeSeamHaloPx = (
  command: PanoramaRuntimeCommandV1,
  alignment?: PanoramaRuntimeProvenanceV1['alignment'],
): number =>
  Math.max(command.parameters.overlapFeatherPx ?? 64, alignment ? panoramaRuntimeAlignmentResidualP95Px(alignment) : 0);

const panoramaRuntimeAlignmentResidualP95Px = (alignment: PanoramaRuntimeProvenanceV1['alignment']): number => {
  const residuals = alignment.pairwiseMatches
    .map((match) => match.reprojectionErrorPx)
    .toSorted((left, right) => left - right);
  if (residuals.length === 0) return 0;
  return Math.ceil(residuals[Math.min(residuals.length - 1, Math.floor(residuals.length * 0.95))] ?? 0);
};

const buildPanoramaRuntimeProjectionSettings = (
  requestedProjection: PanoramaRuntimeCommandV1['parameters']['projection'],
) => {
  const effectiveProjection = resolvePanoramaRuntimeProjection(requestedProjection);
  const support = requestedProjection === effectiveProjection ? 'implemented_current_engine' : 'schema_only_deferred';
  return {
    ...(support === 'schema_only_deferred'
      ? {
          deferredReason: 'Synthetic runtime currently renders non-planar panorama previews with rectilinear sampling.',
        }
      : {}),
    effectiveProjection,
    ...(effectiveProjection === 'cylindrical' ? { horizontalFovDegrees: 86 } : {}),
    requestedProjection,
    support,
  };
};

const resolvePanoramaRuntimeProjection = (
  requestedProjection: PanoramaRuntimeCommandV1['parameters']['projection'],
): 'rectilinear' | 'cylindrical' | 'planar' =>
  requestedProjection === 'planar' || requestedProjection === 'cylindrical' ? requestedProjection : 'rectilinear';

const buildPanoramaRuntimeCrop = (
  boundaryMode: PanoramaRuntimeCommandV1['parameters']['boundaryMode'],
  width: number,
  height: number,
  manualCropInsetsPercent?: PanoramaRuntimeCommandV1['parameters']['manualCropInsetsPercent'],
) => {
  const mode: PanoramaRuntimeProvenanceV1['crop']['mode'] =
    boundaryMode === 'transparent' || boundaryMode === 'deferred_fill'
      ? 'none'
      : boundaryMode === 'manual_crop'
        ? 'manual'
        : 'auto';
  if (mode !== 'manual') {
    return { height, mode, width, x: 0, y: 0 };
  }

  const insets = manualCropInsetsPercent ?? { bottom: 0, left: 0, right: 0, top: 0 };
  const x = Math.min(width - 1, Math.round((width * insets.left) / 100));
  const y = Math.min(height - 1, Math.round((height * insets.top) / 100));
  const right = Math.min(width - x - 1, Math.round((width * insets.right) / 100));
  const bottom = Math.min(height - y - 1, Math.round((height * insets.bottom) / 100));
  return {
    height: Math.max(1, height - y - bottom),
    mode,
    width: Math.max(1, width - x - right),
    x,
    y,
  };
};

const cropPanoramaRuntimePixels = (
  pixels: Uint8Array,
  sourceWidth: number,
  crop: PanoramaRuntimeProvenanceV1['crop'],
) => {
  if (crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height * crop.width * 3 === pixels.length) {
    return pixels;
  }

  const cropped = new Uint8Array(crop.width * crop.height * 3);
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * sourceWidth + crop.x) * 3;
    const sourceEnd = sourceStart + crop.width * 3;
    cropped.set(pixels.subarray(sourceStart, sourceEnd), row * crop.width * 3);
  }
  return cropped;
};

const buildPanoramaRuntimeAlignment = (
  sourceFrames: PanoramaRuntimeSourceFrameV1[],
  connectedSourceIndices: number[],
  candidateTransformOverrides: PanoramaRuntimePlanRequestV1['candidateTransformOverrides'],
) => {
  const framesByIndex = new Map(sourceFrames.map((frame) => [frame.sourceIndex, frame]));
  const connectedFrames = connectedSourceIndices.map((sourceIndex) => {
    const frame = framesByIndex.get(sourceIndex);
    if (frame === undefined) throw new Error(`Panorama runtime alignment missing source ${sourceIndex}.`);
    return frame;
  });
  const candidateEdges = buildPanoramaGraphCandidateEdges(connectedFrames, candidateTransformOverrides);
  const graphSelection = selectPanoramaSpanningGraphEdges(candidateEdges, connectedFrames);

  return {
    algorithmId: 'synthetic_offset_translation_v1' as const,
    graph: {
      candidateEdgeCount: candidateEdges.length,
      cycleConsistency: {
        rejectedEdgeCount: graphSelection.rejectedEdges.length,
        rejectedEdges: graphSelection.rejectedEdges.map(({ edge, qualityRank, residualPx }) => ({
          fromSourceIndex: edge.fromFrame.sourceIndex,
          qualityRank,
          reason: 'cycle_residual_exceeded' as const,
          residualPx,
          toSourceIndex: edge.toFrame.sourceIndex,
        })),
        residualThresholdPx: PANORAMA_CYCLE_RESIDUAL_THRESHOLD_PX,
        validationMode: 'translation_cycle_residual_v1' as const,
      },
      referenceSelectionReason: 'projected_center_source' as const,
      referenceSourceIndex: choosePanoramaReferenceSourceIndex(connectedFrames),
      selectedEdgeCount: graphSelection.selectedEdges.length,
      selectedEdges: graphSelection.selectedEdges.map(({ edge, qualityRank }) => ({
        fromSourceIndex: edge.fromFrame.sourceIndex,
        overlapAreaPx: edge.overlapAreaPx,
        qualityRank,
        qualityScore: edge.qualityScore,
        toSourceIndex: edge.toFrame.sourceIndex,
      })),
      selectionMode: 'quality_ranked_spanning_graph_v1' as const,
    },
    pairwiseMatches: graphSelection.selectedEdges.map(({ edge }) => buildPanoramaPairwiseMatch(edge)),
  };
};

type PanoramaSourceGeometry = PanoramaRuntimeProvenanceV1['sourceGeometry'];
type PanoramaSourceGeometryWarningCode = Extract<
  ComputationalMergePreflightWarningCodeV1,
  | 'geometry_overclaim_guardrail'
  | 'graph_disconnected'
  | 'grid_like_geometry_unverified'
  | 'multi_row_runtime_deferred'
  | 'single_row_geometry_low_confidence'
  | 'source_geometry_unverified'
>;

const classifyPanoramaSourceGeometry = (
  sourceFrames: PanoramaRuntimeSourceFrameV1[],
  connectedSourceIndices: number[],
): PanoramaSourceGeometry => {
  const connected = new Set(connectedSourceIndices);
  const connectedFrames = sourceFrames.filter((frame) => connected.has(frame.sourceIndex));
  if (connectedFrames.some((frame) => frame.expectedOffsetY === null || frame.expectedOffsetX === null)) {
    return {
      blockedReasons: [],
      columnCountEstimate: 1,
      connectedComponentCount: 1,
      graphConnectivity: {
        connectedSourceCount: connectedFrames.length,
        disconnectedSourceCount: sourceFrames.length - connectedFrames.length,
        edgeCount: 0,
        isConnected: false,
      },
      layout: 'unknown',
      layoutConfidence: {
        columnConfidence: 0,
        overallConfidence: 0,
        rowConfidence: 0,
      },
      selectedComponent: {
        sourceCount: connectedFrames.length,
        sourceIndices: connectedFrames.map((frame) => frame.sourceIndex),
      },
      rowCountEstimate: 1,
      support: 'unverified',
      verticalSpanPx: 0,
      horizontalSpanPx: 0,
      warningCodes: ['source_geometry_unverified'],
    };
  }

  const connectedSourceIndicesSorted = connectedFrames.map((frame) => frame.sourceIndex);
  const heights = connectedFrames.map((frame) => frame.height).toSorted((left, right) => left - right);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 1;
  const widths = connectedFrames.map((frame) => frame.width).toSorted((left, right) => left - right);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 1;
  const rowBreakThresholdPx = Math.max(12, Math.round(medianHeight * 0.35));
  const columnBreakThresholdPx = Math.max(12, Math.round(medianWidth * 0.35));
  const yOffsets = connectedFrames.map((frame) => frame.expectedOffsetY ?? 0).toSorted((left, right) => left - right);
  const xOffsets = connectedFrames.map((frame) => frame.expectedOffsetX ?? 0).toSorted((left, right) => left - right);
  const verticalSpanPx = Math.max(...yOffsets) - Math.min(...yOffsets);
  const horizontalSpanPx = Math.max(...xOffsets) - Math.min(...xOffsets);
  const rows = yOffsets.reduce<number[]>((rowStarts, yOffset) => {
    const previousRowStart = rowStarts.at(-1);
    if (previousRowStart === undefined || Math.abs(yOffset - previousRowStart) > rowBreakThresholdPx) {
      rowStarts.push(yOffset);
    }
    return rowStarts;
  }, []);
  const columns = xOffsets.reduce<number[]>((columnStarts, xOffset) => {
    const previousColumnStart = columnStarts.at(-1);
    if (previousColumnStart === undefined || Math.abs(xOffset - previousColumnStart) > columnBreakThresholdPx) {
      columnStarts.push(xOffset);
    }
    return columnStarts;
  }, []);
  const rowCountEstimate = Math.max(1, rows.length);
  const columnCountEstimate = Math.max(1, columns.length);
  const isGridLike = rowCountEstimate > 1 && columnCountEstimate > 1;
  const isMultiRowCandidate = !isGridLike && (rowCountEstimate > 1 || verticalSpanPx > rowBreakThresholdPx);
  const graphConnected = connectedFrames.length === sourceFrames.length;
  const coverageRatio = connectedFrames.length / Math.max(1, sourceFrames.length);
  const rowConfidence =
    connectedFrames.length <= 1
      ? 0
      : roundPanoramaRuntimeMetric(
          Math.max(0, Math.min(1, 1 - verticalSpanPx / Math.max(1, rowBreakThresholdPx * 3))) * coverageRatio,
        );
  const columnConfidence =
    connectedFrames.length <= 1
      ? 0
      : roundPanoramaRuntimeMetric(
          Math.max(
            0,
            Math.min(
              1,
              horizontalSpanPx / Math.max(1, columnBreakThresholdPx * Math.max(1, connectedFrames.length - 1)),
            ),
          ) * coverageRatio,
        );
  const overallConfidence = roundPanoramaRuntimeMetric(Math.min(coverageRatio, rowConfidence, columnConfidence));
  const support = isMultiRowCandidate
    ? 'blocked_requires_multi_row_solver'
    : graphConnected && !isGridLike && overallConfidence >= 0.6
      ? 'implemented_current_engine'
      : 'unverified';
  const warningCodes: PanoramaSourceGeometryWarningCode[] = [];
  if (!graphConnected) warningCodes.push('graph_disconnected');
  if (isGridLike) warningCodes.push('grid_like_geometry_unverified');
  if (!isGridLike && support === 'unverified' && rowCountEstimate === 1 && overallConfidence < 0.6) {
    warningCodes.push('single_row_geometry_low_confidence');
  }
  if (support !== 'implemented_current_engine') warningCodes.push('geometry_overclaim_guardrail');
  if (isMultiRowCandidate) warningCodes.push('multi_row_runtime_deferred');

  return {
    blockedReasons: isMultiRowCandidate ? ['multi_row_panorama_not_supported'] : [],
    columnCountEstimate,
    connectedComponentCount: graphConnected ? 1 : 2,
    graphConnectivity: {
      connectedSourceCount: connectedFrames.length,
      disconnectedSourceCount: sourceFrames.length - connectedFrames.length,
      edgeCount: Math.max(0, connectedFrames.length - 1),
      isConnected: graphConnected,
    },
    layout: isGridLike ? 'grid_like' : isMultiRowCandidate ? 'multi_row_candidate' : 'single_row',
    layoutConfidence: {
      columnConfidence,
      overallConfidence,
      rowConfidence,
    },
    selectedComponent: {
      sourceCount: connectedFrames.length,
      sourceIndices: connectedSourceIndicesSorted,
    },
    rowCountEstimate,
    support,
    verticalSpanPx,
    horizontalSpanPx,
    warningCodes: [...new Set(warningCodes)].sort(),
  };
};

interface PanoramaGraphCandidateEdge {
  fromFrame: PanoramaRuntimeSourceFrameV1;
  overlapAreaPx: number;
  qualityScore: number;
  reprojectionErrorPx: number;
  toFrame: PanoramaRuntimeSourceFrameV1;
  translationPx: {
    x: number;
    y: number;
  };
}

const buildPanoramaGraphCandidateEdges = (
  connectedFrames: PanoramaRuntimeSourceFrameV1[],
  candidateTransformOverrides: PanoramaRuntimePlanRequestV1['candidateTransformOverrides'],
): PanoramaGraphCandidateEdge[] => {
  const orderedFrames = [...connectedFrames].sort(comparePanoramaFramePosition);
  const edges: PanoramaGraphCandidateEdge[] = [];
  for (let leftIndex = 0; leftIndex < orderedFrames.length; leftIndex += 1) {
    const fromFrame = orderedFrames[leftIndex];
    if (fromFrame === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < orderedFrames.length; rightIndex += 1) {
      const toFrame = orderedFrames[rightIndex];
      if (toFrame === undefined) continue;
      edges.push(buildPanoramaGraphCandidateEdge(fromFrame, toFrame, candidateTransformOverrides));
    }
  }
  return edges.toSorted(comparePanoramaGraphCandidateEdge);
};

const buildPanoramaGraphCandidateEdge = (
  fromFrame: PanoramaRuntimeSourceFrameV1,
  toFrame: PanoramaRuntimeSourceFrameV1,
  candidateTransformOverrides: PanoramaRuntimePlanRequestV1['candidateTransformOverrides'],
): PanoramaGraphCandidateEdge => {
  const fromX = fromFrame.expectedOffsetX ?? 0;
  const fromY = fromFrame.expectedOffsetY ?? 0;
  const toX = toFrame.expectedOffsetX ?? fromX + fromFrame.width;
  const toY = toFrame.expectedOffsetY ?? fromY;
  const overlapWidth = Math.max(0, fromX + fromFrame.width - toX);
  const overlapTop = Math.max(fromY, toY);
  const overlapBottom = Math.min(fromY + fromFrame.height, toY + toFrame.height);
  const overlapAreaPx = overlapWidth * Math.max(0, overlapBottom - overlapTop);
  const reprojectionErrorPx = Math.abs(toY - fromY) / Math.max(1, toFrame.height);
  const overlapRatio =
    overlapAreaPx / Math.max(1, Math.min(fromFrame.width * fromFrame.height, toFrame.width * toFrame.height));
  const override = candidateTransformOverrides.find(
    (candidateOverride) =>
      candidateOverride.fromSourceIndex === fromFrame.sourceIndex &&
      candidateOverride.toSourceIndex === toFrame.sourceIndex,
  );
  return {
    fromFrame,
    overlapAreaPx,
    qualityScore: roundPanoramaRuntimeMetric(overlapRatio - reprojectionErrorPx),
    reprojectionErrorPx,
    toFrame,
    translationPx: override?.translationPx ?? {
      x: toX - fromX,
      y: toY - fromY,
    },
  };
};

const selectPanoramaSpanningGraphEdges = (
  candidateEdges: PanoramaGraphCandidateEdge[],
  connectedFrames: PanoramaRuntimeSourceFrameV1[],
): {
  rejectedEdges: Array<{ edge: PanoramaGraphCandidateEdge; qualityRank: number; residualPx: number }>;
  selectedEdges: Array<{ edge: PanoramaGraphCandidateEdge; qualityRank: number }>;
} => {
  const disjointSet = new PanoramaRuntimeDisjointSet(connectedFrames.map((frame) => frame.sourceIndex));
  const selectedEdges: Array<{ edge: PanoramaGraphCandidateEdge; qualityRank: number }> = [];
  const rejectedEdges: Array<{ edge: PanoramaGraphCandidateEdge; qualityRank: number; residualPx: number }> = [];
  candidateEdges.forEach((edge, index) => {
    const qualityRank = index + 1;
    const pathTranslation = findPanoramaGraphPathTranslation(
      selectedEdges,
      edge.fromFrame.sourceIndex,
      edge.toFrame.sourceIndex,
    );
    if (pathTranslation !== null) {
      const residualPx = translationResidualPx(pathTranslation, edge.translationPx);
      if (residualPx > PANORAMA_CYCLE_RESIDUAL_THRESHOLD_PX) {
        rejectedEdges.push({ edge, qualityRank, residualPx: roundPanoramaRuntimeMetric(residualPx) });
      }
      return;
    }
    if (selectedEdges.length >= Math.max(0, connectedFrames.length - 1)) return;
    if (!disjointSet.union(edge.fromFrame.sourceIndex, edge.toFrame.sourceIndex)) return;
    selectedEdges.push({ edge, qualityRank });
  });
  return {
    rejectedEdges,
    selectedEdges: selectedEdges.toSorted((left, right) =>
      comparePanoramaFramePosition(left.edge.fromFrame, right.edge.fromFrame),
    ),
  };
};

const findPanoramaGraphPathTranslation = (
  selectedEdges: Array<{ edge: PanoramaGraphCandidateEdge; qualityRank: number }>,
  fromSourceIndex: number,
  toSourceIndex: number,
): { x: number; y: number } | null => {
  const adjacency = new Map<number, Array<{ targetSourceIndex: number; x: number; y: number }>>();
  for (const { edge } of selectedEdges) {
    const from = edge.fromFrame.sourceIndex;
    const to = edge.toFrame.sourceIndex;
    const fromEdges = adjacency.get(from) ?? [];
    fromEdges.push({ targetSourceIndex: to, ...edge.translationPx });
    adjacency.set(from, fromEdges);
    const toEdges = adjacency.get(to) ?? [];
    toEdges.push({ targetSourceIndex: from, x: -edge.translationPx.x, y: -edge.translationPx.y });
    adjacency.set(to, toEdges);
  }

  const pending: Array<{ sourceIndex: number; x: number; y: number }> = [{ sourceIndex: fromSourceIndex, x: 0, y: 0 }];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (current.sourceIndex === toSourceIndex) return { x: current.x, y: current.y };
    if (visited.has(current.sourceIndex)) continue;
    visited.add(current.sourceIndex);
    for (const edge of adjacency.get(current.sourceIndex) ?? []) {
      pending.push({
        sourceIndex: edge.targetSourceIndex,
        x: current.x + edge.x,
        y: current.y + edge.y,
      });
    }
  }
  return null;
};

const translationResidualPx = (left: { x: number; y: number }, right: { x: number; y: number }): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const buildPanoramaPairwiseMatch = (edge: PanoramaGraphCandidateEdge) => {
  const homography3x3 = translationHomography3x3(edge.translationPx);
  return {
    dltDiagnostics: buildPanoramaHomographyDltDiagnosticsV1({
      homography3x3,
      pointPairs: buildSyntheticTranslationPointPairs(edge.fromFrame, edge.translationPx),
    }),
    fromSourceIndex: edge.fromFrame.sourceIndex,
    overlapAreaPx: edge.overlapAreaPx,
    reprojectionErrorPx: edge.reprojectionErrorPx,
    toSourceIndex: edge.toFrame.sourceIndex,
    translationPx: edge.translationPx,
  };
};

const choosePanoramaReferenceSourceIndex = (connectedFrames: PanoramaRuntimeSourceFrameV1[]): number => {
  const minLeft = Math.min(...connectedFrames.map((frame) => frame.expectedOffsetX ?? 0));
  const maxRight = Math.max(...connectedFrames.map((frame) => (frame.expectedOffsetX ?? 0) + frame.width));
  const centerX = (minLeft + maxRight) / 2;
  const [referenceFrame] = [...connectedFrames].sort((left, right) => {
    const leftDistance = Math.abs((left.expectedOffsetX ?? 0) + left.width / 2 - centerX);
    const rightDistance = Math.abs((right.expectedOffsetX ?? 0) + right.width / 2 - centerX);
    return leftDistance - rightDistance || left.sourceIndex - right.sourceIndex;
  });
  if (referenceFrame === undefined) throw new Error('Panorama runtime alignment missing reference frame.');
  return referenceFrame.sourceIndex;
};

const comparePanoramaGraphCandidateEdge = (
  left: PanoramaGraphCandidateEdge,
  right: PanoramaGraphCandidateEdge,
): number =>
  right.qualityScore - left.qualityScore ||
  right.overlapAreaPx - left.overlapAreaPx ||
  left.fromFrame.sourceIndex - right.fromFrame.sourceIndex ||
  left.toFrame.sourceIndex - right.toFrame.sourceIndex;

const comparePanoramaFramePosition = (
  left: PanoramaRuntimeSourceFrameV1,
  right: PanoramaRuntimeSourceFrameV1,
): number =>
  (left.expectedOffsetX ?? 0) - (right.expectedOffsetX ?? 0) ||
  (left.expectedOffsetY ?? 0) - (right.expectedOffsetY ?? 0) ||
  left.sourceIndex - right.sourceIndex;

class PanoramaRuntimeDisjointSet {
  readonly #parents: Map<number, number> = new Map<number, number>();

  constructor(sourceIndices: number[]) {
    for (const sourceIndex of sourceIndices) this.#parents.set(sourceIndex, sourceIndex);
  }

  find(sourceIndex: number): number {
    const parent = this.#parents.get(sourceIndex);
    if (parent === undefined) throw new Error(`Panorama graph missing source ${sourceIndex}.`);
    if (parent === sourceIndex) return sourceIndex;
    const root = this.find(parent);
    this.#parents.set(sourceIndex, root);
    return root;
  }

  union(left: number, right: number): boolean {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return false;
    this.#parents.set(rightRoot, leftRoot);
    return true;
  }
}

const translationHomography3x3 = (translationPx: { x: number; y: number }) =>
  [1, 0, translationPx.x, 0, 1, translationPx.y, 0, 0, 1] as const;

const buildSyntheticTranslationPointPairs = (
  sourceFrame: PanoramaRuntimeSourceFrameV1,
  translationPx: { x: number; y: number },
): PanoramaHomographyPointPairV1[] => {
  const maxX = sourceFrame.width - 1;
  const maxY = sourceFrame.height - 1;
  const sourcePoints: [number, number][] = [
    [0, 0],
    [maxX, 0],
    [0, maxY],
    [maxX, maxY],
  ];
  return sourcePoints.map(([x, y]) => ({
    source: [x, y],
    target: [x + translationPx.x, y + translationPx.y],
  }));
};

const buildPanoramaRuntimeQualityMetrics = (
  request: ParsedPanoramaRuntimePlanRequestV1,
  outputWidth: number,
  outputHeight: number,
  alignment: PanoramaRuntimeProvenanceV1['alignment'],
): PanoramaRuntimeProvenanceV1['qualityMetrics'] => {
  const sourcePixelCount = request.sourceFrames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const overlapAreaTotal = alignment.pairwiseMatches.reduce((total, match) => total + match.overlapAreaPx, 0);
  const crop = buildPanoramaRuntimeCrop(
    request.command.parameters.boundaryMode,
    outputWidth,
    outputHeight,
    request.command.parameters.manualCropInsetsPercent,
  );
  const outputPixelCount = outputWidth * outputHeight;
  return {
    cropCoverageRatio: roundPanoramaRuntimeMetric((crop.width * crop.height) / Math.max(1, outputPixelCount)),
    meanOverlapAreaPx: roundPanoramaRuntimeMetric(overlapAreaTotal / Math.max(1, alignment.pairwiseMatches.length)),
    outputPixelCount,
    sourcePixelCount,
    stitchedSourceRatio: roundPanoramaRuntimeMetric(
      request.connectedSourceIndices.length / request.sourceFrames.length,
    ),
  };
};

const buildPanoramaSeamReview = (
  request: ParsedPanoramaRuntimePlanRequestV1,
  alignment: PanoramaRuntimeProvenanceV1['alignment'],
  sourceGeometry: PanoramaRuntimeProvenanceV1['sourceGeometry'],
  outputWidth: number,
  outputHeight: number,
): PanoramaRuntimeProvenanceV1['seamReview'] => {
  const connected = new Set(request.connectedSourceIndices);
  const disconnectedSourceIndices = request.sourceFrames
    .map((frame) => frame.sourceIndex)
    .filter((sourceIndex) => !connected.has(sourceIndex));
  const weakOverlapEdgeCount = alignment.graph.selectedEdges.filter((edge) => {
    const sourceFrame = request.sourceFrames.find((frame) => frame.sourceIndex === edge.fromSourceIndex);
    const targetFrame = request.sourceFrames.find((frame) => frame.sourceIndex === edge.toSourceIndex);
    const frameArea = Math.min(
      sourceFrame === undefined ? 0 : sourceFrame.width * sourceFrame.height,
      targetFrame === undefined ? 0 : targetFrame.width * targetFrame.height,
    );
    return edge.overlapAreaPx / Math.max(1, frameArea) < 0.2;
  }).length;
  const edgeConfidence = alignment.graph.selectedEdges.map((edge) => {
    const sourceFrame = request.sourceFrames.find((frame) => frame.sourceIndex === edge.fromSourceIndex);
    const targetFrame = request.sourceFrames.find((frame) => frame.sourceIndex === edge.toSourceIndex);
    const frameArea = Math.min(
      sourceFrame === undefined ? 0 : sourceFrame.width * sourceFrame.height,
      targetFrame === undefined ? 0 : targetFrame.width * targetFrame.height,
    );
    const overlapRatio = edge.overlapAreaPx / Math.max(1, frameArea);
    const match = alignment.pairwiseMatches.find(
      (candidate) =>
        candidate.fromSourceIndex === edge.fromSourceIndex && candidate.toSourceIndex === edge.toSourceIndex,
    );
    const reprojectionPenalty = Math.min(0.45, (match?.reprojectionErrorPx ?? 0) / 4);
    const confidenceScore = roundPanoramaRuntimeMetric(
      Math.max(0, Math.min(1, overlapRatio / 0.35 - reprojectionPenalty)),
    );
    return { confidenceScore, overlapRatio };
  });
  const minimumConfidenceScore =
    edgeConfidence.length === 0 ? 0 : Math.min(...edgeConfidence.map((edge) => edge.confidenceScore));
  const meanConfidenceScore =
    edgeConfidence.length === 0
      ? 0
      : roundPanoramaRuntimeMetric(
          edgeConfidence.reduce((total, edge) => total + edge.confidenceScore, 0) / edgeConfidence.length,
        );
  const minimumOverlapRatio =
    edgeConfidence.length === 0
      ? 0
      : roundPanoramaRuntimeMetric(Math.min(...edgeConfidence.map((edge) => edge.overlapRatio)));
  const blockedReasons = [
    ...sourceGeometry.blockedReasons,
    ...(disconnectedSourceIndices.length > 0 ? ['source_selection_incomplete'] : []),
    ...(alignment.graph.selectedEdgeCount < Math.max(0, request.connectedSourceIndices.length - 1)
      ? ['alignment_graph_disconnected']
      : []),
  ];
  const seamRisk =
    blockedReasons.length > 0 || weakOverlapEdgeCount > 0 || alignment.graph.cycleConsistency.rejectedEdgeCount > 0
      ? blockedReasons.length > 0
        ? 'high'
        : 'medium'
      : 'low';
  const overlapConfidenceLevel =
    blockedReasons.length > 0
      ? 'blocked'
      : minimumConfidenceScore >= 0.75
        ? 'high'
        : minimumConfidenceScore >= 0.45
          ? 'medium'
          : 'low';
  const parallaxRisk: PanoramaRuntimeProvenanceV1['seamReview']['seamWarningState']['parallaxRisk'] =
    blockedReasons.length > 0 || alignment.graph.cycleConsistency.rejectedEdgeCount > 0
      ? blockedReasons.length > 0
        ? 'high'
        : 'medium'
      : 'low';
  const seamWarningCodes = [
    ...(overlapConfidenceLevel === 'low' ? ['low_overlap_confidence'] : []),
    ...(parallaxRisk !== 'low' ? ['parallax_seam_warning'] : []),
  ].sort();
  const seamWarningState = {
    parallaxRisk,
    state:
      blockedReasons.length > 0
        ? ('blocked' as const)
        : seamWarningCodes.length > 0
          ? ('warning' as const)
          : ('clear' as const),
    warningCodes: seamWarningCodes,
  };
  const warnings = [
    ...(blockedReasons.length > 0 ? ['seam_review_blocked', 'source_excluded'] : []),
    ...sourceGeometry.warningCodes,
    ...(weakOverlapEdgeCount > 0 ? ['weak_alignment'] : []),
    ...(alignment.graph.cycleConsistency.rejectedEdgeCount > 0 ? ['ambiguous_matches'] : []),
    ...seamWarningCodes,
  ].sort();
  const reviewStatus = blockedReasons.length > 0 ? 'blocked' : seamRisk === 'low' ? 'apply_ready' : 'review_required';

  return {
    blockedReasons,
    contributionMapArtifact: {
      artifactId: `${request.previewArtifactId}:contribution-map`,
      dimensions: { height: outputHeight, width: outputWidth },
      kind: 'preview',
      storage: 'temp_cache',
    },
    disconnectedSourceIndices,
    nextActions:
      reviewStatus === 'apply_ready'
        ? ['approve_plan']
        : reviewStatus === 'blocked'
          ? ['adjust_source_selection', 'inspect_seams']
          : ['inspect_seams', 'reduce_projection_scope'],
    overlapEdgeCount: alignment.graph.selectedEdgeCount,
    reviewStatus,
    seamMaskArtifact: {
      artifactId: `${request.previewArtifactId}:seam-mask`,
      dimensions: { height: outputHeight, width: outputWidth },
      kind: 'mask',
      storage: 'temp_cache',
    },
    overlapConfidence: {
      edgeCount: alignment.graph.selectedEdgeCount,
      level: overlapConfidenceLevel,
      meanConfidenceScore,
      minimumConfidenceScore: roundPanoramaRuntimeMetric(minimumConfidenceScore),
      minimumOverlapRatio,
      weakEdgeCount: weakOverlapEdgeCount,
    },
    seamRisk,
    seamWarningState,
    warnings,
    weakOverlapEdgeCount,
  };
};

const toSyntheticSourceFrame = (
  frame: PanoramaRuntimeSourceFrameV1,
  command: PanoramaRuntimeCommandV1,
): PanoramaSyntheticSourceFrameV1 => ({
  exposureEv: command.parameters.sources.find((source) => source.sourceIndex === frame.sourceIndex)?.exposureEv ?? 0,
  expectedOffsetX: frame.expectedOffsetX,
  expectedOffsetY: frame.expectedOffsetY,
  height: frame.height,
  sourceIndex: frame.sourceIndex,
  width: frame.width,
});

const stablePanoramaRuntimeHash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const buildPanoramaRuntimeSeamPreviewArtifacts = ({
  planHash,
  previewArtifactId,
  provenance,
  renderedContentHash,
}: {
  planHash: string;
  previewArtifactId: string;
  provenance: PanoramaRuntimeProvenanceV1;
  renderedContentHash: string;
}): ComputationalMergeDryRunResultV1['previewArtifacts'] => [
  {
    artifactId: previewArtifactId,
    contentHash: `sha256:${stablePanoramaRuntimeHash(`${planHash}:${previewArtifactId}:${renderedContentHash}`)}`,
    dimensions: {
      height: provenance.crop.height,
      width: provenance.crop.width,
    },
    kind: 'preview',
    storage: 'temp_cache',
  },
  {
    ...provenance.seamReview.contributionMapArtifact,
    contentHash: `sha256:${stablePanoramaRuntimeHash(
      `${planHash}:${provenance.seamReview.contributionMapArtifact.artifactId}:${renderedContentHash}:contribution-map`,
    )}`,
  },
  {
    ...provenance.seamReview.seamMaskArtifact,
    contentHash: `sha256:${stablePanoramaRuntimeHash(
      `${planHash}:${provenance.seamReview.seamMaskArtifact.artifactId}:${renderedContentHash}:seam-mask`,
    )}`,
  },
];

const hashPanoramaRuntimePixels = (pixels: Uint8Array): string => {
  let value = 2166136261;
  for (const pixel of pixels) {
    value ^= pixel;
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const roundPanoramaRuntimeMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const isPanoramaRuntimeCommand = (command: ComputationalMergeCommandEnvelopeV1): command is PanoramaRuntimeCommandV1 =>
  command.commandType === 'computationalMerge.createPanorama';

const sourceImageRefsForPanoramaRuntimeArtifact = (
  command: PanoramaRuntimeCommandV1,
  provenance: PanoramaRuntimeProvenanceV1,
): PanoramaArtifactV1['sourceImageRefs'] =>
  command.parameters.sources.map((source) => ({
    colorSpaceHint: source.colorSpaceHint,
    imageId: source.imageId,
    imagePath: source.imagePath,
    lensCorrectionState: lensCorrectionStateForPanoramaRuntimeArtifact(provenance.lensCorrectionPolicy),
    rawDefaultsApplied: source.rawDefaultsApplied,
    sourceIndex: source.sourceIndex,
    virtualCopyId: source.virtualCopyId ?? null,
  }));

const lensCorrectionStateForPanoramaRuntimeArtifact = (
  policy: PanoramaRuntimeProvenanceV1['lensCorrectionPolicy'],
): PanoramaArtifactV1['sourceImageRefs'][number]['lensCorrectionState'] => {
  if (policy === 'applied_before_stitch') {
    return 'applied';
  }
  if (policy === 'required_before_stitch') {
    return 'required_before_stitch';
  }
  return 'unknown';
};

const alignmentForPanoramaRuntimeArtifact = (
  provenance: PanoramaRuntimeProvenanceV1,
): PanoramaArtifactV1['alignment'] => ({
  algorithmId: 'rapidraw_fast9_brief_ransac_v1',
  downscaleMaxDimensionPx: 1600,
  globalHomographyCount: provenance.alignment.pairwiseMatches.length,
  localOptimization: {
    algorithmId: 'deterministic_inlier_mean_refinement_v1',
    boundedIterationCount: provenance.alignment.pairwiseMatches.length,
    deterministicTieBreak: 'first_max_consensus_lowest_match_index',
    refinedModelType: 'translation_xy',
    support: 'synthetic_translation_metadata_only',
  },
  minimumInliersForConnection: 15,
  pairwiseMatches: provenance.alignment.pairwiseMatches.map((match) => ({
    fromSourceIndex: match.fromSourceIndex,
    homography3x3: [1, 0, match.translationPx.x, 0, 1, match.translationPx.y, 0, 0, 1],
    homographyDiagnostics: match.dltDiagnostics,
    inliers: Math.max(15, match.overlapAreaPx),
    matchQuality: 'accepted',
    reprojectionErrorPx: match.reprojectionErrorPx,
    toSourceIndex: match.toSourceIndex,
  })),
  ransacInlierThresholdPx: 5,
  ransacIterations: 2500,
  ransacSeed: 0,
});

const boundarySettingsForPanoramaRuntimeArtifact = (
  provenance: PanoramaRuntimeProvenanceV1,
): PanoramaArtifactV1['boundarySettings'] => ({
  crop: provenance.crop,
  ...(provenance.boundaryMode === 'deferred_fill'
    ? { deferredReason: 'Synthetic runtime records deferred fill but renders transparent bounds.' }
    : {}),
  effectiveMode: provenance.boundaryMode,
  requestedMode: provenance.boundaryMode,
  support: provenance.boundaryMode === 'deferred_fill' ? 'schema_only_deferred' : 'implemented_current_engine',
});

const projectionSettingsForPanoramaRuntimeArtifact = (
  provenance: PanoramaRuntimeProvenanceV1,
): PanoramaArtifactV1['projectionSettings'] => ({
  ...(provenance.projectionSettings.support === 'schema_only_deferred'
    ? { deferredReason: provenance.projectionSettings.deferredReason ?? 'Projection was resolved by runtime fallback.' }
    : {}),
  effectiveProjection: provenance.resolvedProjection,
  ...(provenance.projectionSettings.horizontalFovDegrees === undefined
    ? {}
    : { horizontalFovDegrees: provenance.projectionSettings.horizontalFovDegrees }),
  requestedProjection: provenance.projection,
  support: provenance.projectionSettings.support,
});

const exposureNormalizationForPanoramaRuntimeArtifact = (
  provenance: PanoramaRuntimeProvenanceV1,
): PanoramaArtifactV1['exposureNormalization'] => {
  const result = provenance.exposureNormalizationResult;
  if (result.mode === 'none') {
    return {
      mode: 'none',
      skippedReason: result.skippedReason ?? 'not_requested',
      support: 'implemented_current_engine',
    };
  }

  return {
    appliedGainCount: result.appliedGainCount,
    appliedLuminanceGains: result.appliedLuminanceGains,
    compensationStrengthPercent: result.compensationStrengthPercent,
    mode: 'scalar_overlap_luminance_gain_v1',
    overlapMetrics: result.overlapMetrics,
    support: 'implemented_current_engine',
  };
};

const meanPanoramaRuntimeReprojectionError = (provenance: PanoramaRuntimeProvenanceV1): number | undefined => {
  if (provenance.alignment.pairwiseMatches.length === 0) return undefined;
  const total = provenance.alignment.pairwiseMatches.reduce((sum, match) => sum + match.reprojectionErrorPx, 0);
  return roundPanoramaRuntimeMetric(total / provenance.alignment.pairwiseMatches.length);
};

const isPanoramaArtifactWarning = (warning: string): warning is PanoramaArtifactV1['warnings'][number] =>
  [
    'source_excluded',
    'insufficient_features',
    'ambiguous_matches',
    'weak_alignment',
    'low_overlap_confidence',
    'parallax_seam_warning',
    'low_inlier_count',
    'high_memory_estimate',
    'memory_budget_exceeded',
    'missing_lens_correction',
    'exposure_mismatch',
    'projection_runtime_deferred',
    'boundary_runtime_deferred',
    'cancellation_not_supported',
  ].includes(warning);
