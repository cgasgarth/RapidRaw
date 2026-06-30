import { z } from 'zod';

import {
  computationalMergePreflightWarningCodes,
  uniqueComputationalMergePreflightWarningCodes,
} from './computationalMergeWarningCodes.js';
import {
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMemoryComponentsV1,
  type ComputationalMergePreflightWarningCodeV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from './rawEngineSchemas.js';

export const focusStackDryRunPreflightSourceStateV1Schema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const focusStackDryRunPreflightOptionsV1Schema = z
  .object({
    planId: z.string().trim().min(1).optional(),
    predictedGraphRevision: z.string().trim().min(1).optional(),
    sourceStates: z.array(focusStackDryRunPreflightSourceStateV1Schema).min(2),
  })
  .strict()
  .superRefine((options, context) => {
    const sourceIndexes = new Set(options.sourceStates.map((sourceState) => sourceState.sourceIndex));
    if (sourceIndexes.size !== options.sourceStates.length) {
      context.addIssue({
        code: 'custom',
        message: 'Focus-stack dry-run preflight source states require unique source indexes.',
        path: ['sourceStates'],
      });
    }
  });

export type FocusStackDryRunPreflightSourceStateV1 = z.infer<typeof focusStackDryRunPreflightSourceStateV1Schema>;
export type FocusStackDryRunPreflightOptionsV1 = z.infer<typeof focusStackDryRunPreflightOptionsV1Schema>;

const DEFAULT_FOCUS_STACK_MEMORY_BUDGET_BYTES = 1_000_000_000;
const RGBA_F32_BYTES_PER_PIXEL = 16;
const MASK_BYTES_PER_PIXEL = 1;
const OVERHEAD_BYTES = 32_000_000;

export const createFocusStackPlanOnlyDryRunResultV1 = (
  commandValue: unknown,
  optionsValue: unknown,
): ComputationalMergeDryRunResultV1 => {
  const command = computationalMergeCommandEnvelopeV1Schema.parse(commandValue);
  const options = focusStackDryRunPreflightOptionsV1Schema.parse(optionsValue);

  if (command.commandType !== 'computationalMerge.createFocusStack') {
    throw new Error('Focus-stack dry-run preflight requires computationalMerge.createFocusStack.');
  }

  if (!command.dryRun) {
    throw new Error('Focus-stack dry-run preflight requires a dry-run command.');
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

  const unreferencedSourceStates = options.sourceStates.filter(
    (sourceState) => !command.parameters.sources.some((source) => source.sourceIndex === sourceState.sourceIndex),
  );
  if (unreferencedSourceStates.length > 0) {
    blockedReasons.push('unreferenced_source_state');
  }

  if (command.parameters.alignmentMode === 'none') {
    warnings.push('Focus-stack alignment is disabled; apply should require tripod-controlled source review.');
    warningCodes.push(computationalMergePreflightWarningCodes.geometryEstimateLowConfidence);
  }

  if (command.parameters.blendMethod === 'depth_map') {
    warnings.push('Depth-map blending is schema-planned and remains preview-gated until fixture validation exists.');
    warningCodes.push(computationalMergePreflightWarningCodes.tileRuntimeDeferred);
  }

  const sourceCount = command.parameters.sources.length;
  const maxPreviewDimensionPx = command.parameters.maxPreviewDimensionPx;
  const outputWidth = maxPreviewDimensionPx;
  const outputHeight = Math.max(1, Math.round(maxPreviewDimensionPx * 0.667));
  const outputPixelCount = outputWidth * outputHeight;
  const sourcePixelCount = sourceCount * outputPixelCount;
  const memoryComponents = estimateFocusStackMemoryComponents(sourceCount, outputPixelCount);
  const memoryBudgetBytes = command.parameters.memoryBudgetBytes ?? DEFAULT_FOCUS_STACK_MEMORY_BUDGET_BYTES;
  const memoryBudgetRatio = memoryComponents.totalEstimatedPeakBytes / memoryBudgetBytes;

  if (memoryBudgetRatio > 0.75) {
    warningCodes.push(computationalMergePreflightWarningCodes.highMemoryEstimate);
    warnings.push('Estimated focus-stack dry-run memory is near the configured budget.');
  }

  if (memoryBudgetRatio > 1) {
    blockedReasons.push('memory_budget_exceeded');
    warningCodes.push(computationalMergePreflightWarningCodes.memoryBudgetExceeded);
  }

  const preflightStatus =
    blockedReasons.length > 0 ? 'blocked_plan_only' : warnings.length > 0 ? 'warning' : 'accepted';
  const estimatedRuntimeMs = 1500 + sourceCount * 450 + Math.round(outputPixelCount / 9000);

  return computationalMergeDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    mergePlan: {
      family: 'focus_stack',
      outputDimensions: {
        height: outputHeight,
        width: outputWidth,
      },
      outputName: command.parameters.outputName,
      performanceEstimate: {
        estimatedPeakMemoryBytes: memoryComponents.totalEstimatedPeakBytes,
        estimatedRuntimeMs,
        requiresBackgroundJob: sourceCount > 8 || memoryBudgetRatio > 0.5,
      },
      planId: options.planId ?? `${command.commandId}_focus_stack_plan`,
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
        focusCoverageRatio: preflightStatus === 'accepted' ? 1 : 0,
        sourceCount,
      },
      sourceImageRefs: command.parameters.sources,
      warnings,
    },
    mutates: false,
    predictedGraphRevision: options.predictedGraphRevision ?? `${command.expectedGraphRevision}_focus_stack_preview`,
    previewArtifacts: [],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings,
  });
};

const estimateFocusStackMemoryComponents = (
  sourceCount: number,
  outputPixelCount: number,
): ComputationalMergeMemoryComponentsV1 => {
  const sourceDecodeBytes = sourceCount * outputPixelCount * RGBA_F32_BYTES_PER_PIXEL;
  const outputCanvasBytes = outputPixelCount * RGBA_F32_BYTES_PER_PIXEL;
  const outputMaskBytes = outputPixelCount * MASK_BYTES_PER_PIXEL;
  const lowDetailMaskBytes = sourceCount * outputPixelCount * MASK_BYTES_PER_PIXEL;
  const previewBytes = outputPixelCount * 4;
  const seamWorkspaceBytes = sourceCount * outputPixelCount * 4;
  const overheadBytes = OVERHEAD_BYTES;

  return {
    lowDetailMaskBytes,
    outputCanvasBytes,
    outputMaskBytes,
    overheadBytes,
    previewBytes,
    seamWorkspaceBytes,
    sourceDecodeBytes,
    totalEstimatedPeakBytes:
      lowDetailMaskBytes +
      outputCanvasBytes +
      outputMaskBytes +
      overheadBytes +
      previewBytes +
      seamWorkspaceBytes +
      sourceDecodeBytes,
  };
};
