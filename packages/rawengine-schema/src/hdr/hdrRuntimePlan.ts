import { z } from 'zod';
import {
  type ArtifactHandleV1,
  artifactHandleV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type HdrBracketDetectionResultV1,
  type HdrMergeArtifactV1,
  hdrMergeArtifactV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../rawEngineSchemas.js';
import { estimateHdrAlignmentTransformsV1 } from './hdrAlignmentRuntime.js';
import { detectHdrBracketV1, type HdrBracketDetectionSourceInputV1 } from './hdrBracketDetection.js';
import {
  buildHdrDeghostConfidenceMapV1,
  countHdrMotionPixelsV1,
  detectHdrMotionMaskV1,
  summarizeHdrDeghostConfidenceMapV1,
} from './hdrDeghostRuntime.js';
import { mergeExposureWeightedRadianceV1 } from './hdrMergeWeightingRuntime.js';

const HDR_RUNTIME_ENGINE_ID = 'rawengine_hdr_runtime_v1';
const HDR_RUNTIME_ENGINE_VERSION = '0.1.0';

export const hdrRuntimeFrameV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    exposureEv: z.number(),
    graphRevision: z.string().trim().min(1),
    height: z.number().int().positive(),
    pixels: z.instanceof(Float64Array),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

export const hdrRuntimePlanRequestV1Schema = z
  .object({
    clipThreshold: z.number().min(0).max(1).default(0.99),
    command: computationalMergeCommandEnvelopeV1Schema,
    frames: z.array(hdrRuntimeFrameV1Schema).min(2),
    maxReconstructionMae: z.number().positive().default(0.015),
    motionThreshold: z.number().nonnegative().default(0.22),
    outputArtifactId: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    sensorWhiteRadiance: z.number().positive().default(1),
    syntheticScenePixels: z.instanceof(Float64Array).optional(),
    searchRadiusPx: z.number().int().nonnegative().default(5),
  })
  .strict();

export const hdrRuntimeProvenanceV1Schema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
    acceptedDryRunPlanId: z.string().trim().min(1).optional(),
    alignmentConfidence: z.number().min(0).max(1),
    alignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']),
    alignmentTransforms: z
      .array(
        z
          .object({
            confidence: z.number().min(0).max(1),
            overlapRatio: z.number().min(0).max(1),
            rmsError: z.number().nonnegative(),
            sourceIndex: z.number().int().nonnegative(),
            transformType: z.enum(['identity', 'translation']),
            translationPx: z
              .object({
                x: z.number().int(),
                y: z.number().int(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(2),
    deghosting: z.enum(['off', 'low', 'medium', 'high']),
    deghostConfidenceMap: z
      .object({
        averageConfidence: z.number().min(0).max(1),
        maxConfidence: z.number().min(0).max(1),
        motionCoverageRatio: z.number().min(0).max(1),
        visible: z.boolean(),
      })
      .strict(),
    deghostRegionIntensityPercent: z.number().int().min(0).max(100),
    derivedSourceReview: z
      .object({
        blockCodes: z.array(z.string().trim().min(1)),
        bracketReadiness: z.enum(['accepted', 'blocked', 'warning']),
        displayPreviewArtifact: artifactHandleV1Schema,
        exportPreviewArtifact: artifactHandleV1Schema,
        nextActions: z.array(z.enum(['adjust_brackets', 'approve_plan', 'inspect_motion_mask', 'review_tone_map'])),
        reviewStatus: z.enum(['apply_ready', 'blocked', 'review_required']),
        sceneLinearArtifact: artifactHandleV1Schema,
        warningCodes: z.array(z.string().trim().min(1)),
      })
      .strict(),
    engineId: z.literal(HDR_RUNTIME_ENGINE_ID),
    engineVersion: z.literal(HDR_RUNTIME_ENGINE_VERSION),
    mergeStrategy: z.enum(['scene_linear_radiance', 'exposure_fusion_preview']),
    motionCoverageRatio: z.number().min(0).max(1),
    qualityMetrics: z
      .object({
        clippedInputPixelRatio: z.number().min(0).max(1),
        maxReconstructionMae: z.number().positive(),
        motionPixelCount: z.number().int().nonnegative(),
        reconstructionMae: z.number().nonnegative().optional(),
      })
      .strict(),
    referenceSourceIndex: z.number().int().nonnegative(),
    runtimeStatus: z.enum(['dry_run_rendered', 'apply_rendered']),
    sourceState: z.array(
      z
        .object({
          contentHash: z.string().trim().min(1),
          exposureWeightMultiplier: z.number().positive(),
          graphRevision: z.string().trim().min(1),
          resolvedExposureEv: z.number(),
          sourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    toneMapPreview: z.boolean(),
  })
  .strict();

export type HdrRuntimeFrameV1 = z.infer<typeof hdrRuntimeFrameV1Schema>;
export type HdrRuntimePlanRequestV1 = z.infer<typeof hdrRuntimePlanRequestV1Schema>;
export type HdrRuntimeProvenanceV1 = z.infer<typeof hdrRuntimeProvenanceV1Schema>;
type HdrRuntimeCommandV1 = Extract<
  ComputationalMergeCommandEnvelopeV1,
  { commandType: 'computationalMerge.createHdr' }
>;
type ParsedHdrRuntimePlanRequestV1 = Omit<HdrRuntimePlanRequestV1, 'command'> & {
  bracketPolicy: HdrBracketDetectionResultV1;
  bracketPolicyWarnings: string[];
  command: HdrRuntimeCommandV1;
};

export interface HdrRuntimeDryRunResultV1 {
  dryRunResult: ComputationalMergeDryRunResultV1;
  mergedPixels: Float64Array;
  motionConfidenceMap: Float64Array;
  motionMask: Uint8Array;
  provenance: HdrRuntimeProvenanceV1;
}

export interface HdrRuntimeApplyResultV1 {
  mergedPixels: Float64Array;
  motionConfidenceMap: Float64Array;
  mutationResult: ComputationalMergeMutationResultV1;
  provenance: HdrRuntimeProvenanceV1;
  sidecarArtifact: HdrMergeArtifactV1;
}

export const buildHdrRuntimeDryRunV1 = (requestValue: unknown): HdrRuntimeDryRunResultV1 => {
  const request = parseHdrRuntimePlanRequest(requestValue, true);
  const runtime = renderHdrRuntimePixels(request);
  const planId = `hdr_plan_${request.command.commandId}`;
  const sourceSignature = request.command.parameters.sources
    .map((source) => `${source.sourceIndex}:${source.exposureEv ?? 'none'}:${source.exposureWeightMultiplier ?? 1}`)
    .join('|');
  const planHash = `sha256:${stableHdrRuntimeHash(
    `${planId}:${sourceSignature}:${runtime.provenance.alignmentMode}:${runtime.provenance.deghosting}:${
      runtime.provenance.deghostRegionIntensityPercent
    }:${String(runtime.provenance.deghostConfidenceMap.visible)}`,
  )}`;
  const renderedContentHash = hashHdrRuntimePixels(runtime.mergedPixels);
  const previewArtifacts = [
    {
      artifactId: request.previewArtifactId,
      contentHash: `sha256:${stableHdrRuntimeHash(`${planHash}:${request.previewArtifactId}:${renderedContentHash}`)}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'preview' as const,
      storage: 'temp_cache' as const,
    },
    runtime.provenance.derivedSourceReview.sceneLinearArtifact,
    runtime.provenance.derivedSourceReview.displayPreviewArtifact,
    runtime.provenance.derivedSourceReview.exportPreviewArtifact,
  ];

  const dryRunResult = computationalMergeDryRunResultV1Schema.parse({
    commandId: request.command.commandId,
    commandType: request.command.commandType,
    correlationId: request.command.correlationId,
    dryRun: true,
    mergePlan: {
      family: 'hdr',
      outputDimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      outputName: request.command.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: runtime.width * runtime.height * request.command.parameters.sources.length * 8,
        estimatedRuntimeMs: 1,
        requiresBackgroundJob: false,
      },
      planId,
      preflight: buildHdrPreflightEstimate(request, runtime.width, runtime.height),
      qualityMetrics: {
        alignmentConfidence: runtime.provenance.alignmentConfidence,
        deghostingRisk: motionRiskForCoverage(runtime.provenance.motionCoverageRatio),
        sourceCount: request.command.parameters.sources.length,
      },
      sourceImageRefs: request.command.parameters.sources,
      warnings: runtime.warnings,
    },
    mutates: false,
    predictedGraphRevision: `${request.command.expectedGraphRevision}:hdr-preview`,
    previewArtifacts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: request.command.expectedGraphRevision,
    warnings: runtime.warnings,
  });

  return {
    dryRunResult,
    mergedPixels: runtime.mergedPixels,
    motionConfidenceMap: runtime.motionConfidenceMap,
    motionMask: runtime.motionMask,
    provenance: runtime.provenance,
  };
};

export const applyHdrRuntimePlanV1 = (requestValue: unknown): HdrRuntimeApplyResultV1 => {
  const request = parseHdrRuntimePlanRequest(requestValue, false);
  const runtime = renderHdrRuntimePixels(request);
  const acceptedDryRunPlanHash = request.command.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = request.command.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('HDR runtime apply requires an accepted dry-run plan id and hash.');
  }
  if (runtime.provenance.derivedSourceReview.reviewStatus === 'blocked') {
    throw new Error(
      `HDR runtime apply blocked by derived-source review: ${runtime.provenance.derivedSourceReview.blockCodes.join(', ')}.`,
    );
  }
  const renderedContentHash = hashHdrRuntimePixels(runtime.mergedPixels);
  const outputArtifacts = [
    {
      artifactId: request.outputArtifactId,
      contentHash: `sha256:${stableHdrRuntimeHash(
        `${acceptedDryRunPlanHash}:${request.outputArtifactId}:${renderedContentHash}`,
      )}`,
      dimensions: {
        height: runtime.height,
        width: runtime.width,
      },
      kind: 'merge_output' as const,
      storage: 'sidecar_artifact' as const,
    },
  ];
  const [outputArtifact] = outputArtifacts;
  if (outputArtifact === undefined) {
    throw new Error('HDR runtime apply did not produce an output artifact.');
  }

  const mutationResult = computationalMergeMutationResultV1Schema.parse({
    appliedGraphRevision: `${request.command.expectedGraphRevision}:hdr-apply`,
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
    undoRevision: `${request.command.expectedGraphRevision}:undo-hdr-apply`,
    warnings: runtime.warnings,
  });
  const provenance = hdrRuntimeProvenanceV1Schema.parse({
    ...runtime.provenance,
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    runtimeStatus: 'apply_rendered',
  });

  return {
    mergedPixels: runtime.mergedPixels,
    motionConfidenceMap: runtime.motionConfidenceMap,
    mutationResult,
    provenance,
    sidecarArtifact: buildHdrRuntimeSidecarArtifact({
      command: request.command,
      createdAt: new Date().toISOString(),
      frames: request.frames,
      outputArtifact,
      provenance,
      warningCodes: runtime.warnings,
    }),
  };
};

const buildHdrRuntimeSidecarArtifact = ({
  command,
  createdAt,
  frames,
  outputArtifact,
  provenance,
  warningCodes,
}: {
  command: HdrRuntimeCommandV1;
  createdAt: string;
  frames: HdrRuntimeFrameV1[];
  outputArtifact: ArtifactHandleV1;
  provenance: HdrRuntimeProvenanceV1;
  warningCodes: string[];
}): HdrMergeArtifactV1 => {
  const sourceByIndex = new Map(command.parameters.sources.map((source) => [source.sourceIndex, source]));
  const bracketDetection = detectHdrBracketV1({
    sources: frames.map((frame) => {
      const source = sourceByIndex.get(frame.sourceIndex);
      return {
        contentHash: frame.contentHash,
        declaredExposureEv: frame.exposureEv,
        graphRevision: frame.graphRevision,
        height: frame.height,
        imageId: source?.imageId,
        imagePath: source?.imagePath ?? `source-${frame.sourceIndex}`,
        rawBlackLevelKnown: true,
        rawWhiteLevelKnown: true,
        resolvedExposureEv: frame.exposureEv,
        sourceIndex: frame.sourceIndex,
        whiteBalanceComparable: true,
        width: frame.width,
      };
    }),
  });

  return hdrMergeArtifactV1Schema.parse({
    alignment: {
      alignmentConfidence: provenance.alignmentConfidence,
      referenceSourceIndex: provenance.referenceSourceIndex,
      rejectedSourceIndexes: [],
      requestedAlignmentMode: provenance.alignmentMode,
      resolvedAlignmentMode: provenance.alignmentMode,
      transforms: provenance.alignmentTransforms.map((transform) => ({
        confidence: transform.confidence,
        sourceIndex: transform.sourceIndex,
        transformType: transform.transformType,
        translationPx: transform.translationPx,
      })),
    },
    artifactId: `artifact_record_${outputArtifact.artifactId}`,
    blockCodes: bracketDetection.blockCodes,
    bracketDetection,
    createdAt,
    deghosting: {
      confidenceMapVisible: provenance.deghostConfidenceMap.visible,
      masks: [],
      motionCoverageRatio: provenance.motionCoverageRatio,
      motionRisk: motionRiskForCoverage(provenance.motionCoverageRatio),
      referenceSourceIndex: provenance.referenceSourceIndex,
      regionIntensityPercent: provenance.deghostRegionIntensityPercent,
      requestedDeghosting: provenance.deghosting,
      resolvedDeghosting: provenance.deghosting,
    },
    dryRun: {
      acceptedDryRunPlanHash: provenance.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: provenance.acceptedDryRunPlanId,
    },
    editableDerivedAssetId: `derived_${command.commandId}`,
    engine: {
      backendType: 'local_cpu',
      capabilityLevel: 'runtime_apply_capable',
      engineId: provenance.engineId,
      engineVersion: provenance.engineVersion,
    },
    family: 'hdr',
    highlightRecovery: {
      clippedInputPixelRatioBySource: frames.map((frame) => ({
        clippedHighRatio: provenance.qualityMetrics.clippedInputPixelRatio,
        nearClippedHighRatio: provenance.qualityMetrics.clippedInputPixelRatio,
        sourceIndex: frame.sourceIndex,
      })),
      highlightDetailGainRatio: 1,
      recoveredHighlightPixelRatio: Math.max(0, 1 - provenance.qualityMetrics.clippedInputPixelRatio),
      shadowNoiseAmplificationRisk: warningCodes.includes('noise_risk_in_shadow_recovery') ? 'medium' : 'low',
      unrecoveredClippedPixelRatio: provenance.qualityMetrics.clippedInputPixelRatio,
    },
    mergeStrategy: provenance.mergeStrategy,
    outputArtifact,
    outputColorSpace: command.parameters.sources[0]?.colorSpaceHint ?? 'camera_linear_rgb',
    outputEncoding: 'scene_linear_half_float',
    outputName: command.parameters.outputName,
    previewArtifacts: [],
    previewToneMapped: provenance.toneMapPreview,
    schemaVersion: command.schemaVersion,
    sourceImageRefs: command.parameters.sources,
    sourceState: provenance.sourceState,
    staleState: {
      checkedAt: createdAt,
      invalidationReasons: [],
      state: 'current',
    },
    warningCodes,
    workingColorSpace: 'scene_linear_camera_rgb',
  });
};

const parseHdrRuntimePlanRequest = (requestValue: unknown, dryRun: boolean): ParsedHdrRuntimePlanRequestV1 => {
  const request = hdrRuntimePlanRequestV1Schema.parse(requestValue);
  if (!isHdrRuntimeCommand(request.command)) {
    throw new Error('HDR runtime plan only supports computationalMerge.createHdr commands.');
  }
  if (request.command.dryRun !== dryRun) {
    throw new Error(`HDR runtime plan expected dryRun=${String(dryRun)}.`);
  }

  const firstFrame = request.frames[0];
  if (firstFrame === undefined) {
    throw new Error('HDR runtime plan requires at least one frame.');
  }

  for (const frame of request.frames) {
    if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
      throw new Error('HDR runtime plan requires equal-size frames.');
    }
    if (frame.pixels.length !== frame.width * frame.height) {
      throw new Error('HDR runtime plan frame pixel length does not match dimensions.');
    }
  }

  const frameIndexes = new Set(request.frames.map((frame) => frame.sourceIndex));
  for (const source of request.command.parameters.sources) {
    if (!frameIndexes.has(source.sourceIndex)) {
      throw new Error(`HDR runtime plan missing frame for command source ${source.sourceIndex}.`);
    }
  }

  const parsedRequest = { ...request, command: request.command };
  const bracketPolicy = evaluateHdrRuntimeBracketPolicy(parsedRequest);
  if (!dryRun && request.command.parameters.bracketValidation === 'required' && !bracketPolicy.accepted) {
    throw new Error(`HDR runtime bracket validation failed: ${bracketPolicy.blockCodes.join(', ')}`);
  }

  return {
    ...parsedRequest,
    bracketPolicy,
    bracketPolicyWarnings: getHdrRuntimeBracketPolicyWarnings(request.command, bracketPolicy),
  };
};

const renderHdrRuntimePixels = (request: ParsedHdrRuntimePlanRequestV1) => {
  const commandSourcesByIndex = new Map(
    request.command.parameters.sources.map((source) => [source.sourceIndex, source]),
  );
  const selectedFrames = request.frames.filter((frame) => commandSourcesByIndex.has(frame.sourceIndex));
  const referenceSourceIndex = findReferenceSourceIndex(request.command);
  const alignment = estimateHdrAlignmentTransformsV1({
    frames: selectedFrames.map((frame) => ({
      height: frame.height,
      pixels: normalizeFrameForAlignment(frame),
      sourceIndex: frame.sourceIndex,
      width: frame.width,
    })),
    referenceSourceIndex,
    searchRadiusPx: request.command.parameters.alignmentMode === 'none' ? 0 : request.searchRadiusPx,
  });
  const alignedFrames = alignHdrRuntimeFrames(selectedFrames, alignment.transforms);
  const captures = alignedFrames.map((frame) => ({
    exposureEv: frame.exposureEv,
    exposureWeightMultiplier: commandSourcesByIndex.get(frame.sourceIndex)?.exposureWeightMultiplier ?? 1,
    pixels: frame.pixels,
    sourceIndex: frame.sourceIndex,
  }));
  const mergedPixels = mergeExposureWeightedRadianceV1({
    captures,
    clipThreshold: request.clipThreshold,
    height: request.frames[0]?.height,
    sensorWhiteRadiance: request.sensorWhiteRadiance,
    width: request.frames[0]?.width,
  });
  const deghostRequest = {
    frames: alignedFrames.map((frame) => ({
      height: frame.height,
      pixels: normalizeFrameForAlignment(frame),
      sourceIndex: frame.sourceIndex,
      width: frame.width,
    })),
    motionThreshold: request.command.parameters.deghosting === 'off' ? 1_000_000_000 : request.motionThreshold,
    referenceSourceIndex,
  };
  const motionMask = detectHdrMotionMaskV1(deghostRequest);
  const motionConfidenceMap = buildHdrDeghostConfidenceMapV1(deghostRequest);
  const deghostConfidenceMap = summarizeHdrDeghostConfidenceMapV1(motionConfidenceMap, motionMask);
  const motionCoverageRatio = countHdrMotionPixelsV1(motionMask) / motionMask.length;
  applyReferencePixelsInMotionRegions(
    mergedPixels,
    alignedFrames,
    motionMask,
    referenceSourceIndex,
    request.command.parameters.deghostRegionIntensityPercent,
  );
  const warnings = deriveRuntimeWarnings(
    alignment.alignmentConfidence,
    motionCoverageRatio,
    request.command.parameters.deghosting,
    request.bracketPolicyWarnings,
  );
  const firstFrame = selectedFrames[0];
  if (firstFrame === undefined) {
    throw new Error('HDR runtime plan requires at least one frame.');
  }

  return {
    height: firstFrame.height,
    mergedPixels,
    motionConfidenceMap,
    motionMask,
    provenance: hdrRuntimeProvenanceV1Schema.parse({
      alignmentConfidence: alignment.alignmentConfidence,
      alignmentMode: request.command.parameters.alignmentMode,
      alignmentTransforms: alignment.transforms,
      deghosting: request.command.parameters.deghosting,
      deghostConfidenceMap: {
        ...deghostConfidenceMap,
        visible: request.command.parameters.deghostConfidenceMapVisible,
      },
      deghostRegionIntensityPercent: request.command.parameters.deghostRegionIntensityPercent,
      derivedSourceReview: buildHdrDerivedSourceReview(request, alignment.alignmentConfidence, motionCoverageRatio),
      engineId: HDR_RUNTIME_ENGINE_ID,
      engineVersion: HDR_RUNTIME_ENGINE_VERSION,
      mergeStrategy: request.command.parameters.mergeStrategy,
      motionCoverageRatio: roundHdrRuntimeMetric(motionCoverageRatio),
      qualityMetrics: buildHdrRuntimeQualityMetrics(request, mergedPixels, motionMask),
      referenceSourceIndex,
      runtimeStatus: 'dry_run_rendered',
      sourceState: selectedFrames.map((frame) => ({
        contentHash: frame.contentHash,
        exposureWeightMultiplier: commandSourcesByIndex.get(frame.sourceIndex)?.exposureWeightMultiplier ?? 1,
        graphRevision: frame.graphRevision,
        resolvedExposureEv: frame.exposureEv,
        sourceIndex: frame.sourceIndex,
      })),
      toneMapPreview: request.command.parameters.toneMapPreview,
    }),
    warnings,
    width: firstFrame.width,
  };
};

const buildHdrDerivedSourceReview = (
  request: ParsedHdrRuntimePlanRequestV1,
  alignmentConfidence: number,
  motionCoverageRatio: number,
): HdrRuntimeProvenanceV1['derivedSourceReview'] => {
  const blockCodes =
    request.command.parameters.bracketValidation === 'required' && !request.bracketPolicy.accepted
      ? request.bracketPolicy.blockCodes
      : [];
  const warningCodes = [
    ...request.bracketPolicyWarnings,
    ...(alignmentConfidence < 0.95 ? ['alignment_low_confidence'] : []),
    ...(motionCoverageRatio > 0 ? ['motion_detected'] : []),
    ...(request.command.parameters.toneMapPreview ? ['tone_mapped_preview_only'] : []),
  ].sort();
  const reviewStatus =
    blockCodes.length > 0
      ? 'blocked'
      : warningCodes.length > 0 || motionCoverageRatio > 0
        ? 'review_required'
        : 'apply_ready';
  const bracketReadiness =
    blockCodes.length > 0 ? 'blocked' : request.bracketPolicy.warningCodes.length > 0 ? 'warning' : 'accepted';
  const dimensions = {
    height: request.frames[0]?.height ?? 1,
    width: request.frames[0]?.width ?? 1,
  };

  return {
    blockCodes,
    bracketReadiness,
    displayPreviewArtifact: {
      artifactId: `${request.previewArtifactId}:display-preview`,
      dimensions,
      kind: 'preview',
      storage: 'temp_cache',
    },
    exportPreviewArtifact: {
      artifactId: `${request.previewArtifactId}:export-preview`,
      dimensions,
      kind: 'preview',
      storage: 'temp_cache',
    },
    nextActions:
      reviewStatus === 'blocked'
        ? ['adjust_brackets', 'inspect_motion_mask']
        : reviewStatus === 'review_required'
          ? ['inspect_motion_mask', 'review_tone_map']
          : ['approve_plan'],
    reviewStatus,
    sceneLinearArtifact: {
      artifactId: `${request.previewArtifactId}:scene-linear`,
      dimensions,
      kind: 'preview',
      storage: 'temp_cache',
    },
    warningCodes,
  };
};

const alignHdrRuntimeFrames = (
  frames: HdrRuntimeFrameV1[],
  transforms: HdrRuntimeProvenanceV1['alignmentTransforms'],
): HdrRuntimeFrameV1[] =>
  frames.map((frame) => {
    const transform = transforms.find((candidate) => candidate.sourceIndex === frame.sourceIndex);
    if (transform === undefined) {
      throw new Error(`HDR runtime alignment missing transform for source ${frame.sourceIndex}.`);
    }

    return {
      ...frame,
      pixels: translateHdrRuntimePixels(frame.pixels, frame.width, frame.height, transform.translationPx),
    };
  });

const translateHdrRuntimePixels = (
  pixels: Float64Array,
  width: number,
  height: number,
  translationPx: HdrRuntimeProvenanceV1['alignmentTransforms'][number]['translationPx'],
): HdrRuntimeFrameV1['pixels'] => {
  const translated = new Float64Array(new ArrayBuffer(pixels.length * Float64Array.BYTES_PER_ELEMENT));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - translationPx.x;
      const sourceY = y - translationPx.y;
      if (!isInsideRuntimeImage(sourceX, sourceY, width, height)) continue;
      translated[getRuntimePixelIndex(x, y, width)] = pixels[getRuntimePixelIndex(sourceX, sourceY, width)] ?? 0;
    }
  }
  return translated;
};

const applyReferencePixelsInMotionRegions = (
  mergedPixels: Float64Array,
  frames: HdrRuntimeFrameV1[],
  motionMask: Uint8Array,
  referenceSourceIndex: number,
  regionIntensityPercent: number,
): void => {
  const referenceFrame = frames.find((frame) => frame.sourceIndex === referenceSourceIndex);
  if (referenceFrame === undefined) {
    throw new Error('HDR runtime plan reference frame was not found.');
  }

  const referenceBlendRatio = regionIntensityPercent / 100;
  for (let index = 0; index < motionMask.length; index += 1) {
    if (motionMask[index] !== 1) continue;
    const referencePixel = (referenceFrame.pixels[index] ?? 0) / 2 ** referenceFrame.exposureEv;
    mergedPixels[index] = (mergedPixels[index] ?? 0) * (1 - referenceBlendRatio) + referencePixel * referenceBlendRatio;
  }
};

const normalizeFrameForAlignment = (frame: HdrRuntimeFrameV1): Float64Array => {
  const pixels = new Float64Array(frame.pixels.length);
  for (let index = 0; index < frame.pixels.length; index += 1) {
    pixels[index] = (frame.pixels[index] ?? 0) / 2 ** frame.exposureEv;
  }
  return pixels;
};

const isInsideRuntimeImage = (x: number, y: number, width: number, height: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;

const getRuntimePixelIndex = (x: number, y: number, width: number): number => y * width + x;

const findReferenceSourceIndex = (command: HdrRuntimeCommandV1): number => {
  const referenceSource = command.parameters.sources.find((source) => source.exposureEv === 0);
  return referenceSource?.sourceIndex ?? command.parameters.sources[0]?.sourceIndex ?? 0;
};

const buildHdrPreflightEstimate = (request: ParsedHdrRuntimePlanRequestV1, width: number, height: number) => {
  const sourcePixelCount = request.frames.reduce((total, frame) => total + frame.width * frame.height, 0);
  const outputPixelCount = width * height;
  const sourceDecodeBytes = sourcePixelCount * 8;
  const outputCanvasBytes = outputPixelCount * 8;
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
      sourceCount: request.command.parameters.sources.length,
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

const deriveRuntimeWarnings = (
  alignmentConfidence: number,
  motionCoverageRatio: number,
  deghosting: HdrRuntimeProvenanceV1['deghosting'],
  bracketPolicyWarnings: string[],
): string[] => {
  const warnings = new Set<string>(['legacy_full_frame_render', ...bracketPolicyWarnings]);
  if (alignmentConfidence < 0.95) warnings.add('alignment_low_confidence');
  if (motionCoverageRatio > 0) warnings.add('motion_detected');
  if (motionCoverageRatio > 0 && deghosting !== 'off') warnings.add('deghost_mask_generated');
  return [...warnings].sort();
};

const evaluateHdrRuntimeBracketPolicy = (
  request: Omit<ParsedHdrRuntimePlanRequestV1, 'bracketPolicy' | 'bracketPolicyWarnings'>,
): HdrBracketDetectionResultV1 => {
  const framesBySourceIndex = new Map(request.frames.map((frame) => [frame.sourceIndex, frame]));
  const sources: HdrBracketDetectionSourceInputV1[] = request.command.parameters.sources.map((source) => {
    const frame = framesBySourceIndex.get(source.sourceIndex);
    if (frame === undefined) {
      throw new Error(`HDR runtime bracket validation missing frame for source ${source.sourceIndex}.`);
    }

    return {
      contentHash: frame.contentHash,
      declaredExposureEv: source.exposureEv ?? frame.exposureEv,
      graphRevision: frame.graphRevision,
      height: frame.height,
      imageId: source.imageId,
      imagePath: source.imagePath,
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: source.sourceIndex,
      whiteBalanceComparable: true,
      width: frame.width,
    };
  });

  return detectHdrBracketV1({ sources });
};

const getHdrRuntimeBracketPolicyWarnings = (
  command: HdrRuntimeCommandV1,
  bracketDetection: HdrBracketDetectionResultV1,
): string[] => {
  if (command.parameters.bracketValidation === 'disabled') return ['bracket_validation_disabled'];
  if (command.parameters.bracketValidation !== 'warn') return [];

  return [
    ...bracketDetection.blockCodes.map((blockCode) => `bracket_validation_block:${blockCode}`),
    ...bracketDetection.warningCodes.map((warningCode) => `bracket_validation_warning:${warningCode}`),
  ];
};

const buildHdrRuntimeQualityMetrics = (
  request: ParsedHdrRuntimePlanRequestV1,
  mergedPixels: Float64Array,
  motionMask: Uint8Array,
): HdrRuntimeProvenanceV1['qualityMetrics'] => {
  const commandSourceIndexes = new Set(request.command.parameters.sources.map((source) => source.sourceIndex));
  const selectedFrames = request.frames.filter((frame) => commandSourceIndexes.has(frame.sourceIndex));
  const inputPixelCount = selectedFrames.reduce((total, frame) => total + frame.pixels.length, 0);
  const clippedPixelCount = selectedFrames.reduce(
    (total, frame) =>
      total + frame.pixels.reduce((count, pixel) => count + (pixel >= request.clipThreshold ? 1 : 0), 0),
    0,
  );
  return {
    clippedInputPixelRatio: roundHdrRuntimeMetric(clippedPixelCount / Math.max(1, inputPixelCount)),
    maxReconstructionMae: request.maxReconstructionMae,
    motionPixelCount: countHdrMotionPixelsV1(motionMask),
    ...buildHdrReconstructionMae(request.syntheticScenePixels, mergedPixels),
  };
};

const buildHdrReconstructionMae = (syntheticScenePixels: Float64Array | undefined, mergedPixels: Float64Array) => {
  if (syntheticScenePixels === undefined) return {};
  if (syntheticScenePixels.length !== mergedPixels.length) {
    throw new Error('HDR runtime synthetic scene pixel length must match merged output length.');
  }

  let absoluteError = 0;
  for (let index = 0; index < mergedPixels.length; index += 1) {
    absoluteError += Math.abs((syntheticScenePixels[index] ?? 0) - (mergedPixels[index] ?? 0));
  }
  return { reconstructionMae: roundHdrRuntimeMetric(absoluteError / Math.max(1, mergedPixels.length)) };
};

const motionRiskForCoverage = (coverage: number): 'none' | 'low' | 'medium' | 'high' => {
  if (coverage === 0) return 'none';
  if (coverage < 0.05) return 'low';
  if (coverage < 0.15) return 'medium';
  return 'high';
};

const stableHdrRuntimeHash = (input: string): string => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const hashHdrRuntimePixels = (pixels: Float64Array): string => {
  let value = 2166136261;
  for (const pixel of pixels) {
    value ^= Math.round(pixel * 1_000_000);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
};

const isHdrRuntimeCommand = (command: ComputationalMergeCommandEnvelopeV1): command is HdrRuntimeCommandV1 =>
  command.commandType === 'computationalMerge.createHdr';

const roundHdrRuntimeMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
