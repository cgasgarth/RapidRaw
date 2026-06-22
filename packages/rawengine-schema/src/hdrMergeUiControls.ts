import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeQualityPreferenceV1Schema,
  type ComputationalMergeCommandEnvelopeV1,
} from './rawEngineSchemas.js';

const hdrMergeUiSourceV1Schema = z
  .object({
    colorSpaceHint: z.string().trim().min(1).default('camera_rgb'),
    exposureEv: z.number(),
    exposureWeightMultiplier: z.number().positive().default(1),
    imageId: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1),
    rawDefaultsApplied: z.boolean().default(true),
    sourceIndex: z.number().int().nonnegative(),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const hdrToneMappingPresetV1Schema = z.enum(['custom', 'natural', 'highlight_detail', 'interior_lift', 'fast_preview']);

export const hdrMergeUiControlsV1Schema = z
  .object({
    alignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']).default('auto'),
    bracketValidation: z.enum(['required', 'warn', 'disabled']).default('required'),
    deghostConfidenceMapVisible: z.boolean().default(false),
    deghostRegionIntensityPercent: z.number().int().min(0).max(100).default(65),
    deghosting: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
    maxPreviewDimensionPx: z.number().int().positive().max(8192).default(2400),
    mergeStrategy: z.enum(['scene_linear_radiance', 'exposure_fusion_preview']).default('scene_linear_radiance'),
    outputName: z.string().trim().min(1),
    qualityPreference: computationalMergeQualityPreferenceV1Schema.default('balanced'),
    sources: z.array(hdrMergeUiSourceV1Schema).min(2),
    toneMapPreview: z.boolean().default(true),
    toneMappingPreset: hdrToneMappingPresetV1Schema.default('natural'),
  })
  .strict();

export const hdrMergeDryRunContextV1Schema = z
  .object({
    actorId: z.string().trim().min(1).default('agent_rawengine'),
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    targetKind: z.enum(['image', 'project']).default('project'),
  })
  .strict();

export const hdrMergeApplyContextV1Schema = hdrMergeDryRunContextV1Schema
  .extend({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type HdrMergeUiControlsV1 = z.infer<typeof hdrMergeUiControlsV1Schema>;
export type HdrMergeDryRunContextV1 = z.infer<typeof hdrMergeDryRunContextV1Schema>;
export type HdrMergeApplyContextV1 = z.infer<typeof hdrMergeApplyContextV1Schema>;

export const buildHdrMergeUiDryRunCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = hdrMergeUiControlsV1Schema.parse(controlsValue);
  const context = hdrMergeDryRunContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'HDR merge UI dry-run validates bracket controls without mutating pixels.',
      state: 'not_required',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createHdr',
    correlationId: context.correlationId,
    dryRun: true,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      alignmentMode: controls.alignmentMode,
      bracketValidation: controls.bracketValidation,
      deghostConfidenceMapVisible: controls.deghostConfidenceMapVisible,
      deghostRegionIntensityPercent: controls.deghostRegionIntensityPercent,
      deghosting: controls.deghosting,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      mergeStrategy: controls.mergeStrategy,
      outputName: controls.outputName,
      qualityPreference: controls.qualityPreference,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        exposureWeightMultiplier: source.exposureWeightMultiplier,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'hdr_bracket',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
      toneMapPreview: controls.toneMapPreview,
      toneMappingPreset: controls.toneMappingPreset,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};

export const buildHdrMergeUiApplyCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = hdrMergeUiControlsV1Schema.parse(controlsValue);
  const context = hdrMergeApplyContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'HDR merge UI apply uses an accepted dry-run plan before mutating the edit graph.',
      state: 'approved',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createHdr',
    correlationId: context.correlationId,
    dryRun: false,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: context.idempotencyKey,
    parameters: {
      acceptedDryRunPlanHash: context.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: context.acceptedDryRunPlanId,
      alignmentMode: controls.alignmentMode,
      bracketValidation: controls.bracketValidation,
      deghostConfidenceMapVisible: controls.deghostConfidenceMapVisible,
      deghostRegionIntensityPercent: controls.deghostRegionIntensityPercent,
      deghosting: controls.deghosting,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      mergeStrategy: controls.mergeStrategy,
      outputName: controls.outputName,
      qualityPreference: controls.qualityPreference,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        exposureWeightMultiplier: source.exposureWeightMultiplier,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'hdr_bracket',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
      toneMapPreview: controls.toneMapPreview,
      toneMappingPreset: controls.toneMappingPreset,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};
