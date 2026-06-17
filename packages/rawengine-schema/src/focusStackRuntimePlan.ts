import { z } from 'zod';

import {
  applyWeightedSharpnessFocusStackV1,
  focusStackRuntimeSharpnessCellV1Schema,
} from './focusStackWeightedBlend.js';
import {
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type ArtifactHandleV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
} from './rawEngineSchemas.js';

const FOCUS_RUNTIME_ENGINE_ID = 'rawengine_focus_stack_runtime_v1';
const FOCUS_RUNTIME_ENGINE_VERSION = '0.1.0';

export const focusStackRuntimePlanFrameV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    focusDistanceMm: z.number().positive().optional(),
    graphRevision: z.string().trim().min(1),
    height: z.number().int().positive(),
    pixels: z.instanceof(Float32Array),
    sourceIndex: z.number().int().nonnegative(),
    translationX: z.number().int(),
    translationY: z.number().int(),
    width: z.number().int().positive(),
  })
  .strict();

export const focusStackRuntimePlanRequestV1Schema = z
  .object({
    cells: z.array(focusStackRuntimeSharpnessCellV1Schema).min(1),
    command: computationalMergeCommandEnvelopeV1Schema,
    depthConfidenceArtifactId: z.string().trim().min(1),
    frames: z.array(focusStackRuntimePlanFrameV1Schema).min(2),
    lowConfidenceWeightFloor: z.number().min(0).max(1).default(0.12),
    outputArtifactId: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    retouchLayerArtifactId: z.string().trim().min(1).optional(),
    sharpnessMapArtifactId: z.string().trim().min(1),
    weightPower: z.number().positive().default(5),
  })
  .strict();

