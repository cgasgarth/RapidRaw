import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeQualityPreferenceV1Schema,
  panoramaBoundaryModeSchema,
  panoramaProjectionSchema,
  type ComputationalMergeCommandEnvelopeV1,
} from './rawEngineSchemas.js';

const panoramaUiSourceV1Schema = z
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

export const panoramaUiControlsV1Schema = z
  .object({
    blendMode: z.enum(['feather', 'multi_band']).default('multi_band'),
    boundaryMode: panoramaBoundaryModeSchema.exclude(['deferred_fill']),
    exposureMode: z.enum(['gain_compensation', 'none']).default('gain_compensation'),
    lensCorrectionPolicy: z
      .enum(['unchanged', 'required_before_stitch', 'applied_before_stitch'])
      .default('required_before_stitch'),
    maxPreviewDimensionPx: z.number().int().positive().max(8192).default(4096),
    memoryBudgetBytes: z.number().int().positive().optional(),
    outputName: z.string().trim().min(1),
    projection: panoramaProjectionSchema.exclude(['planar']),
    qualityPreference: computationalMergeQualityPreferenceV1Schema.default('best'),
    seamExposureCompensationPercent: z.number().int().min(0).max(100).default(100),
    sources: z.array(panoramaUiSourceV1Schema).min(2),
  })
  .strict();

export const panoramaDryRunContextV1Schema = z
  .object({
    actorId: z.string().trim().min(1).default('agent_rawengine'),
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    targetKind: z.enum(['image', 'project']).default('project'),
  })
  .strict();

export const panoramaApplyContextV1Schema = panoramaDryRunContextV1Schema
  .extend({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .strict();

export type PanoramaUiControlsV1 = z.infer<typeof panoramaUiControlsV1Schema>;
export type PanoramaDryRunContextV1 = z.infer<typeof panoramaDryRunContextV1Schema>;
export type PanoramaApplyContextV1 = z.infer<typeof panoramaApplyContextV1Schema>;

export const buildPanoramaUiDryRunCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = panoramaUiControlsV1Schema.parse(controlsValue);
  const context = panoramaDryRunContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Panorama UI dry-run validates stitch controls without mutating pixels.',
      state: 'not_required',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createPanorama',
    correlationId: context.correlationId,
    dryRun: true,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      blendMode: controls.blendMode,
      boundaryMode: controls.boundaryMode,
      exposureNormalization: controls.exposureMode === 'gain_compensation' ? 'auto' : 'none',
      lensCorrectionPolicy: controls.lensCorrectionPolicy,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      memoryBudgetBytes: controls.memoryBudgetBytes,
      outputName: controls.outputName,
      projection: controls.projection,
      qualityPreference: controls.qualityPreference,
      seamExposureCompensationPercent: controls.seamExposureCompensationPercent,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'panorama_tile',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};

export const buildPanoramaUiApplyCommandV1 = (
  controlsValue: unknown,
  contextValue: unknown,
): ComputationalMergeCommandEnvelopeV1 => {
  const controls = panoramaUiControlsV1Schema.parse(controlsValue);
  const context = panoramaApplyContextV1Schema.parse(contextValue);

  return computationalMergeCommandEnvelopeV1Schema.parse({
    actor: { id: context.actorId, kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Panorama UI apply uses an accepted stitch dry-run plan before mutating the edit graph.',
      state: 'approved',
    },
    commandId: context.commandId,
    commandType: 'computationalMerge.createPanorama',
    correlationId: context.correlationId,
    dryRun: false,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: context.idempotencyKey,
    parameters: {
      acceptedDryRunPlanHash: context.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: context.acceptedDryRunPlanId,
      blendMode: controls.blendMode,
      boundaryMode: controls.boundaryMode,
      exposureNormalization: controls.exposureMode === 'gain_compensation' ? 'auto' : 'none',
      lensCorrectionPolicy: controls.lensCorrectionPolicy,
      maxPreviewDimensionPx: controls.maxPreviewDimensionPx,
      memoryBudgetBytes: controls.memoryBudgetBytes,
      outputName: controls.outputName,
      projection: controls.projection,
      qualityPreference: controls.qualityPreference,
      seamExposureCompensationPercent: controls.seamExposureCompensationPercent,
      sources: controls.sources.map((source) => ({
        colorSpaceHint: source.colorSpaceHint,
        exposureEv: source.exposureEv,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: source.rawDefaultsApplied,
        role: 'panorama_tile',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: context.targetId, kind: context.targetKind },
  });
};
