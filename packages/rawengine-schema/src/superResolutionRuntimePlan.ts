import { z } from 'zod';

import {
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
} from './rawEngineSchemas.js';
import { applyPixelShiftSuperResolutionV1 } from './superResolutionPixelShift.js';

const SR_RUNTIME_ENGINE_ID = 'rawengine_sr_pixel_shift_runtime_v1';
const SR_RUNTIME_ENGINE_VERSION = '0.1.0';

export const superResolutionRuntimeFrameV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    height: z.number().int().positive(),
    pixels: z.instanceof(Float32Array),
    shiftX: z.number().int().nonnegative(),
    shiftY: z.number().int().nonnegative(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const superResolutionRuntimePlanRequestV1Schema = z
  .object({
    command: computationalMergeCommandEnvelopeV1Schema,
    confidenceMapArtifactId: z.string().trim().min(1),
    frames: z.array(superResolutionRuntimeFrameV1Schema).min(2),
    outputArtifactId: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
  })
  .strict();

export const superResolutionRuntimeProvenanceV1Schema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
    acceptedDryRunPlanId: z.string().trim().min(1).optional(),
    changedPixelRatioAgainstNearest: z.number().min(0).max(1),
    detailPolicy: z.enum(['conservative', 'balanced', 'aggressive_preview_only']),
    effectiveOutputScale: z.number().min(1).max(4),
    engineId: z.literal(SR_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(SR_RUNTIME_ENGINE_VERSION),
    mode: z.enum(['single_image', 'multi_image']),
    requestedAlignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
    requestedOutputScale: z.number().min(1.1).max(4),
    resolvedAlignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
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
  })
  .strict();

export type SuperResolutionRuntimeFrameV1 = z.infer<typeof superResolutionRuntimeFrameV1Schema>;
export type SuperResolutionRuntimePlanRequestV1 = z.infer<typeof superResolutionRuntimePlanRequestV1Schema>;
export type SuperResolutionRuntimeProvenanceV1 = z.infer<typeof superResolutionRuntimeProvenanceV1Schema>;
type SuperResolutionRuntimeCommandV1 = Extract<
  ComputationalMergeCommandEnvelopeV1,
  { commandType: 'computationalMerge.createSuperResolution' }
>;
type ParsedSuperResolutionRuntimePlanRequestV1 = Omit<SuperResolutionRuntimePlanRequestV1, 'command'> & {
  command: SuperResolutionRuntimeCommandV1;
};

export interface SuperResolutionRuntimeDryRunResultV1 {
  dryRunResult: ComputationalMergeDryRunResultV1;
  outputPixels: Float32Array;
  provenance: SuperResolutionRuntimeProvenanceV1;
}

export interface SuperResolutionRuntimeApplyResultV1 {
  mutationResult: ComputationalMergeMutationResultV1;
  outputPixels: Float32Array;
  provenance: SuperResolutionRuntimeProvenanceV1;
}

export const buildSuperResolutionRuntimeDryRunV1 = (requestValue: unknown): SuperResolutionRuntimeDryRunResultV1 => {
  const request = parseSuperResolutionRuntimePlanRequest(requestValue, true);
  const runtime = renderSuperResolutionRuntime(request);
  const planId = `sr_plan_${request.command.commandId}`;
  const planHash = `sha256:${stableSrRuntimeHash(`${planId}:${runtime.provenance.effectiveOutputScale}`)}`;
  const previewArtifacts = [
    {
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stableSrRuntimeHash(`${planHash}:preview`)}`,
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
      family: 'super_resolution',
      outputDimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      outputName: request.command.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: runtime.width * runtime.height * request.frames.length * 4,
        estimatedRuntimeMs: 1,
        requiresBackgroundJob: false,
      },
      planId,
      preflight: buildSrPreflightEstimate(request, runtime.width, runtime.height),
      qualityMetrics: {
        expectedDetailGainRatio: runtime.provenance.effectiveOutputScale,
        sourceCount: request.frames.length,
      },
      sourceImageRefs: request.command.parameters.sources,
      warnings: runtime.warnings,
    },
    mutates: false,
    predictedGraphRevision: `${request.command.expectedGraphRevision}:sr-preview`,
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

export const applySuperResolutionRuntimePlanV1 = (requestValue: unknown): SuperResolutionRuntimeApplyResultV1 => {
  const request = parseSuperResolutionRuntimePlanRequest(requestValue, false);
  const runtime = renderSuperResolutionRuntime(request);
  const acceptedDryRunPlanHash = request.command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = request.command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('Super-resolution runtime apply requires an accepted dry-run plan id and hash.');
  }

  const outputArtifacts = [
    {
      artifactId: request.outputArtifactId,
      contentHash: `sha256:${stableSrRuntimeHash(`${acceptedDryRunPlanHash}:${request.outputArtifactId}`)}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'merge_output' as const,
      storage: 'sidecar_artifact' as const,
    },
  ];

  const mutationResult = computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: `${request.command.expectedGraphRevision}:sr-apply`,
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
    undoRevision: `${request.command.expectedGraphRevision}:undo-sr-apply`,
    warnings: runtime.warnings,
  });

  return {
    mutationResult,
    outputPixels: runtime.outputPixels,
    provenance: superResolutionRuntimeProvenanceV1Schema.parse({
      ...runtime.provenance,
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId,
      runtimeStatus: 'apply_rendered',
    }),
  };
};

