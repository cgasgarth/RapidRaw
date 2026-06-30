import { z } from 'zod';

import {
  detectHdrBracketV1,
  hdrBracketDetectionOptionsV1Schema,
  hdrBracketDetectionSourceInputV1Schema,
} from './hdrBracketDetection.js';
import {
  ApprovalClass,
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
  type HdrBracketDetectionResultV1,
  RAW_ENGINE_SCHEMA_VERSION,
  rawEngineActorSchema,
  rawEngineTargetSchema,
} from './rawEngineSchemas.js';

export const hdrMergeApiToolRequestV1Schema = z
  .object({
    actor: rawEngineActorSchema,
    alignmentMode: z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']).default('auto'),
    bracketDetectionOptions: hdrBracketDetectionOptionsV1Schema.optional(),
    bracketValidation: z.enum(['required', 'warn', 'disabled']).default('required'),
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    deghosting: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    maxPreviewDimensionPx: z.number().int().positive().max(8192).default(2400),
    mergeStrategy: z.enum(['scene_linear_radiance', 'exposure_fusion_preview']).default('scene_linear_radiance'),
    outputName: z.string().trim().min(1),
    qualityPreference: z.enum(['preview', 'balanced', 'best']).default('balanced'),
    sources: z.array(hdrBracketDetectionSourceInputV1Schema).min(2),
    target: rawEngineTargetSchema.safeExtend({ kind: z.enum(['image', 'project']) }).strict(),
    toneMapPreview: z.boolean().default(true),
    toneMappingPreset: z
      .enum(['custom', 'natural', 'highlight_detail', 'interior_lift', 'fast_preview'])
      .default('natural'),
  })
  .strict();

export type HdrMergeApiToolRequestV1 = z.infer<typeof hdrMergeApiToolRequestV1Schema>;

export type HdrMergeApiToolResultV1 = {
  bracketDetection: HdrBracketDetectionResultV1;
  command: ComputationalMergeCommandEnvelopeV1;
};

export const buildHdrMergeApiCommandV1 = (requestValue: unknown): HdrMergeApiToolResultV1 => {
  const request = hdrMergeApiToolRequestV1Schema.parse(requestValue);
  const bracketDetection = detectHdrBracketV1({
    options: request.bracketDetectionOptions,
    sources: request.sources,
  });

  if (request.bracketValidation === 'required' && !bracketDetection.accepted) {
    throw new Error(`HDR bracket validation failed: ${bracketDetection.blockCodes.join(', ')}`);
  }

  const command = computationalMergeCommandEnvelopeV1Schema.parse({
    actor: request.actor,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview HDR merge API tool command validates brackets and prepares a non-mutating merge dry run.',
      state: 'not_required',
    },
    commandId: request.commandId,
    commandType: 'computationalMerge.createHdr',
    correlationId: request.correlationId,
    dryRun: true,
    expectedGraphRevision: request.expectedGraphRevision,
    idempotencyKey: request.idempotencyKey,
    parameters: {
      alignmentMode: request.alignmentMode,
      bracketValidation: request.bracketValidation,
      deghosting: request.deghosting,
      maxPreviewDimensionPx: request.maxPreviewDimensionPx,
      mergeStrategy: request.mergeStrategy,
      outputName: request.outputName,
      qualityPreference: request.qualityPreference,
      sources: bracketDetection.sourceMetadata.map((source) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: source.resolvedExposureEv,
        exposureWeightMultiplier: 1,
        imageId: source.imageId,
        imagePath: source.imagePath,
        rawDefaultsApplied: true,
        role: 'hdr_bracket',
        sourceIndex: source.sourceIndex,
        virtualCopyId: source.virtualCopyId,
      })),
      toneMapPreview: request.toneMapPreview,
      toneMappingPreset: request.toneMappingPreset,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: request.target,
  });

  return { bracketDetection, command };
};
