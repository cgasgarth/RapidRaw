import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeAlignmentModeV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeQualityPreferenceV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
} from './rawEngineSchemas.js';

const focusStackUiSourceV1Schema = z
  .object({
    colorSpaceHint: z.string().trim().min(1).default('camera_rgb'),
    focusDistanceMm: z.number().positive().optional(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    rawDefaultsApplied: z.boolean().default(true),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const focusStackUiControlsV1Schema = z
  .object({
    alignmentMode: computationalMergeAlignmentModeV1Schema.exclude(['optical_flow']),
    blendMethod: z.enum(['depth_map', 'laplacian_pyramid', 'weighted_sharpness']),
    haloSuppressionStrengthPercent: z.number().int().min(0).max(100).default(0),
    maxPreviewDimensionPx: z.number().int().positive().max(8192).default(2400),
    memoryBudgetBytes: z.number().int().positive().optional(),
    outputName: z.string().trim().min(1),
    qualityPreference: computationalMergeQualityPreferenceV1Schema.default('best'),
    retouchLayerPolicy: z.enum(['none', 'generate_retouch_layer']),
    sources: z.array(focusStackUiSourceV1Schema).min(2),
  })
  .strict();

export const focusStackDryRunContextV1Schema = z
  .object({
    actorId: z.string().trim().min(1).default('agent_rawengine'),
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    targetKind: z.enum(['image', 'project']).default('project'),
  })
  .strict();

export const focusStackApplyContextV1Schema = focusStackDryRunContextV1Schema
  .extend({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type FocusStackUiControlsV1 = z.infer<typeof focusStackUiControlsV1Schema>;
export type FocusStackDryRunContextV1 = z.infer<typeof focusStackDryRunContextV1Schema>;
export type FocusStackApplyContextV1 = z.infer<typeof focusStackApplyContextV1Schema>;

export const buildFocusStackUiDryRunCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = focusStackUiControlsV1Schema.parse(controlsValue);
  const context = focusStackDryRunContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Focus stack UI dry-run validates focus-slice controls without mutating pixels.',
      state: 'not_required',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createFocusStack',
    correlationId: context.correlationId,
    dryRun: true,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      alignmentMode: controls.alignmentMode,
      blendMethod: controls.blendMethod,
      haloSuppressionStrengthPercent: controls.haloSuppressionStrengthPercent,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      memoryBudgetBytes: controls.memoryBudgetBytes,
      outputName: controls.outputName,
      qualityPreference: controls.qualityPreference,
      retouchLayerPolicy: controls.retouchLayerPolicy,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        focusDistanceMm: source.focusDistanceMm,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'focus_slice',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};

export const buildFocusStackUiApplyCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = focusStackUiControlsV1Schema.parse(controlsValue);
  const context = focusStackApplyContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Focus stack UI apply uses an accepted stack dry-run plan before mutating the edit graph.',
      state: 'approved',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createFocusStack',
    correlationId: context.correlationId,
    dryRun: false,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: context.idempotencyKey,
    parameters: {
      acceptedDryRunPlanHash: context.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: context.acceptedDryRunPlanId,
      alignmentMode: controls.alignmentMode,
      blendMethod: controls.blendMethod,
      haloSuppressionStrengthPercent: controls.haloSuppressionStrengthPercent,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      memoryBudgetBytes: controls.memoryBudgetBytes,
      outputName: controls.outputName,
      qualityPreference: controls.qualityPreference,
      retouchLayerPolicy: controls.retouchLayerPolicy,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        focusDistanceMm: source.focusDistanceMm,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'focus_slice',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};
