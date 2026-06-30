import { z } from 'zod';

import {
  computationalMergePreflightWarningCodes,
  uniqueComputationalMergePreflightWarningCodes,
} from '../computational-merge/computationalMergeWarningCodes.js';
import {
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMemoryComponentsV1,
  type ComputationalMergePreflightWarningCodeV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../rawEngineSchemas.js';

export const superResolutionDryRunPreflightSourceStateV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const superResolutionDryRunPreflightOptionsV1Schema = z
  .object({
    planId: z.string().trim().min(1).optional(),
    predictedGraphRevision: z.string().trim().min(1).optional(),
    sourceStates: z.array(superResolutionDryRunPreflightSourceStateV1Schema).min(2),
  })
  .strict()
  .superRefine((options, context) => {
    const sourceIndexes = new Set(options.sourceStates.map((sourceState) => sourceState.sourceIndex));
    if (sourceIndexes.size !== options.sourceStates.length) {
      context.addIssue({
        code: 'custom',
        message: 'Super-resolution dry-run preflight source states require unique source indexes.',
        path: ['sourceStates'],
      });
    }
  });

const DEFAULT_SR_MEMORY_BUDGET_BYTES = 1_500_000_000;
const RGBA_F32_BYTES_PER_PIXEL = 16;
const MASK_BYTES_PER_PIXEL = 1;
const OVERHEAD_BYTES = 48_000_000;

export const createSuperResolutionPlanOnlyDryRunResultV1 = (
  commandValue: unknown,
  optionsValue: unknown,
): ComputationalMergeDryRunResultV1 => {
  const command = computationalMergeCommandEnvelopeV1Schema.parse(commandValue);
  const options = superResolutionDryRunPreflightOptionsV1Schema.parse(optionsValue);

  if (command.commandType !== 'computationalMerge.createSuperResolution') {
    throw new Error('Super-resolution dry-run preflight requires computationalMerge.createSuperResolution.');
  }

  if (!command.dryRun) {
    throw new Error('Super-resolution dry-run preflight requires a dry-run command.');
  }

  const sourceStateByIndex = new Map(options.sourceStates.map((sourceState) => [sourceState.sourceIndex, sourceState]));
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const warningCodes: ComputationalMergePreflightWarningCodeV1[] = [];

  for (const source of command.parameters.sources) {
    const sourceState = sourceStateByIndex.get(source.sourceIndex);
    if (sourceState === undefined) {
      blockedReasons.push(`missing_source_state:${source.sourceIndex}`);
      continue;
    }
    if (sourceState.graphRevision !== command.expectedGraphRevision) {
      blockedReasons.push(`source_graph_revision_mismatch:${source.sourceIndex}`);
    }
    if (!source.rawDefaultsApplied) {
      blockedReasons.push(`raw_defaults_not_applied:${source.sourceIndex}`);
    }
  }

  if (command.parameters.detailPolicy === 'aggressive_preview_only') {
    warnings.push('Aggressive detail is preview-only and must not be applied.');
    warningCodes.push(computationalMergePreflightWarningCodes.geometryEstimateLowConfidence);
  }

  const sourceCount = command.parameters.sources.length;
  const maxPreviewDimensionPx = command.parameters.maxPreviewDimensionPx;
  const outputWidth = Math.round(maxPreviewDimensionPx * command.parameters.outputScale);
  const outputHeight = Math.max(1, Math.round(outputWidth * 0.667));
  const outputPixelCount = outputWidth * outputHeight;
  const sourcePixelCount = sourceCount * Math.round(outputPixelCount / command.parameters.outputScale ** 2);
  const memoryComponents = estimateSuperResolutionMemoryComponents(sourceCount, outputPixelCount);
  const memoryBudgetBytes = DEFAULT_SR_MEMORY_BUDGET_BYTES;
  const memoryBudgetRatio = memoryComponents.totalEstimatedPeakBytes / memoryBudgetBytes;

  if (memoryBudgetRatio > 0.75) {
    warnings.push('Estimated super-resolution dry-run memory is near the configured budget.');
    warningCodes.push(computationalMergePreflightWarningCodes.highMemoryEstimate);
  }
  if (memoryBudgetRatio > 1) {
    blockedReasons.push('memory_budget_exceeded');
    warningCodes.push(computationalMergePreflightWarningCodes.memoryBudgetExceeded);
  }

  const preflightStatus =
    blockedReasons.length > 0 ? 'blocked_plan_only' : warnings.length > 0 ? 'warning' : 'accepted';

  return computationalMergeDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mergePlan: {
      family: 'super_resolution',
      outputDimensions: {
        height: outputHeight,
        width: outputWidth,
      },
      outputName: command.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: memoryComponents.totalEstimatedPeakBytes,
        estimatedRuntimeMs: 2200 + sourceCount * 650 + Math.round(outputPixelCount / 7000),
        requiresBackgroundJob: true,
      },
      planId: options.planId ?? `${command.commandId}_super_resolution_plan`,
      preflight: {
        blockedReasons,
        engineCapabilities: {
          fullFrameLegacy: false,
          maxPreviewDimensionPx,
          planOnly: true,
          tileBackedRender: false,
        },
        executionMode: 'plan_only',
        geometryEstimate: {
          outputPixelCount,
          projectedBounds: {
            height: outputHeight,
            width: outputWidth,
            x: 0,
            y: 0,
          },
          sourceCount,
          sourcePixelCount,
        },
        memoryBudgetBytes,
        memoryBudgetRatio,
        memoryComponents,
        status: preflightStatus,
        tileCount: 1,
        warningCodes: uniqueComputationalMergePreflightWarningCodes(warningCodes),
      },
      qualityMetrics: {
        alignmentConfidence: preflightStatus === 'blocked_plan_only' ? 0 : 0.88,
        expectedDetailGainRatio: command.parameters.outputScale * 0.82,
        overlapCoverageRatio: sourceCount > 1 ? 0.7 : 0,
        sourceCount,
      },
      sourceImageRefs: command.parameters.sources,
      warnings,
    },
    mutates: false,
    predictedGraphRevision: options.predictedGraphRevision ?? `${command.expectedGraphRevision}_sr_preview`,
    previewArtifacts: [],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings,
  });
};

const estimateSuperResolutionMemoryComponents = (
  sourceCount: number,
  outputPixelCount: number,
): ComputationalMergeMemoryComponentsV1 => {
  const outputCanvasBytes = outputPixelCount * RGBA_F32_BYTES_PER_PIXEL;
  const outputMaskBytes = outputPixelCount * MASK_BYTES_PER_PIXEL;
  const previewBytes = Math.round(outputCanvasBytes / 8);
  const sourceDecodeBytes = Math.round(sourceCount * outputCanvasBytes * 0.35);
  const lowDetailMaskBytes = Math.round(outputMaskBytes / 4);
  const seamWorkspaceBytes = Math.round(outputCanvasBytes * 0.5);
  const totalEstimatedPeakBytes =
    lowDetailMaskBytes +
    outputCanvasBytes +
    outputMaskBytes +
    OVERHEAD_BYTES +
    previewBytes +
    seamWorkspaceBytes +
    sourceDecodeBytes;

  return {
    lowDetailMaskBytes,
    outputCanvasBytes,
    outputMaskBytes,
    overheadBytes: OVERHEAD_BYTES,
    previewBytes,
    seamWorkspaceBytes,
    sourceDecodeBytes,
    totalEstimatedPeakBytes,
  };
};
