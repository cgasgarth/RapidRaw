import { z } from 'zod';

import {
  buildPanoramaHomographyDltDiagnosticsV1,
  panoramaHomographyDltDiagnosticsV1Schema,
  type PanoramaHomographyPointPairV1,
} from './panoramaHomographyDiagnostics.js';
import { renderSyntheticPanoramaStitchV1, type PanoramaSyntheticSourceFrameV1 } from './panoramaSyntheticStitch.js';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  panoramaArtifactV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  type PanoramaArtifactV1,
} from './rawEngineSchemas.js';

const PANORAMA_RUNTIME_ENGINE_ID = 'rawengine_panorama_synthetic_v1';
const PANORAMA_RUNTIME_ENGINE_VERSION = '0.1.0';
const PANORAMA_CYCLE_RESIDUAL_THRESHOLD_PX = 2;

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
    resolvedProjection: z.enum(['rectilinear', 'planar']),
    runtimeStatus: z.enum(['dry_run_rendered', 'apply_rendered']),
    seamBlend: z
      .object({
        blendMode: z.enum(['feather', 'multi_band']),
        seamMethod: z.enum(['adaptive_feather']),
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
}

export interface PanoramaRuntimeArtifactInputV1 {
  applyResult: PanoramaRuntimeApplyResultV1;
  command: PanoramaRuntimeCommandV1;
  createdAt: string;
  previewArtifacts?: ComputationalMergeDryRunResultV1['previewArtifacts'];
}

export const buildPanoramaRuntimeDryRunV1 = (requestValue: unknown): PanoramaRuntimeDryRunResultV1 => {
  const request = parsePanoramaRuntimePlanRequest(requestValue, true);
  const runtime = renderPanoramaRuntime(request);
  const planId = `panorama_plan_${request.command.commandId}`;
  const planHash = `sha256:${stablePanoramaRuntimeHash(`${planId}:${runtime.provenance.resolvedProjection}`)}`;
  const renderedContentHash = hashPanoramaRuntimePixels(runtime.outputPixels);
  const previewArtifacts = [
    {
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stablePanoramaRuntimeHash(`${planHash}:${request.previewArtifactId}:${renderedContentHash}`)}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'preview' as const,
      storage: 'temp_cache' as const,
    },
  ];

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
        estimatedPeakMemoryBytes: runtime.width * runtime.height * 4,
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

  return {
    mutationResult,
    outputPixels: runtime.outputPixels,
    provenance: panoramaRuntimeProvenanceV1Schema.parse({
      ...runtime.provenance,
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId,
      runtimeStatus: 'apply_rendered',
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
        cylindricalProjection: false,
        exposureNormalization: true,
        planarHomography: true,
        tiledRender: false,
      },
      engineId: 'rapidraw_homography_seam_v0',
      qualityTier: 'validated_planar_v1',
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
      featherWidthPx: 100,
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
  const stitched = renderSyntheticPanoramaStitchV1({
    connectedSourceIndices: request.connectedSourceIndices,
    exposureNormalization: request.command.parameters.exposureNormalization,
    expectedWarningCodes: expectedWarningsForCommand(request.command),
    fixtureId: `panorama.runtime.${request.command.commandId}.v1`,
    memoryBudgetBytes: request.command.parameters.memoryBudgetBytes ?? 4_000_000_000,
    seed: request.seed,
    sourceFrames: request.sourceFrames.map((frame) => toSyntheticSourceFrame(frame, request.command)),
  });
  if (stitched.outputPixels === null) {
    throw new Error('Panorama runtime plan expected renderable synthetic output pixels.');
  }

  return {
    height: stitched.output.height,
    outputPixels: stitched.outputPixels,
    provenance: panoramaRuntimeProvenanceV1Schema.parse({
      alignment: buildPanoramaRuntimeAlignment(
        request.sourceFrames,
        request.connectedSourceIndices,
        request.candidateTransformOverrides,
      ),
      boundaryMode: request.command.parameters.boundaryMode,
      crop: buildPanoramaRuntimeCrop(
        request.command.parameters.boundaryMode,
        stitched.output.width,
        stitched.output.height,
      ),
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
      qualityMetrics: buildPanoramaRuntimeQualityMetrics(request, stitched.output.width, stitched.output.height),
      resolvedProjection: resolvePanoramaRuntimeProjection(request.command.parameters.projection),
      runtimeStatus: 'dry_run_rendered',
      seamBlend: {
        blendMode: request.command.parameters.blendMode ?? 'feather',
        seamMethod: 'adaptive_feather',
      },
      sourceState: request.sourceFrames.map((frame) => ({
        contentHash: frame.contentHash,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
      stitchedSourceCount: stitched.stitchedSourceCount,
    }),
    warnings: stitched.warningCodes,
    width: stitched.output.width,
  };
};

const buildPanoramaPreflightEstimate = (request: ParsedPanoramaRuntimePlanRequestV1, width: number, height: number) => {
  const sourcePixelCount = request.sourceFrames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const outputPixelCount = width * height;
  const sourceDecodeBytes = sourcePixelCount * 4;
  const outputCanvasBytes = outputPixelCount * 4;
  const previewBytes = outputPixelCount * 4;
  const memoryComponents = {
    lowDetailMaskBytes: outputPixelCount,
    outputCanvasBytes,
    outputMaskBytes: outputPixelCount,
    overheadBytes: 4096,
    previewBytes,
    seamWorkspaceBytes: outputPixelCount,
    sourceDecodeBytes,
    totalEstimatedPeakBytes: sourceDecodeBytes + outputCanvasBytes + previewBytes + outputPixelCount * 3 + 4096,
  };
  const memoryBudgetBytes = Math.max(memoryComponents.totalEstimatedPeakBytes * 2, 1);
  return {
    blockedReasons: [],
    engineCapabilities: {
      fullFrameLegacy: true,
      maxPreviewDimensionPx: request.command.parameters.maxPreviewDimensionPx,
      planOnly: true,
      tileBackedRender: false,
    },
    executionMode: 'full_frame_legacy',
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
    status: 'accepted',
    tileCount: 1,
    warningCodes: ['legacy_full_frame_render'],
  };
};

const expectedWarningsForCommand = (command: PanoramaRuntimeCommandV1): string[] => {
  const warnings = new Set<string>(['legacy_full_frame_render']);
  if (['cylindrical', 'spherical'].includes(command.parameters.projection)) warnings.add('projection_runtime_deferred');
  if (command.parameters.boundaryMode === 'deferred_fill') warnings.add('boundary_runtime_deferred');
  return [...warnings].sort();
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
    requestedProjection,
    support,
  };
};

const resolvePanoramaRuntimeProjection = (
  requestedProjection: PanoramaRuntimeCommandV1['parameters']['projection'],
): 'rectilinear' | 'planar' => (requestedProjection === 'planar' ? 'planar' : 'rectilinear');

const buildPanoramaRuntimeCrop = (
  boundaryMode: PanoramaRuntimeCommandV1['parameters']['boundaryMode'],
  width: number,
  height: number,
) => ({
  height,
  mode:
    boundaryMode === 'transparent' || boundaryMode === 'deferred_fill'
      ? 'none'
      : boundaryMode === 'manual_crop'
        ? 'manual'
        : 'auto',
  width,
  x: 0,
  y: 0,
});

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
): PanoramaRuntimeProvenanceV1['qualityMetrics'] => {
  const alignment = buildPanoramaRuntimeAlignment(
    request.sourceFrames,
    request.connectedSourceIndices,
    request.candidateTransformOverrides,
  );
  const sourcePixelCount = request.sourceFrames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const overlapAreaTotal = alignment.pairwiseMatches.reduce((total, match) => total + match.overlapAreaPx, 0);
  const crop = buildPanoramaRuntimeCrop(request.command.parameters.boundaryMode, outputWidth, outputHeight);
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
    'low_inlier_count',
    'high_memory_estimate',
    'memory_budget_exceeded',
    'missing_lens_correction',
    'exposure_mismatch',
    'projection_runtime_deferred',
    'boundary_runtime_deferred',
    'cancellation_not_supported',
  ].includes(warning);