const parseSuperResolutionRuntimePlanRequest = (
  requestValue: unknown,
  dryRun: boolean,
): ParsedSuperResolutionRuntimePlanRequestV1 => {
  const request = superResolutionRuntimePlanRequestV1Schema.parse(requestValue);
  if (!isSuperResolutionRuntimeCommand(request.command)) {
    throw new Error('Super-resolution runtime plan only supports computationalMerge.createSuperResolution commands.');
  }
  if (request.command.dryRun !== dryRun) {
    throw new Error(`Super-resolution runtime plan expected dryRun=${String(dryRun)}.`);
  }
  if (request.command.parameters.mode !== 'multi_image') {
    throw new Error('Super-resolution runtime pixel-shift apply currently requires multi_image mode.');
  }
  if (!Number.isInteger(request.command.parameters.outputScale)) {
    throw new Error('Super-resolution runtime pixel-shift apply requires an integer output scale.');
  }

  const frameIndexes = new Set(request.frames.map((frame) => frame.sourceIndex));
  for (const source of request.command.parameters.sources) {
    if (!frameIndexes.has(source.sourceIndex)) {
      throw new Error(`Super-resolution runtime plan missing frame for command source ${source.sourceIndex}.`);
    }
  }

  return { ...request, command: request.command };
};

const renderSuperResolutionRuntime = (request: ParsedSuperResolutionRuntimePlanRequestV1) => {
  const firstFrame = request.frames[0];
  if (firstFrame === undefined) {
    throw new Error('Super-resolution runtime requires at least one frame.');
  }
  const scale = request.command.parameters.outputScale;
  const result = applyPixelShiftSuperResolutionV1({
    frames: request.frames.map((frame) => ({
      pixels: frame.pixels,
      shiftX: frame.shiftX,
      shiftY: frame.shiftY,
    })),
    height: firstFrame.height,
    scale,
    width: firstFrame.width,
  });
  const warnings = deriveSrWarnings(result.changedPixelRatioAgainstNearest, request.command.parameters.detailPolicy);

  return {
    height: result.outputHeight,
    outputPixels: result.outputPixels,
    provenance: superResolutionRuntimeProvenanceV1Schema.parse({
      changedPixelRatioAgainstNearest: roundSrMetric(result.changedPixelRatioAgainstNearest),
      detailPolicy: request.command.parameters.detailPolicy,
      effectiveOutputScale: result.outputScale,
      engineId: SR_RUNTIME_ENGINE_ID,
      engineVersion: SR_RUNTIME_ENGINE_VERSION,
      mode: request.command.parameters.mode,
      requestedAlignmentMode: request.command.parameters.alignmentMode,
      requestedOutputScale: request.command.parameters.outputScale,
      resolvedAlignmentMode: request.command.parameters.alignmentMode,
      runtimeStatus: 'dry_run_rendered',
      sourceState: request.frames.map((frame) => ({
        contentHash: frame.contentHash,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
    }),
    warnings,
    width: result.outputWidth,
  };
};

const buildSrPreflightEstimate = (
  request: ParsedSuperResolutionRuntimePlanRequestV1,
  width: number,
  height: number,
) => {
  const sourcePixelCount = request.frames.reduce((total, frame) => total + frame.width * frame.height, 0);
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
      sourceCount: request.frames.length,
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

const deriveSrWarnings = (
  changedPixelRatioAgainstNearest: number,
  detailPolicy: SuperResolutionRuntimeProvenanceV1['detailPolicy'],
): string[] => {
  const warnings = new Set<string>();
  if (changedPixelRatioAgainstNearest < 0.2) warnings.add('texture_risk');
  if (detailPolicy === 'aggressive_preview_only') warnings.add('aggressive_preview_only');
  return [...warnings].sort();
};

const stableSrRuntimeHash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const isSuperResolutionRuntimeCommand = (
  command: ComputationalMergeCommandEnvelopeV1,
): command is SuperResolutionRuntimeCommandV1 => command.commandType === 'computationalMerge.createSuperResolution';

const roundSrMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