export const focusStackRuntimeProvenanceV1Schema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
    acceptedDryRunPlanId: z.string().trim().min(1).optional(),
    blendMethod: z.enum(['depth_map', 'laplacian_pyramid', 'weighted_sharpness']),
    engineId: z.literal(FOCUS_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(FOCUS_RUNTIME_ENGINE_VERSION),
    focusCoverageRatio: z.number().min(0).max(1),
    referenceSourceIndex: z.number().int().nonnegative(),
    requestedAlignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
    resolvedAlignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
    retouchLayerPolicy: z.enum(['none', 'generate_retouch_layer']),
    runtimeStatus: z.enum(['dry_run_rendered', 'apply_rendered']),
    sharpnessSettings: z
      .object({
        cellCount: z.number().int().positive(),
        lowConfidenceWeightFloor: z.number().min(0).max(1),
        lowConfidenceCellCount: z.number().int().nonnegative(),
        weightPower: z.number().positive(),
      })
      .strict(),
    sourceState: z.array(
      z
        .object({
          contentHash: z.string().trim().min(1),
          focusDistanceMm: z.number().positive().optional(),
          graphRevision: z.string().trim().min(1),
          sourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export type FocusStackRuntimePlanFrameV1 = z.infer<typeof focusStackRuntimePlanFrameV1Schema>;
export type FocusStackRuntimePlanRequestV1 = z.infer<typeof focusStackRuntimePlanRequestV1Schema>;
export type FocusStackRuntimeProvenanceV1 = z.infer<typeof focusStackRuntimeProvenanceV1Schema>;
type FocusStackRuntimeCommandV1 = Extract<
  ComputationalMergeCommandEnvelopeV1,
  { commandType: 'computationalMerge.createFocusStack' }
>;
type ParsedFocusStackRuntimePlanRequestV1 = Omit<FocusStackRuntimePlanRequestV1, 'command'> & {
  command: FocusStackRuntimeCommandV1;
};

export interface FocusStackRuntimeDryRunResultV1 {
  dryRunResult: ComputationalMergeDryRunResultV1;
  outputPixels: Float32Array;
  provenance: FocusStackRuntimeProvenanceV1;
}

export interface FocusStackRuntimeApplyResultV1 {
  mutationResult: ComputationalMergeMutationResultV1;
  outputPixels: Float32Array;
  provenance: FocusStackRuntimeProvenanceV1;
}

export const buildFocusStackRuntimeDryRunV1 = (requestValue: unknown): FocusStackRuntimeDryRunResultV1 => {
  const request = parseFocusStackRuntimePlanRequest(requestValue, true);
  const runtime = renderFocusStackRuntime(request);
  const planId = `focus_stack_plan_${request.command.commandId}`;
  const planHash = `sha256:${stableFocusRuntimeHash(`${planId}:${runtime.provenance.blendMethod}`)}`;
  const renderedContentHash = hashFocusRuntimePixels(runtime.outputPixels);
  const previewArtifacts = [
    {
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stableFocusRuntimeHash(`${planHash}:${request.previewArtifactId}:${renderedContentHash}`)}`,
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
      family: 'focus_stack',
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
      preflight: buildFocusPreflightEstimate(request, runtime.width, runtime.height),
      qualityMetrics: {
        focusCoverageRatio: runtime.provenance.focusCoverageRatio,
        sourceCount: request.frames.length,
      },
      sourceImageRefs: request.command.parameters.sources,
      warnings: runtime.warnings,
    },
    mutates: false,
    predictedGraphRevision: `${request.command.expectedGraphRevision}:focus-preview`,
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

export const applyFocusStackRuntimePlanV1 = (requestValue: unknown): FocusStackRuntimeApplyResultV1 => {
  const request = parseFocusStackRuntimePlanRequest(requestValue, false);
  const runtime = renderFocusStackRuntime(request);
  const acceptedDryRunPlanHash = request.command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = request.command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('Focus stack runtime apply requires an accepted dry-run plan id and hash.');
  }

  const renderedContentHash = hashFocusRuntimePixels(runtime.outputPixels);
  const outputArtifacts: ArtifactHandleV1[] = [
    {
      artifactId: request.outputArtifactId,
      contentHash: `sha256:${stableFocusRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.outputArtifactId}:${renderedContentHash}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'merge_output' as const,
      storage: 'sidecar_artifact' as const,
    },
    {
      artifactId: request.sharpnessMapArtifactId,
      contentHash: `sha256:${stableFocusRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.sharpnessMapArtifactId}:${renderedContentHash}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'mask' as const,
      storage: 'sidecar_artifact' as const,
    },
    {
      artifactId: request.depthConfidenceArtifactId,
      contentHash: `sha256:${stableFocusRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.depthConfidenceArtifactId}:${renderedContentHash}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'mask' as const,
      storage: 'sidecar_artifact' as const,
    },
  ];
  if (request.command.parameters.retouchLayerPolicy === 'generate_retouch_layer') {
    if (request.retouchLayerArtifactId === undefined) {
      throw new Error('Focus stack runtime retouch layer policy requires retouchLayerArtifactId.');
    }
    outputArtifacts.push({
      artifactId: request.retouchLayerArtifactId,
      contentHash: `sha256:${stableFocusRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.retouchLayerArtifactId}:${renderedContentHash}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'generated_patch' as const,
      storage: 'sidecar_artifact' as const,
    });
  }

  const mutationResult = computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: `${request.command.expectedGraphRevision}:focus-apply`,
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
    undoRevision: `${request.command.expectedGraphRevision}:undo-focus-apply`,
    warnings: runtime.warnings,
  });

  return {
    mutationResult,
    outputPixels: runtime.outputPixels,
    provenance: focusStackRuntimeProvenanceV1Schema.parse({
      ...runtime.provenance,
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId,
      runtimeStatus: 'apply_rendered',
    }),
  };
};

const parseFocusStackRuntimePlanRequest = (
  requestValue: unknown,
  dryRun: boolean,
): ParsedFocusStackRuntimePlanRequestV1 => {
  const request = focusStackRuntimePlanRequestV1Schema.parse(requestValue);
  if (!isFocusStackRuntimeCommand(request.command)) {
    throw new Error('Focus stack runtime plan only supports computationalMerge.createFocusStack commands.');
  }
  if (request.command.dryRun !== dryRun) {
    throw new Error(`Focus stack runtime plan expected dryRun=${String(dryRun)}.`);
  }

  const frameIndexes = new Set(request.frames.map((frame) => frame.sourceIndex));
  for (const source of request.command.parameters.sources) {
    if (!frameIndexes.has(source.sourceIndex)) {
      throw new Error(`Focus stack runtime plan missing frame for command source ${source.sourceIndex}.`);
    }
  }

  return { ...request, command: request.command };
};

const renderFocusStackRuntime = (request: ParsedFocusStackRuntimePlanRequestV1) => {
  const referenceSourceIndex = request.frames[0]?.sourceIndex;
  if (referenceSourceIndex === undefined) {
    throw new Error('Focus stack runtime plan requires at least one frame.');
  }

  const blend = applyWeightedSharpnessFocusStackV1({
    cells: request.cells,
    frames: request.frames.map((frame) => ({
      height: frame.height,
      pixels: frame.pixels,
      sourceIndex: frame.sourceIndex,
      translationX: frame.translationX,
      translationY: frame.translationY,
      width: frame.width,
    })),
    lowConfidenceWeightFloor: request.lowConfidenceWeightFloor,
    referenceSourceIndex,
    weightPower: request.weightPower,
  });
  const focusCoverageRatio = calculateFocusCoverageRatio(request);
  const warnings = deriveFocusWarnings(focusCoverageRatio, request.command.parameters.retouchLayerPolicy);

  return {
    height: blend.outputHeight,
    outputPixels: blend.outputPixels,
    provenance: focusStackRuntimeProvenanceV1Schema.parse({
      blendMethod: request.command.parameters.blendMethod,
      engineId: FOCUS_RUNTIME_ENGINE_ID,
      engineVersion: FOCUS_RUNTIME_ENGINE_VERSION,
      focusCoverageRatio,
      referenceSourceIndex,
      requestedAlignmentMode: request.command.parameters.alignmentMode,
      resolvedAlignmentMode:
        request.command.parameters.alignmentMode === 'auto' ? 'translation' : request.command.parameters.alignmentMode,
      retouchLayerPolicy: request.command.parameters.retouchLayerPolicy,
      runtimeStatus: 'dry_run_rendered',
      sharpnessSettings: {
        cellCount: request.cells.length,
        lowConfidenceCellCount: request.cells.filter((cell) => cell.lowConfidence).length,
        lowConfidenceWeightFloor: request.lowConfidenceWeightFloor,
        weightPower: request.weightPower,
      },
      sourceState: request.frames.map((frame) => ({
        contentHash: frame.contentHash,
        focusDistanceMm: frame.focusDistanceMm,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
    }),
    warnings,
    width: blend.outputWidth,
  };
};

const buildFocusPreflightEstimate = (request: ParsedFocusStackRuntimePlanRequestV1, width: number, height: number) => {
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

const calculateFocusCoverageRatio = (request: ParsedFocusStackRuntimePlanRequestV1): number => {
  const coveredPixels = request.cells.reduce((total, cell) => total + cell.width * cell.height, 0);
  const referenceFrame = request.frames[0];
  if (referenceFrame === undefined) {
    return 0;
  }
  return roundFocusMetric(Math.min(1, coveredPixels / (referenceFrame.width * referenceFrame.height)));
};

const deriveFocusWarnings = (
  focusCoverageRatio: number,
  retouchLayerPolicy: FocusStackRuntimeProvenanceV1['retouchLayerPolicy'],
): string[] => {
  const warnings = new Set<string>();
  if (focusCoverageRatio < 0.9) warnings.add('focus_coverage_low');
  if (retouchLayerPolicy === 'generate_retouch_layer') warnings.add('retouch_layer_required');
  return [...warnings].sort();
};

const stableFocusRuntimeHash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const hashFocusRuntimePixels = (pixels: Float32Array): string => {
  let value = 2166136261;
  for (const pixel of pixels) {
    value ^= Math.round(pixel * 1_000_000);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const isFocusStackRuntimeCommand = (
  command: ComputationalMergeCommandEnvelopeV1,
): command is FocusStackRuntimeCommandV1 => command.commandType === 'computationalMerge.createFocusStack';

const roundFocusMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
