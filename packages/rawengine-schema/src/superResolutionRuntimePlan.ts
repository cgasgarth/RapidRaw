import { z } from 'zod';

import {
  buildComputationalMergeArtifactHandleV1,
  buildComputationalMergeDryRunResultV1,
  buildComputationalMergeMutationResultV1,
} from './computationalMergeRuntimeResultBuilders.js';
import {
  computationalMergeCommandEnvelopeV1Schema,
  type ArtifactHandleV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  type SuperResolutionArtifactV1,
} from './rawEngineSchemas.js';
import {
  assertSuperResolutionAlignmentDiagnosticsRenderableV1,
  buildSuperResolutionAlignmentDiagnosticsV1,
  superResolutionAlignmentDiagnosticsV1Schema,
} from './superResolutionAlignmentDiagnostics.js';
import { applyPixelShiftSuperResolutionV1, createNearestNeighborBaselineV1 } from './superResolutionPixelShift.js';
import {
  buildSuperResolutionReconstructionDiagnosticsV1,
  superResolutionReconstructionDiagnosticsV1Schema,
} from './superResolutionReconstructionDiagnostics.js';
import { buildSuperResolutionArtifactSidecarRecordV1 } from './superResolutionSidecarProvenance.js';

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
    alignmentDiagnostics: superResolutionAlignmentDiagnosticsV1Schema,
    changedPixelRatioAgainstNearest: z.number().min(0).max(1),
    confidenceMap: z
      .object({
        completeSampleRatio: z.number().min(0).max(1),
        maxSampleCount: z.number().int().positive(),
        meanSampleCount: z.number().positive(),
        minSampleCount: z.number().int().positive(),
      })
      .strict(),
    detailPolicy: z.enum(['conservative', 'balanced', 'aggressive_preview_only']),
    detailQuality: z
      .object({
        nearestBaselineChangedPixelRatio: z.number().min(0).max(1),
        outputPixelCount: z.number().int().positive(),
        sourcePixelCount: z.number().int().positive(),
        sourceToOutputPixelRatio: z.number().positive(),
      })
      .strict(),
    effectiveOutputScale: z.number().min(1).max(4),
    engineId: z.literal(SR_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(SR_RUNTIME_ENGINE_VERSION),
    frameRegistrations: z
      .array(
        z
          .object({
            confidence: z.number().min(0).max(1),
            shiftX: z.number().int().nonnegative(),
            shiftY: z.number().int().nonnegative(),
            sourceIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(2),
    mode: z.enum(['single_image', 'multi_image']),
    reconstructionMode: z.enum(['model_detail', 'optical_flow']),
    requestedAlignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
    requestedOutputScale: z.number().min(1.1).max(4),
    reconstructionDiagnostics: superResolutionReconstructionDiagnosticsV1Schema,
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
    supportMap: z
      .object({
        artifactId: z.string().trim().min(1),
        coverageRatio: z.number().min(0).max(1),
        downgradeReason: z.string().trim().min(1).optional(),
        effectiveScale: z.number().min(1).max(4),
        requestedScale: z.number().min(1.1).max(4),
        reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
        weakSupportRatio: z.number().min(0).max(1),
      })
      .strict(),
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
  sidecarArtifact: SuperResolutionArtifactV1;
}

export const buildSuperResolutionRuntimeDryRunV1 = (requestValue: unknown): SuperResolutionRuntimeDryRunResultV1 => {
  const request = parseSuperResolutionRuntimePlanRequest(requestValue, true);
  const runtime = renderSuperResolutionRuntime(request);
  const planId = `sr_plan_${request.command.commandId}`;
  const planHash = `sha256:${stableSrRuntimeHash(`${planId}:${runtime.provenance.effectiveOutputScale}`)}`;
  const renderedContentHash = hashSrRuntimePixels(runtime.outputPixels);
  const previewArtifacts = [
    buildComputationalMergeArtifactHandleV1({
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stableSrRuntimeHash(`${planHash}:${request.previewArtifactId}:${renderedContentHash}`)}`,
      height: runtime.height,
      kind: 'preview',
      storage: 'temp_cache',
      width: runtime.width,
    }),
  ];

  const dryRunResult = buildComputationalMergeDryRunResultV1({
    command: request.command,
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
    predictedGraphRevision: `${request.command.expectedGraphRevision}:sr-preview`,
    previewArtifacts,
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

  const renderedContentHash = hashSrRuntimePixels(runtime.outputPixels);
  const outputArtifacts: ArtifactHandleV1[] = [
    buildComputationalMergeArtifactHandleV1({
      artifactId: request.outputArtifactId,
      contentHash: `sha256:${stableSrRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.outputArtifactId}:${renderedContentHash}`,
      )}`,
      height: runtime.height,
      kind: 'merge_output',
      storage: 'sidecar_artifact',
      width: runtime.width,
    }),
    buildComputationalMergeArtifactHandleV1({
      artifactId: request.confidenceMapArtifactId,
      contentHash: `sha256:${stableSrRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.confidenceMapArtifactId}:${renderedContentHash}`,
      )}`,
      height: runtime.height,
      kind: 'mask',
      storage: 'sidecar_artifact',
      width: runtime.width,
    }),
  ];
  const outputArtifact = outputArtifacts.find((artifact) => artifact.kind === 'merge_output');
  if (outputArtifact === undefined) {
    throw new Error('Super-resolution runtime apply did not produce an output artifact.');
  }
  const provenance = superResolutionRuntimeProvenanceV1Schema.parse({
    ...runtime.provenance,
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    runtimeStatus: 'apply_rendered',
  });

  const mutationResult = buildComputationalMergeMutationResultV1({
    appliedGraphRevision: `${request.command.expectedGraphRevision}:sr-apply`,
    changedNodeIds: [`node_${request.command.commandId}`],
    command: request.command,
    derivedAssetId: `derived_${request.command.commandId}`,
    outputArtifacts,
    undoRevision: `${request.command.expectedGraphRevision}:undo-sr-apply`,
    warnings: runtime.warnings,
  });

  return {
    mutationResult,
    outputPixels: runtime.outputPixels,
    provenance,
    sidecarArtifact: buildSuperResolutionArtifactSidecarRecordV1({
      command: request.command,
      createdAt: new Date().toISOString(),
      outputArtifact,
      previewArtifacts: [],
      provenance,
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
  const scale = getEffectiveRuntimeScale(request.command.parameters.outputScale, request.frames.length);
  const alignmentDiagnostics = buildSuperResolutionAlignmentDiagnosticsV1(request.frames, scale);
  const renderable = isSuperResolutionAlignmentRenderable(alignmentDiagnostics);
  if (!renderable && request.command.dryRun) {
    return renderDegradedSuperResolutionDryRun(request, alignmentDiagnostics, firstFrame, scale);
  }
  assertSuperResolutionAlignmentDiagnosticsRenderableV1(alignmentDiagnostics);
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
  const confidenceMap = buildSrConfidenceMap(
    request.frames,
    result.outputWidth,
    result.outputHeight,
    result.outputScale,
  );

  return {
    height: result.outputHeight,
    outputPixels: result.outputPixels,
    provenance: superResolutionRuntimeProvenanceV1Schema.parse({
      alignmentDiagnostics,
      changedPixelRatioAgainstNearest: roundSrMetric(result.changedPixelRatioAgainstNearest),
      confidenceMap,
      detailPolicy: request.command.parameters.detailPolicy,
      detailQuality: buildSrDetailQuality(
        request.frames,
        result.outputWidth,
        result.outputHeight,
        result.changedPixelRatioAgainstNearest,
      ),
      effectiveOutputScale: result.outputScale,
      engineId: SR_RUNTIME_ENGINE_ID,
      engineVersion: SR_RUNTIME_ENGINE_VERSION,
      frameRegistrations: request.frames.map((frame) => ({
        confidence: alignmentDiagnostics.confidence,
        shiftX: frame.shiftX,
        shiftY: frame.shiftY,
        sourceIndex: frame.sourceIndex,
      })),
      mode: request.command.parameters.mode,
      reconstructionMode: request.command.parameters.reconstructionMode,
      requestedAlignmentMode: request.command.parameters.alignmentMode,
      requestedOutputScale: request.command.parameters.outputScale,
      reconstructionDiagnostics: result.reconstructionDiagnostics,
      resolvedAlignmentMode: request.command.parameters.alignmentMode,
      runtimeStatus: 'dry_run_rendered',
      sourceState: request.frames.map((frame) => ({
        contentHash: frame.contentHash,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
      supportMap: buildSrSupportMap(
        request.confidenceMapArtifactId,
        result.outputScale,
        request.command.parameters.outputScale,
        confidenceMap.completeSampleRatio,
        request.command.parameters.detailPolicy,
      ),
    }),
    warnings,
    width: result.outputWidth,
  };
};

const renderDegradedSuperResolutionDryRun = (
  request: ParsedSuperResolutionRuntimePlanRequestV1,
  alignmentDiagnostics: SuperResolutionRuntimeProvenanceV1['alignmentDiagnostics'],
  firstFrame: SuperResolutionRuntimeFrameV1,
  scale: number,
) => {
  const outputWidth = firstFrame.width * scale;
  const outputHeight = firstFrame.height * scale;
  const outputPixels = createNearestNeighborBaselineV1(firstFrame.pixels, firstFrame.width, firstFrame.height, scale);
  const confidenceMap = buildSrConfidenceMap(request.frames, outputWidth, outputHeight, scale);
  const sampleCounts = buildSrSampleCounts(request.frames, outputWidth, outputHeight, scale);
  const reconstructionDiagnostics = buildSuperResolutionReconstructionDiagnosticsV1({
    outputPixelCount: outputWidth * outputHeight,
    outputPixels,
    outputScale: scale,
    sampleCounts,
  });
  const warnings = ['support_map_blocked', ...deriveSrWarnings(0, request.command.parameters.detailPolicy)].sort();

  return {
    height: outputHeight,
    outputPixels,
    provenance: superResolutionRuntimeProvenanceV1Schema.parse({
      alignmentDiagnostics,
      changedPixelRatioAgainstNearest: 0,
      confidenceMap,
      detailPolicy: request.command.parameters.detailPolicy,
      detailQuality: buildSrDetailQuality(request.frames, outputWidth, outputHeight, 0),
      effectiveOutputScale: scale,
      engineId: SR_RUNTIME_ENGINE_ID,
      engineVersion: SR_RUNTIME_ENGINE_VERSION,
      frameRegistrations: request.frames.map((frame) => ({
        confidence: alignmentDiagnostics.confidence,
        shiftX: frame.shiftX,
        shiftY: frame.shiftY,
        sourceIndex: frame.sourceIndex,
      })),
      mode: request.command.parameters.mode,
      reconstructionMode: request.command.parameters.reconstructionMode,
      requestedAlignmentMode: request.command.parameters.alignmentMode,
      requestedOutputScale: request.command.parameters.outputScale,
      reconstructionDiagnostics,
      resolvedAlignmentMode: request.command.parameters.alignmentMode,
      runtimeStatus: 'dry_run_rendered',
      sourceState: request.frames.map((frame) => ({
        contentHash: frame.contentHash,
        graphRevision: frame.graphRevision,
        sourceIndex: frame.sourceIndex,
      })),
      supportMap: buildSrSupportMap(
        request.confidenceMapArtifactId,
        scale,
        request.command.parameters.outputScale,
        confidenceMap.completeSampleRatio,
        request.command.parameters.detailPolicy,
        true,
      ),
    }),
    warnings,
    width: outputWidth,
  };
};

const isSuperResolutionAlignmentRenderable = (
  diagnostics: SuperResolutionRuntimeProvenanceV1['alignmentDiagnostics'],
): boolean =>
  diagnostics.geometryConsistent &&
  (diagnostics.missingShiftPhases === undefined || diagnostics.missingShiftPhases.length === 0) &&
  (diagnostics.duplicateShiftPhases === undefined || diagnostics.duplicateShiftPhases.length === 0);

const buildSrSupportMap = (
  artifactId: string,
  effectiveScale: number,
  requestedScale: number,
  coverageRatio: number,
  detailPolicy: SuperResolutionRuntimeProvenanceV1['detailPolicy'],
  blocked = false,
): SuperResolutionRuntimeProvenanceV1['supportMap'] => {
  const weakSupportRatio = roundSrMetric(1 - coverageRatio);
  const downgradeReason = effectiveScale < requestedScale ? 'effective_scale_downgraded' : undefined;
  const reviewStatus = blocked
    ? 'blocked'
    : downgradeReason !== undefined || weakSupportRatio > 0.25 || detailPolicy === 'aggressive_preview_only'
      ? 'review_required'
      : 'apply_ready';

  return {
    artifactId,
    coverageRatio: roundSrMetric(coverageRatio),
    downgradeReason,
    effectiveScale,
    requestedScale,
    reviewStatus,
    weakSupportRatio,
  };
};

const buildSrSampleCounts = (
  frames: SuperResolutionRuntimeFrameV1[],
  outputWidth: number,
  outputHeight: number,
  outputScale: number,
): Uint8Array => {
  const sampleCounts = new Uint8Array(outputWidth * outputHeight);
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const outputX = Math.trunc(x * outputScale + frame.shiftX);
        const outputY = Math.trunc(y * outputScale + frame.shiftY);
        const outputIndex = outputY * outputWidth + outputX;
        if (outputIndex >= 0 && outputIndex < sampleCounts.length) {
          sampleCounts[outputIndex] = Math.min(255, (sampleCounts[outputIndex] ?? 0) + 1);
        }
      }
    }
  }
  return sampleCounts;
};

const getEffectiveRuntimeScale = (requestedScale: number, sourceCount: number): number => {
  const sourceLimitedScale = Math.max(2, Math.floor(Math.sqrt(sourceCount)));
  return Math.min(requestedScale, sourceLimitedScale);
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

const buildSrConfidenceMap = (
  frames: SuperResolutionRuntimeFrameV1[],
  outputWidth: number,
  outputHeight: number,
  outputScale: number,
): SuperResolutionRuntimeProvenanceV1['confidenceMap'] => {
  const sampleCounts = new Uint16Array(outputWidth * outputHeight);
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const outputX = Math.trunc(x * outputScale + frame.shiftX);
        const outputY = Math.trunc(y * outputScale + frame.shiftY);
        const outputIndex = outputY * outputWidth + outputX;
        if (outputIndex >= 0 && outputIndex < sampleCounts.length) {
          sampleCounts[outputIndex] = (sampleCounts[outputIndex] ?? 0) + 1;
        }
      }
    }
  }

  let coveredPixelCount = 0;
  let maxSampleCount = 0;
  let minSampleCount = Number.POSITIVE_INFINITY;
  let sampleCountTotal = 0;
  for (const sampleCount of sampleCounts) {
    if (sampleCount === 0) continue;
    coveredPixelCount += 1;
    maxSampleCount = Math.max(maxSampleCount, sampleCount);
    minSampleCount = Math.min(minSampleCount, sampleCount);
    sampleCountTotal += sampleCount;
  }

  return {
    completeSampleRatio: roundSrMetric(coveredPixelCount / Math.max(1, sampleCounts.length)),
    maxSampleCount: Math.max(1, maxSampleCount),
    meanSampleCount: roundSrMetric(sampleCountTotal / Math.max(1, coveredPixelCount)),
    minSampleCount: Number.isFinite(minSampleCount) ? minSampleCount : 1,
  };
};

const buildSrDetailQuality = (
  frames: SuperResolutionRuntimeFrameV1[],
  outputWidth: number,
  outputHeight: number,
  changedPixelRatioAgainstNearest: number,
): SuperResolutionRuntimeProvenanceV1['detailQuality'] => {
  const sourcePixelCount = frames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const outputPixelCount = outputWidth * outputHeight;
  return {
    nearestBaselineChangedPixelRatio: roundSrMetric(changedPixelRatioAgainstNearest),
    outputPixelCount,
    sourcePixelCount,
    sourceToOutputPixelRatio: roundSrMetric(sourcePixelCount / outputPixelCount),
  };
};

const stableSrRuntimeHash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const hashSrRuntimePixels = (pixels: Float32Array): string => {
  let value = 2166136261;
  for (const pixel of pixels) {
    value ^= Math.round(pixel * 1_000_000);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const isSuperResolutionRuntimeCommand = (
  command: ComputationalMergeCommandEnvelopeV1,
): command is SuperResolutionRuntimeCommandV1 => command.commandType === 'computationalMerge.createSuperResolution';

const roundSrMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
