import { z } from 'zod';

import { renderSyntheticPanoramaStitchV1, type PanoramaSyntheticSourceFrameV1 } from './panoramaSyntheticStitch.js';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
} from './rawEngineSchemas.js';

const PANORAMA_RUNTIME_ENGINE_ID = 'rawengine_panorama_synthetic_v1';
const PANORAMA_RUNTIME_ENGINE_VERSION = '0.1.0';

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
    boundaryMode: z.enum(['auto_crop', 'transparent', 'manual_crop', 'deferred_fill']),
    engineId: z.literal(PANORAMA_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(PANORAMA_RUNTIME_ENGINE_VERSION),
    excludedSourceCount: z.number().int().nonnegative(),
    projection: z.enum(['rectilinear', 'cylindrical', 'spherical', 'planar']),
    resolvedProjection: z.literal('rectilinear'),
    runtimeStatus: z.enum(['dry_run_rendered', 'apply_rendered']),
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

export const buildPanoramaRuntimeDryRunV1 = (requestValue: unknown): PanoramaRuntimeDryRunResultV1 => {
  const request = parsePanoramaRuntimePlanRequest(requestValue, true);
  const runtime = renderPanoramaRuntime(request);
  const planId = `panorama_plan_${request.command.commandId}`;
  const planHash = `sha256:${stablePanoramaRuntimeHash(`${planId}:${runtime.provenance.resolvedProjection}`)}`;
  const previewArtifacts = [
    {
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stablePanoramaRuntimeHash(`${planHash}:preview`)}`,
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
      contentHash: `sha256:${stablePanoramaRuntimeHash(`${acceptedDryRunPlanHash}:${request.outputArtifactId}`)}`,
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
    expectedWarningCodes: expectedWarningsForCommand(request.command),
    fixtureId: `panorama.runtime.${request.command.commandId}.v1`,
    memoryBudgetBytes: request.command.parameters.memoryBudgetBytes ?? 4_000_000_000,
    seed: request.seed,
    sourceFrames: request.sourceFrames.map(toSyntheticSourceFrame),
  });
  if (stitched.outputPixels === null) {
    throw new Error('Panorama runtime plan expected renderable synthetic output pixels.');
  }

  return {
    height: stitched.output.height,
    outputPixels: stitched.outputPixels,
    provenance: panoramaRuntimeProvenanceV1Schema.parse({
      boundaryMode: request.command.parameters.boundaryMode,
      engineId: PANORAMA_RUNTIME_ENGINE_ID,
      engineVersion: PANORAMA_RUNTIME_ENGINE_VERSION,
      excludedSourceCount: stitched.excludedSourceCount,
      projection: request.command.parameters.projection,
      resolvedProjection: 'rectilinear',
      runtimeStatus: 'dry_run_rendered',
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
  if (command.parameters.projection !== 'rectilinear') warnings.add('projection_runtime_deferred');
  if (command.parameters.boundaryMode === 'deferred_fill') warnings.add('boundary_runtime_deferred');
  return [...warnings].sort();
};

const toSyntheticSourceFrame = (frame: PanoramaRuntimeSourceFrameV1): PanoramaSyntheticSourceFrameV1 => ({
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

const isPanoramaRuntimeCommand = (command: ComputationalMergeCommandEnvelopeV1): command is PanoramaRuntimeCommandV1 =>
  command.commandType === 'computationalMerge.createPanorama';
