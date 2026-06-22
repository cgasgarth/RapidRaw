import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeAlignmentModeV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeQualityPreferenceV1Schema,
  superResolutionReconstructionModeV1Schema,
  superResolutionDetailPolicyV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
} from './rawEngineSchemas.js';

const superResolutionUiSourceV1Schema = z
  .object({
    colorSpaceHint: z.string().trim().min(1).default('camera_rgb'),
    exposureEv: z.number().optional(),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    rawDefaultsApplied: z.boolean().default(true),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const superResolutionUiControlsV1Schema = z
  .object({
    alignmentMode: computationalMergeAlignmentModeV1Schema.exclude(['none']),
    detailPolicy: superResolutionDetailPolicyV1Schema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192).default(2400),
    outputName: z.string().trim().min(1),
    outputScale: z.number().min(1.1).max(4),
    qualityPreference: computationalMergeQualityPreferenceV1Schema.default('best'),
    reconstructionMode: superResolutionReconstructionModeV1Schema.default('model_detail'),
    sources: z.array(superResolutionUiSourceV1Schema).min(2),
  })
  .strict();

export const superResolutionDryRunContextV1Schema = z
  .object({
    actorId: z.string().trim().min(1).default('agent_rawengine'),
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    targetKind: z.enum(['image', 'project']).default('project'),
  })
  .strict();

export const superResolutionApplyContextV1Schema = superResolutionDryRunContextV1Schema
  .extend({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type SuperResolutionUiControlsV1 = z.infer<typeof superResolutionUiControlsV1Schema>;
export type SuperResolutionDryRunContextV1 = z.infer<typeof superResolutionDryRunContextV1Schema>;
export type SuperResolutionApplyContextV1 = z.infer<typeof superResolutionApplyContextV1Schema>;

export const buildSuperResolutionUiDryRunCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = superResolutionUiControlsV1Schema.parse(controlsValue);
  const context = superResolutionDryRunContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Super-resolution UI dry-run validates multi-frame controls without mutating pixels.',
      state: 'not_required',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createSuperResolution',
    correlationId: context.correlationId,
    dryRun: true,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      alignmentMode: controls.alignmentMode,
      detailPolicy: controls.detailPolicy,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      mode: 'multi_image',
      outputName: controls.outputName,
      outputScale: controls.outputScale,
      qualityPreference: controls.qualityPreference,
      reconstructionMode: controls.reconstructionMode,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'sr_frame',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};

export const buildSuperResolutionUiApplyCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = superResolutionUiControlsV1Schema.parse(controlsValue);
  const context = superResolutionApplyContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Super-resolution UI apply uses an accepted dry-run plan before mutating the edit graph.',
      state: 'approved',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createSuperResolution',
    correlationId: context.correlationId,
    dryRun: false,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: context.idempotencyKey,
    parameters: {
      acceptedDryRunPlanHash: context.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: context.acceptedDryRunPlanId,
      alignmentMode: controls.alignmentMode,
      detailPolicy: controls.detailPolicy,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      mode: 'multi_image',
      outputName: controls.outputName,
      outputScale: controls.outputScale,
      qualityPreference: controls.qualityPreference,
      reconstructionMode: controls.reconstructionMode,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'sr_frame',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};
